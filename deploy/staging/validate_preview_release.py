#!/usr/bin/env python3
"""Build a preview archive from landing main after checking catalog parity."""

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator
import fcntl
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen


RELEASE_SCHEMA_VERSION = "granit-staging-release.v1"
OPERATIONS_SCHEMA_VERSION = "granit-operations-release.v1"
CATALOG_SCHEMA_VERSION = "catalog-index.v1"
LANDING_REPOSITORY = "monaxovdulov/landing-granit-static"
MAIN_REF = "refs/heads/main"
CACHED_MAIN_REF = "refs/remotes/release-gate/main"
CATALOG_INDEX_PATH = "assets/catalog/catalog-index.v1.json"
RELEASE_MANIFEST_PATH = "release.json"
MAX_ARCHIVE_MEMBERS = 4096
MAX_CATALOG_INDEX_SIZE_BYTES = 16 * 1024 * 1024
READ_CHUNK_SIZE_BYTES = 1024 * 1024

GITHUB_REMOTE = os.environ.get(
    "GRANIT_RELEASE_GATE_GITHUB_REMOTE",
    f"git@github.com:{LANDING_REPOSITORY}.git",
)
GITHUB_DEPLOY_KEY = os.environ.get(
    "GRANIT_RELEASE_GATE_GITHUB_DEPLOY_KEY",
    "/home/granit-deploy/.ssh/landing-main-readonly_ed25519",
)
GITHUB_KNOWN_HOSTS = os.environ.get(
    "GRANIT_RELEASE_GATE_GITHUB_KNOWN_HOSTS",
    "/home/granit-deploy/.ssh/known_hosts",
)
REPOSITORY_PATH = Path(
    os.environ.get(
        "GRANIT_RELEASE_GATE_REPOSITORY",
        "/srv/granit-prod/repos/landing-granit-static.git",
    )
)
OPERATIONS_HEALTH_URL = os.environ.get(
    "GRANIT_RELEASE_GATE_OPERATIONS_HEALTH_URL",
    "https://manager.botops.ru/health",
)


class ReleaseValidationError(Exception):
    pass


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--check-main":
        return check_main_only(sys.argv[2])
    if len(sys.argv) != 2:
        print("ERROR: expected exact landing commit SHA", file=sys.stderr)
        return 64

    commit_sha = sys.argv[1]
    try:
        validate_commit_sha(commit_sha)
        require_current_main_sha(commit_sha)
        with fetch_main_archive(commit_sha) as source_archive:
            catalog_bytes = inspect_main_archive(source_archive)
            operations = read_operations_release()
            manifest_bytes = build_release_manifest(
                commit_sha,
                catalog_bytes,
                operations,
            )
            with temporary_file("granit-preview-built-", ".tar.gz") as output_path:
                write_release_archive(source_archive, manifest_bytes, output_path)
                require_current_main_sha(commit_sha)
                stream_archive(output_path, sys.stdout.buffer)
    except ReleaseValidationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def check_main_only(commit_sha: str) -> int:
    try:
        validate_commit_sha(commit_sha)
        require_current_main_sha(commit_sha)
    except ReleaseValidationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def validate_commit_sha(commit_sha: object) -> None:
    if not isinstance(commit_sha, str) or len(commit_sha) != 40 or any(
        character not in "0123456789abcdef" for character in commit_sha
    ):
        raise ReleaseValidationError(
            "commit SHA must be exactly 40 lowercase hex characters"
        )


def require_current_main_sha(commit_sha: str) -> None:
    actual_sha = resolve_current_main_sha()
    if actual_sha != commit_sha:
        raise ReleaseValidationError(
            "preview deploy accepts only current landing main; "
            f"requested={commit_sha}, actual={actual_sha}"
        )


def resolve_current_main_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "ls-remote", GITHUB_REMOTE, MAIN_REF],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
            env=git_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ReleaseValidationError("cannot resolve landing main SHA") from error

    fields = result.stdout.strip().split()
    if len(fields) != 2 or fields[1] != MAIN_REF:
        raise ReleaseValidationError("cannot resolve landing main SHA")
    validate_commit_sha(fields[0])
    return fields[0]


