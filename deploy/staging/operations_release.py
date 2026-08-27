"""Release candidate validation shared by staging deployment tests and runtime."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import NamedTuple
import json
import os
import re


LANDING_REPOSITORY = "monaxovdulov/landing-granit-static"
CATALOG_PATH = Path("apps/api/src/modules/ai/catalog/catalog-index.v1.json")
LANDING_CATALOG_PATH = Path("assets/catalog/catalog-index.v1.json")
PINNED_CATALOG_PATH = Path(
    "apps/api/src/modules/ai/catalog/pinned-catalog-index.ts"
)
DOCKERFILE_PATH = Path("deploy/staging/Dockerfile.operations")
CATALOG_SCHEMA_VERSION = "catalog-index.v1"
MAX_RELEASE_FILES = 4096
MAX_RELEASE_BYTES = 256 * 1024 * 1024


class DeploymentError(Exception):
    pass


class ReleaseCandidate(NamedTuple):
    root: Path
    catalog_version: str
    catalog_sha256: str


def validate_commit_sha(value: object) -> None:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise DeploymentError(
            "commit SHA must be exactly 40 lowercase hex characters"
        )


def validate_image_id(image_id: str, message: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise DeploymentError(message)


def load_release_candidate(root: Path) -> ReleaseCandidate:
    require_safe_release_tree(root)
    catalog_path = root / CATALOG_PATH
    metadata_path = root / PINNED_CATALOG_PATH
    dockerfile_path = root / DOCKERFILE_PATH
    for required_path in (catalog_path, metadata_path, dockerfile_path):
        if not required_path.is_file():
            raise DeploymentError(f"required release file is missing: {required_path}")

    catalog_bytes = catalog_path.read_bytes()
    catalog = parse_catalog(catalog_bytes)
    metadata = metadata_path.read_text(encoding="utf-8")
    repository = read_typescript_string_constant(
        metadata, "PINNED_CATALOG_SOURCE_REPOSITORY"
    )
    version = read_typescript_string_constant(metadata, "PINNED_CATALOG_VERSION")
    expected_hash = read_typescript_string_constant(
        metadata, "PINNED_CATALOG_CONTENT_HASH"
    )
    actual_hash = sha256(catalog_bytes).hexdigest()
    if repository != LANDING_REPOSITORY:
        raise DeploymentError("pinned catalog repository differs from landing")
    if version != catalog["catalog_version"]:
        raise DeploymentError("pinned catalog version differs from catalog index")
    if expected_hash != actual_hash:
        raise DeploymentError("pinned catalog SHA-256 differs from catalog index")
    return ReleaseCandidate(root, version, actual_hash)


def validate_catalog_pair(candidate: ReleaseCandidate, landing_bytes: bytes) -> None:
    landing = parse_catalog(landing_bytes)
    landing_hash = sha256(landing_bytes).hexdigest()
    if landing_hash != candidate.catalog_sha256:
        raise DeploymentError("operations and landing catalog SHA-256 differ")
    if landing["catalog_version"] != candidate.catalog_version:
        raise DeploymentError("operations and landing catalog versions differ")


def parse_catalog(content: bytes) -> dict:
    try:
        catalog = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeploymentError("catalog index is invalid JSON") from error
    if (
        not isinstance(catalog, dict)
        or catalog.get("schema_version") != CATALOG_SCHEMA_VERSION
        or not isinstance(catalog.get("catalog_version"), str)
        or not isinstance(catalog.get("items"), list)
        or not catalog["items"]
    ):
        raise DeploymentError("catalog index shape is invalid")
    return catalog


def read_typescript_string_constant(source: str, name: str) -> str:
    pattern = re.compile(
        rf'export const {re.escape(name)}\s*=\s*"([^"\n]+)"\s+as const;'
    )
    matches = pattern.findall(source)
    if len(matches) != 1:
        raise DeploymentError(f"cannot read exact {name} metadata")
    return matches[0]


def require_safe_release_tree(root: Path) -> None:
    file_count = 0
    total_bytes = 0
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(directory)
        if current == root:
            directory_names[:] = [name for name in directory_names if name != ".git"]
        for name in (*directory_names, *file_names):
            path = current / name
            if path.is_symlink():
                raise DeploymentError(f"release tree contains a symbolic link: {path}")
        for name in file_names:
            file_count += 1
            total_bytes += (current / name).stat().st_size
            if file_count > MAX_RELEASE_FILES or total_bytes > MAX_RELEASE_BYTES:
                raise DeploymentError("release tree exceeds size guardrails")
