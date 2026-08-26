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
        "sourceBaseSha": MAIN_SHA,
        "version": "landing-catalog.test123456789",
        "sha256": CATALOG_HASH,
    },
}


class PreviewReleaseGateTest(unittest.TestCase):
    def test_rejects_feature_branch_sha_before_reading_request(self):
        git_result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=f"{MAIN_SHA}\t{gate.MAIN_REF}\n", stderr=""
        )
        with patch.object(gate.subprocess, "run", return_value=git_result):
            with self.assertRaisesRegex(
                gate.ReleaseValidationError,
                "accepts only current landing main",
            ):
                gate.require_current_main_sha("c" * 40)

    def test_rejects_operations_catalog_pinned_to_another_landing_sha(self):
        operations = {
            **OPERATIONS_RELEASE,
            "catalog": {
                **OPERATIONS_RELEASE["catalog"],
                "sourceBaseSha": "c" * 40,
            },
        }
        manifest = build_manifest()
        with patch.object(gate, "read_operations_release", return_value=operations):
            with self.assertRaisesRegex(
                gate.ReleaseValidationError,
                "source SHA differs from landing main",
            ):
                gate.validate_release_manifest(manifest, CATALOG, MAIN_SHA)

    def test_rejects_catalog_hash_that_differs_from_landing_main(self):
        manifest = build_manifest(
            catalog={
                "version": "landing-catalog.test123456789",
                "sha256": "c" * 64,
            }
        )
        with patch.object(
            gate,
            "read_operations_release",
            return_value=OPERATIONS_RELEASE,
        ):
            with self.assertRaisesRegex(
                gate.ReleaseValidationError,
                "does not match landing main",
            ):
                gate.validate_release_manifest(manifest, CATALOG, MAIN_SHA)

    def test_builds_deploy_archive_only_from_trusted_main(self):
        source_archive = build_main_archive()
        request_archive = build_request_archive()
        output = temporary_path(".tar.gz")
        self.addCleanup(source_archive.unlink, missing_ok=True)
        self.addCleanup(request_archive.unlink, missing_ok=True)
        self.addCleanup(output.unlink, missing_ok=True)

        manifest_bytes = gate.read_release_request(request_archive)
        catalog_bytes = gate.inspect_main_archive(source_archive)
        with patch.object(
            gate,
            "read_operations_release",
            return_value=OPERATIONS_RELEASE,
        ):
            gate.validate_release_manifest(
                json.loads(manifest_bytes),
                catalog_bytes,
                MAIN_SHA,
            )
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
                build_manifest(),
            )
        self.assertNotIn(".github/workflows/deploy-preview.yml", names)

    def test_rejects_feature_payload_files_in_release_request(self):
        request_archive = build_request_archive(
            extra_members=(("index.html", b"feature branch"),)
        )
        self.addCleanup(request_archive.unlink, missing_ok=True)
        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "unexpected file: index.html",
        ):
            gate.read_release_request(request_archive)

    def test_rejects_links_in_main_archive(self):
        source_archive = build_main_archive(include_symlink=True)
        self.addCleanup(source_archive.unlink, missing_ok=True)
        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "unsafe member: linked-index.html",
        ):
            gate.inspect_main_archive(source_archive)

    def test_rejects_oversized_release_manifest(self):
        request_archive = build_request_archive(
            manifest_bytes=b"x" * (gate.MAX_RELEASE_MANIFEST_SIZE_BYTES + 1)
        )
        self.addCleanup(request_archive.unlink, missing_ok=True)
        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "release file exceeds size guardrail",
        ):
            gate.read_release_request(request_archive)

    def test_rejects_a_catalog_with_the_wrong_json_shape(self):
        catalog_bytes = b"[]"
        manifest = build_manifest(
            catalog={
                "version": "landing-catalog.test123456789",
                "sha256": sha256(catalog_bytes).hexdigest(),
            }
        )
        with self.assertRaisesRegex(
            gate.ReleaseValidationError,
            "catalog index shape is invalid",
        ):
            gate.validate_release_manifest(manifest, catalog_bytes, MAIN_SHA)


def build_manifest(catalog=None):
    return {
        "schema_version": gate.RELEASE_SCHEMA_VERSION,
        "landing": {
            "repository": gate.LANDING_REPOSITORY,
            "branch": "main",
            "commit_sha": MAIN_SHA,
        },
        "catalog": catalog
        or {
            "version": "landing-catalog.test123456789",
            "sha256": CATALOG_HASH,
        },
        "operations": {
            "commit_sha": OPERATIONS_SHA,
            "catalog_sha256": CATALOG_HASH,
        },
    }


def build_request_archive(manifest_bytes=None, extra_members=()):
    path = temporary_path(".tar.gz")
    content = manifest_bytes or json.dumps(build_manifest()).encode()
    with tarfile.open(path, "w:gz") as archive:
        add_bytes(archive, gate.RELEASE_MANIFEST_PATH, content)
        for name, member_content in extra_members:
            add_bytes(archive, name, member_content)
    return path


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


if __name__ == "__main__":
    unittest.main()