def git_environment() -> dict[str, str]:
    ssh_command = " ".join(
        (
            "ssh",
            "-i",
            GITHUB_DEPLOY_KEY,
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            f"UserKnownHostsFile={GITHUB_KNOWN_HOSTS}",
        )
    )
    return {**os.environ, "GIT_SSH_COMMAND": ssh_command}


@contextmanager
def temporary_file(prefix: str, suffix: str) -> Iterator[Path]:
    temporary = tempfile.NamedTemporaryFile(
        prefix=prefix,
        suffix=suffix,
        delete=False,
    )
    path = Path(temporary.name)
    temporary.close()
    try:
        yield path
    finally:
        path.unlink(missing_ok=True)


@contextmanager
def fetch_main_archive(commit_sha: str) -> Iterator[Path]:
    with temporary_file("granit-preview-main-", ".tar") as archive_path:
        with lock_release_repository():
            fetch_main_into_repository(commit_sha, archive_path)
        yield archive_path


@contextmanager
def lock_release_repository() -> Iterator[None]:
    if not REPOSITORY_PATH.is_dir():
        raise ReleaseValidationError(
            "landing release repository is not initialized"
        )

    lock_path = REPOSITORY_PATH / "release-gate.lock"
    try:
        with lock_path.open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ReleaseValidationError(
                    "another preview deploy is already in progress"
                ) from error
            yield
    except ReleaseValidationError:
        raise
    except OSError as error:
        raise ReleaseValidationError(
            "landing release repository is unavailable"
        ) from error


