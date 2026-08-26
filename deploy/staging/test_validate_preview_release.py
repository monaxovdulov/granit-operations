from __future__ import annotations

from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO
from pathlib import Path
import json
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("validate_preview_release.py")
SPEC = spec_from_file_location("validate_preview_release", MODULE_PATH)
assert SPEC and SPEC.loader
gate = module_from_spec(SPEC)
SPEC.loader.exec_module(gate)

MAIN_SHA = "a" * 40
OPERATIONS_SHA = "b" * 40
CATALOG = json.dumps(
    {
        "schema_version": gate.CATALOG_SCHEMA_VERSION,
        "catalog_version": "landing-catalog.test123456789",
        "items": [],
    },
    separators=(",", ":"),
).encode()
CATALOG_HASH = sha256(CATALOG).hexdigest()
OPERATIONS_RELEASE = {
    "schemaVersion": gate.OPERATIONS_SCHEMA_VERSION,
    "operationsSha": OPERATIONS_SHA,
    "catalog": {
        "sourceRepository": gate.LANDING_REPOSITORY,
        "sourceBaseSha": "c" * 40,
        "version": "landing-catalog.test123456789",
        "sha256": CATALOG_HASH,
    },
}


class PreviewReleaseGateTest(unittest.TestCase):
    def test_rejects_a_sha_that_is_not_current_main(self):
        git_result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=f"{MAIN_SHA}\t{gate.MAIN_REF}\n", stderr=""
        )
        with patch.object(gate.subprocess, "run", return_value=git_result):
            with self.assertRaisesRegex(
                gate.ReleaseValidationError,
                "accepts only current landing main",
            ):
                gate.require_current_main_sha("d" * 40)

    def test_accepts_a_new_landing_sha_when_catalog_is_unchanged(self):
        manifest = json.loads(
            gate.build_release_manifest(
                MAIN_SHA,
                CATALOG,
                OPERATIONS_RELEASE,
            )
        )

        self.assertEqual(manifest, expected_manifest())
        self.assertNotEqual(
            manifest["landing"]["commit_sha"],
            OPERATIONS_RELEASE["catalog"]["sourceBaseSha"],
        )

    def test_rejects_a_catalog_hash_that_differs_from_backend(self):
        operations = {
            **OPERATIONS_RELEASE,
            "catalog": {
                **OPERATIONS_RELEASE["catalog"],
                "sha256": "d" * 64,
            },
        }

        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "catalog SHA-256 differ",
        ):
            gate.build_release_manifest(MAIN_SHA, CATALOG, operations)

    def test_builds_deploy_archive_only_from_trusted_main(self):
        source_archive = build_main_archive()
        output = temporary_path(".tar.gz")
        self.addCleanup(source_archive.unlink, missing_ok=True)
        self.addCleanup(output.unlink, missing_ok=True)
        manifest_bytes = gate.build_release_manifest(
            MAIN_SHA,
            CATALOG,
            OPERATIONS_RELEASE,
        )

        gate.inspect_main_archive(source_archive)
        gate.write_release_archive(source_archive, manifest_bytes, output)

        with tarfile.open(output, "r:gz") as archive:
            names = set(archive.getnames())
            self.assertEqual(archive.extractfile("index.html").read(), b"trusted main")
            self.assertEqual(
                archive.extractfile(gate.CATALOG_INDEX_PATH).read(),
                CATALOG,
            )
            self.assertEqual(
                json.load(archive.extractfile(gate.RELEASE_MANIFEST_PATH)),
                expected_manifest(),
            )
        self.assertNotIn(".github/workflows/deploy-preview.yml", names)

    def test_fetches_main_into_the_preinitialized_server_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, commit_sha = build_git_source(root)
            repository = root / "release-cache.git"
            run_git("init", "--bare", "--quiet", str(repository))

            with (
                patch.object(gate, "GITHUB_REMOTE", str(source)),
                patch.object(gate, "REPOSITORY_PATH", repository, create=True),
                gate.fetch_main_archive(commit_sha) as archive,
            ):
                self.assertEqual(gate.inspect_main_archive(archive), CATALOG)

            cached_sha = run_git(
                "--git-dir",
                str(repository),
                "rev-parse",
                gate.CACHED_MAIN_REF,
                capture_output=True,
                text=True,
            ).stdout.strip()
            self.assertEqual(cached_sha, commit_sha)

    def test_rejects_links_in_main_archive(self):
        source_archive = build_main_archive(include_symlink=True)
        self.addCleanup(source_archive.unlink, missing_ok=True)

        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "unsafe member: linked-index.html",
        ):
            gate.inspect_main_archive(source_archive)

    def test_rejects_a_catalog_with_the_wrong_json_shape(self):
        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "catalog index shape is invalid",
        ):
            gate.build_release_manifest(MAIN_SHA, b"[]", OPERATIONS_RELEASE)


def expected_manifest():
    return {
        "schema_version": gate.RELEASE_SCHEMA_VERSION,
        "landing": {
            "repository": gate.LANDING_REPOSITORY,
            "branch": "main",
            "commit_sha": MAIN_SHA,
        },
        "catalog": {
            "version": "landing-catalog.test123456789",
            "sha256": CATALOG_HASH,
        },
        "operations": {
            "commit_sha": OPERATIONS_SHA,
            "catalog_sha256": CATALOG_HASH,
        },
    }


def build_main_archive(include_symlink=False):
    path = temporary_path(".tar")
    with tarfile.open(path, "w:") as archive:
        add_bytes(archive, "index.html", b"trusted main")
        add_bytes(archive, gate.CATALOG_INDEX_PATH, CATALOG)
        add_bytes(
            archive,
            ".github/workflows/deploy-preview.yml",
            b"not deployed",
        )
        if include_symlink:
            info = tarfile.TarInfo("linked-index.html")
            info.type = tarfile.SYMTYPE
            info.linkname = "index.html"
            archive.addfile(info)
    return path


def temporary_path(suffix):
    temporary = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    temporary.close()
    return Path(temporary.name)


def add_bytes(archive, name, content):
    info = tarfile.TarInfo(name=name)
    info.size = len(content)
    archive.addfile(info, BytesIO(content))


def build_git_source(root):
    worktree = root / "source"
    source = root / "source.git"
    run_git("init", "--quiet", "--initial-branch=main", str(worktree))
    run_git("-C", str(worktree), "config", "user.name", "Release Gate Test")
    run_git("-C", str(worktree), "config", "user.email", "gate@example.invalid")
    (worktree / "assets/catalog").mkdir(parents=True)
    (worktree / "index.html").write_bytes(b"trusted main")
    (worktree / gate.CATALOG_INDEX_PATH).write_bytes(CATALOG)
    run_git("-C", str(worktree), "add", ".")
    run_git("-C", str(worktree), "commit", "--quiet", "-m", "fixture")
    commit_sha = run_git(
        "-C",
        str(worktree),
        "rev-parse",
        "HEAD",
        capture_output=True,
        text=True,
    ).stdout.strip()
    run_git("clone", "--bare", "--quiet", str(worktree), str(source))
    return source, commit_sha


def run_git(*arguments, **options):
    return subprocess.run(["git", *arguments], check=True, **options)


if __name__ == "__main__":
    unittest.main()
