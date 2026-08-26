#!/usr/bin/env python3
"""Build a trusted landing preview archive from the current main commit."""

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Iterator
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
CATALOG_INDEX_PATH = "assets/catalog/catalog-index.v1.json"
RELEASE_MANIFEST_PATH = "release.json"
MAX_REQUEST_SIZE_BYTES = 1024 * 1024
MAX_ARCHIVE_MEMBERS = 4096
MAX_RELEASE_MANIFEST_SIZE_BYTES = 64 * 1024
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
        with receive_request(sys.stdin.buffer) as request_path:
            manifest_bytes = read_release_request(request_path)
            with fetch_main_archive(commit_sha) as source_archive:
                catalog_bytes = inspect_main_archive(source_archive)
                manifest = parse_json(manifest_bytes, RELEASE_MANIFEST_PATH)
                validate_release_manifest(manifest, catalog_bytes, commit_sha)
                with temporary_file("granit-preview-built-", ".tar.gz") as output_path:
                    write_release_archive(
                        source_archive,
                        manifest_bytes,
                        output_path,
                    )
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
def receive_request(source: BinaryIO) -> Iterator[Path]:
    with temporary_file("granit-preview-request-", ".tar.gz") as request_path:
        size_bytes = 0
        with request_path.open("wb") as request:
            while chunk := source.read(READ_CHUNK_SIZE_BYTES):
                size_bytes += len(chunk)
                if size_bytes > MAX_REQUEST_SIZE_BYTES:
                    raise ReleaseValidationError(
                        "release request exceeds compressed size guardrail"
                    )
                request.write(chunk)
        if size_bytes == 0:
            raise ReleaseValidationError("empty release request received")
        yield request_path


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
    with tempfile.TemporaryDirectory(prefix="granit-preview-main-") as directory:
        repository = Path(directory) / "repository.git"
        archive_path = Path(directory) / "main.tar"
        try:
            subprocess.run(
                ["git", "init", "--bare", "--quiet", str(repository)],
                check=True,
                capture_output=True,
                timeout=20,
            )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repository),
                    "fetch",
                    "--quiet",
                    "--depth=1",
                    GITHUB_REMOTE,
                    MAIN_REF,
                ],
                check=True,
                capture_output=True,
                timeout=120,
                env=git_environment(),
            )
            result = subprocess.run(
                ["git", "-C", str(repository), "rev-parse", "FETCH_HEAD"],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
            fetched_sha = result.stdout.strip()
            if fetched_sha != commit_sha:
                raise ReleaseValidationError(
                    "landing main changed while the release was being built"
                )
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(repository),
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
        yield archive_path


def read_release_request(request_path: Path) -> bytes:
    try:
        with tarfile.open(request_path, "r:gz") as archive:
            manifest_bytes = None
            for member_count, member in enumerate(archive, start=1):
                if member_count > MAX_ARCHIVE_MEMBERS:
                    raise ReleaseValidationError(
                        "release request contains too many members"
                    )
                normalized = normalize_archive_path(member.name)
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ReleaseValidationError(
                        f"release request contains unsafe member: {normalized}"
                    )
                if normalized != RELEASE_MANIFEST_PATH:
                    raise ReleaseValidationError(
                        f"release request contains unexpected file: {normalized}"
                    )
                if manifest_bytes is not None:
                    raise ReleaseValidationError(
                        "release request must contain one release.json"
                    )
                manifest_bytes = read_member(
                    archive,
                    member,
                    MAX_RELEASE_MANIFEST_SIZE_BYTES,
                )
    except (OSError, tarfile.TarError) as error:
        raise ReleaseValidationError(
            "release request is not a valid tar.gz"
        ) from error

    if manifest_bytes is None:
        raise ReleaseValidationError(
            "release request must contain one release.json"
        )
    return manifest_bytes


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
    parts = normalized.parts
    if normalized.is_absolute() or ".." in parts or not parts:
        raise ReleaseValidationError(f"unsafe archive path: {value}")
    return str(normalized)


def parse_json(content: bytes, path: str):
    try:
        return json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReleaseValidationError(f"invalid JSON in {path}") from error


def validate_release_manifest(manifest, catalog_bytes: bytes, commit_sha: str) -> None:
    expected_top_level = {"schema_version", "landing", "catalog", "operations"}
    if not isinstance(manifest, dict) or set(manifest) != expected_top_level:
        raise ReleaseValidationError("release manifest shape is invalid")
    if manifest["schema_version"] != RELEASE_SCHEMA_VERSION:
        raise ReleaseValidationError("release manifest schema version is invalid")

    expected_landing = {
        "repository": LANDING_REPOSITORY,
        "branch": "main",
        "commit_sha": commit_sha,
    }
    if manifest["landing"] != expected_landing:
        raise ReleaseValidationError("release manifest landing identity is invalid")

    catalog = parse_json(catalog_bytes, CATALOG_INDEX_PATH)
    if (
        not isinstance(catalog, dict)
        or catalog.get("schema_version") != CATALOG_SCHEMA_VERSION
        or not isinstance(catalog.get("catalog_version"), str)
    ):
        raise ReleaseValidationError("catalog index shape is invalid")
    catalog_manifest = manifest["catalog"]
    if (
        not isinstance(catalog_manifest, dict)
        or set(catalog_manifest) != {"version", "sha256"}
    ):
        raise ReleaseValidationError("release manifest catalog shape is invalid")
    if catalog_manifest["sha256"] != sha256(catalog_bytes).hexdigest():
        raise ReleaseValidationError(
            "release catalog SHA-256 does not match landing main"
        )
    if catalog_manifest["version"] != catalog["catalog_version"]:
        raise ReleaseValidationError(
            "release catalog version does not match landing main"
        )

    operations = read_operations_release()
    operations_catalog = operations["catalog"]
    if operations_catalog["sourceRepository"] != LANDING_REPOSITORY:
        raise ReleaseValidationError(
            "operations catalog source repository differs from landing"
        )
    if operations_catalog["sourceBaseSha"] != commit_sha:
        raise ReleaseValidationError(
            "operations catalog source SHA differs from landing main"
        )
    expected_operations = {
        "commit_sha": operations["operationsSha"],
        "catalog_sha256": operations_catalog["sha256"],
    }
    if manifest["operations"] != expected_operations:
        raise ReleaseValidationError("release manifest operations identity is stale")
    if catalog_manifest["sha256"] != operations_catalog["sha256"]:
        raise ReleaseValidationError("landing and operations catalog SHA-256 differ")
    if catalog_manifest["version"] != operations_catalog["version"]:
        raise ReleaseValidationError("landing and operations catalog versions differ")


def read_operations_release():
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
        with tempfile.SpooledTemporaryFile() as manifest_source:
            manifest_source.write(manifest_bytes)
            manifest_source.seek(0)
            destination.addfile(manifest_info, manifest_source)


def stream_archive(archive_path: Path, destination: BinaryIO) -> None:
    with archive_path.open("rb") as source:
        while chunk := source.read(READ_CHUNK_SIZE_BYTES):
            destination.write(chunk)
    destination.flush()


if __name__ == "__main__":
    raise SystemExit(main())