def fetch_main_into_repository(commit_sha: str, archive_path: Path) -> None:
    try:
        repository = str(REPOSITORY_PATH)
        subprocess.run(
            [
                "git",
                "-C",
                repository,
                "fetch",
                "--quiet",
                "--force",
                "--depth=1",
                GITHUB_REMOTE,
                f"{MAIN_REF}:{CACHED_MAIN_REF}",
            ],
            check=True,
            capture_output=True,
            timeout=300,
            env=git_environment(),
        )
        result = subprocess.run(
            ["git", "-C", repository, "rev-parse", CACHED_MAIN_REF],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.stdout.strip() != commit_sha:
            raise ReleaseValidationError(
                "landing main changed while the release was being built"
            )
        subprocess.run(
            [
                "git",
                "-C",
                repository,
                "archive",
                "--format=tar",
                f"--output={archive_path}",
                commit_sha,
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ReleaseValidationError(
            "cannot build archive from landing main"
        ) from error


def inspect_main_archive(source_archive: Path) -> bytes:
    catalog_bytes = None
    try:
        with tarfile.open(source_archive, "r:") as archive:
            for member_count, member in enumerate(archive, start=1):
                if member_count > MAX_ARCHIVE_MEMBERS:
                    raise ReleaseValidationError(
                        "landing main archive contains too many members"
                    )
                normalized = normalize_archive_path(member.name)
                if not member.isfile() and not member.isdir():
                    raise ReleaseValidationError(
                        f"landing main contains unsafe member: {normalized}"
                    )
                if normalized == RELEASE_MANIFEST_PATH:
                    raise ReleaseValidationError(
                        "landing main reserves release.json for the deploy gate"
                    )
                if normalized == CATALOG_INDEX_PATH:
                    if catalog_bytes is not None or not member.isfile():
                        raise ReleaseValidationError(
                            "landing main must contain one catalog index"
                        )
                    catalog_bytes = read_member(
                        archive,
                        member,
                        MAX_CATALOG_INDEX_SIZE_BYTES,
                    )
    except (OSError, tarfile.TarError) as error:
        raise ReleaseValidationError(
            "landing main archive is invalid"
        ) from error

    if catalog_bytes is None:
        raise ReleaseValidationError(
            "landing main must contain one catalog index"
        )
    return catalog_bytes


def read_member(
    archive: tarfile.TarFile,
    member: tarfile.TarInfo,
    max_size_bytes: int,
) -> bytes:
    if member.size > max_size_bytes:
        raise ReleaseValidationError(
            f"release file exceeds size guardrail: {member.name}"
        )
    source = archive.extractfile(member)
    if source is None:
        raise ReleaseValidationError(f"cannot read release file: {member.name}")
    content = source.read(max_size_bytes + 1)
    if len(content) > max_size_bytes:
        raise ReleaseValidationError(
            f"release file exceeds size guardrail: {member.name}"
        )
    return content


def normalize_archive_path(value: str) -> str:
    normalized = PurePosixPath(value)
    if normalized.is_absolute() or ".." in normalized.parts or not normalized.parts:
        raise ReleaseValidationError(f"unsafe archive path: {value}")
    return str(normalized)


def build_release_manifest(
    commit_sha: str,
    catalog_bytes: bytes,
    operations: dict,
) -> bytes:
    catalog = parse_catalog(catalog_bytes)
    operations_catalog = operations["catalog"]
    if operations_catalog["sourceRepository"] != LANDING_REPOSITORY:
        raise ReleaseValidationError(
            "operations catalog source repository differs from landing"
        )

    catalog_hash = sha256(catalog_bytes).hexdigest()
    if catalog_hash != operations_catalog["sha256"]:
        raise ReleaseValidationError("landing and operations catalog SHA-256 differ")
    if catalog["catalog_version"] != operations_catalog["version"]:
        raise ReleaseValidationError("landing and operations catalog versions differ")

    manifest = {
        "schema_version": RELEASE_SCHEMA_VERSION,
        "landing": {
            "repository": LANDING_REPOSITORY,
            "branch": "main",
            "commit_sha": commit_sha,
        },
        "catalog": {
            "version": catalog["catalog_version"],
            "sha256": catalog_hash,
        },
        "operations": {
            "commit_sha": operations["operationsSha"],
            "catalog_sha256": operations_catalog["sha256"],
        },
    }
    return (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()


def parse_catalog(catalog_bytes: bytes) -> dict:
    try:
        catalog = json.loads(catalog_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseValidationError("catalog index is invalid JSON") from error
    if (
        not isinstance(catalog, dict)
        or catalog.get("schema_version") != CATALOG_SCHEMA_VERSION
        or not isinstance(catalog.get("catalog_version"), str)
    ):
        raise ReleaseValidationError("catalog index shape is invalid")
    return catalog


def read_operations_release() -> dict:
    try:
        with urlopen(OPERATIONS_HEALTH_URL, timeout=15) as response:
            health = json.load(response)
    except (OSError, ValueError) as error:
        raise ReleaseValidationError(
            "cannot read operations release metadata"
        ) from error
    release = health.get("release") if isinstance(health, dict) else None
    if (
        not isinstance(release, dict)
        or release.get("schemaVersion") != OPERATIONS_SCHEMA_VERSION
        or set(release) != {"schemaVersion", "operationsSha", "catalog"}
    ):
        raise ReleaseValidationError("operations release metadata is unavailable")
    catalog = release["catalog"]
    if not isinstance(catalog, dict) or set(catalog) != {
        "sourceRepository",
        "sourceBaseSha",
        "version",
        "sha256",
    }:
        raise ReleaseValidationError("operations catalog metadata shape is invalid")
    validate_commit_sha(release["operationsSha"])
    validate_commit_sha(catalog["sourceBaseSha"])
    return release


def write_release_archive(
    source_archive: Path,
    manifest_bytes: bytes,
    output_path: Path,
) -> None:
    with tarfile.open(source_archive, "r:") as source, tarfile.open(
        output_path,
        "w:gz",
    ) as destination:
        for member in source:
            normalized = normalize_archive_path(member.name)
            if normalized == ".github" or normalized.startswith(".github/"):
                continue
            if member.isdir():
                destination.addfile(member)
                continue
            content = source.extractfile(member)
            if content is None:
                raise ReleaseValidationError(
                    f"cannot read landing main file: {normalized}"
                )
            destination.addfile(member, content)

        manifest_info = tarfile.TarInfo(RELEASE_MANIFEST_PATH)
        manifest_info.size = len(manifest_bytes)
        manifest_info.mode = 0o644
        manifest_info.mtime = 0
        destination.addfile(manifest_info, BytesIO(manifest_bytes))


def stream_archive(archive_path: Path, destination: BinaryIO) -> None:
    with archive_path.open("rb") as source:
        while chunk := source.read(READ_CHUNK_SIZE_BYTES):
            destination.write(chunk)
    destination.flush()


if __name__ == "__main__":
    raise SystemExit(main())
