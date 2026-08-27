#!/usr/bin/env python3
"""Deploy exact operations main to staging and fail closed on release drift."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator
from urllib.request import urlopen
import fcntl
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time

from operations_release import (
    CATALOG_PATH,
    DOCKERFILE_PATH,
    LANDING_CATALOG_PATH,
    LANDING_REPOSITORY,
    DeploymentError,
    ReleaseCandidate,
    load_release_candidate,
    validate_catalog_pair,
    validate_commit_sha,
    validate_image_id,
)


OPERATIONS_REPOSITORY = "monaxovdulov/granit-operations"
MAIN_REF = "refs/heads/main"
CACHED_MAIN_REF = "refs/remotes/release-gate/main"
IMAGE_REPOSITORY = "granit-staging-ops-api"
ACTIVE_IMAGE = f"{IMAGE_REPOSITORY}:latest"
RUNTIME_ROOT = Path("/srv/botops")
RELEASE_ROOT = RUNTIME_ROOT / "releases/operations"
OPERATIONS_CACHE = RUNTIME_ROOT / "repos/granit-operations.git"
LANDING_CACHE = RUNTIME_ROOT / "repos/landing-granit-static.git"
COMPOSE_FILE = RUNTIME_ROOT / "compose.yml"
COMPOSE_ENV_FILE = RUNTIME_ROOT / ".env.runtime"
DEPLOY_LOCK = RUNTIME_ROOT / "deploy-operations.lock"
LOCAL_HEALTH_URL = "http://127.0.0.1:3101/health"
PUBLIC_HEALTH_URL = "https://manager.botops.ru/health"
KNOWN_HOSTS = "/home/devuser/.ssh/known_hosts"
OPERATIONS_DEPLOY_KEY = "/home/devuser/.ssh/operations-main-readonly_ed25519"
LANDING_DEPLOY_KEY = "/home/devuser/.ssh/landing-main-readonly_ed25519"
OPERATIONS_REMOTE = f"git@github.com:{OPERATIONS_REPOSITORY}.git"
LANDING_REMOTE = f"git@github.com:{LANDING_REPOSITORY}.git"
COMPOSE_UP_COMMAND = (
    "docker",
    "compose",
    "--env-file",
    str(COMPOSE_ENV_FILE),
    "-f",
    str(COMPOSE_FILE),
    "up",
    "-d",
    "--no-deps",
    "--force-recreate",
    "ops-api",
)


class CommandRunner:
    def run(
        self,
        arguments: tuple[str, ...] | list[str],
        *,
        timeout: int = 300,
        env: dict[str, str] | None = None,
    ) -> str:
        try:
            result = subprocess.run(
                arguments,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise DeploymentError(f"command failed: {arguments[0]}") from error
        return result.stdout

    def read_bytes(
        self,
        arguments: tuple[str, ...] | list[str],
        *,
        timeout: int = 60,
    ) -> bytes:
        try:
            result = subprocess.run(
                arguments,
                check=True,
                capture_output=True,
                timeout=timeout,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise DeploymentError(f"command failed: {arguments[0]}") from error
        return result.stdout


def main() -> int:
    if len(sys.argv) != 2:
        print("ERROR: expected exact operations commit SHA", file=sys.stderr)
        return 64

    commit_sha = sys.argv[1]
    runner = CommandRunner()
    try:
        validate_commit_sha(commit_sha)
        with deployment_lock():
            deploy_current_main(commit_sha, runner)
    except DeploymentError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def deploy_current_main(commit_sha: str, runner: CommandRunner) -> None:
    require_current_main(commit_sha, OPERATIONS_REMOTE, OPERATIONS_DEPLOY_KEY, runner)
    fetch_main(OPERATIONS_CACHE, OPERATIONS_REMOTE, OPERATIONS_DEPLOY_KEY, runner)
    release_root = materialize_release(commit_sha, runner)
    candidate = load_release_candidate(release_root)

    landing_sha = resolve_current_main(LANDING_REMOTE, LANDING_DEPLOY_KEY, runner)
    fetch_main(LANDING_CACHE, LANDING_REMOTE, LANDING_DEPLOY_KEY, runner)
    landing_catalog = read_git_file(
        LANDING_CACHE, landing_sha, LANDING_CATALOG_PATH, runner
    )
    validate_catalog_pair(candidate, landing_catalog)
    require_current_main(commit_sha, OPERATIONS_REMOTE, OPERATIONS_DEPLOY_KEY, runner)
    require_current_main(landing_sha, LANDING_REMOTE, LANDING_DEPLOY_KEY, runner)
    require_compose_image(runner)

    candidate_image = f"{IMAGE_REPOSITORY}:sha-{commit_sha}"
    candidate_image_id = build_candidate_image(
        candidate, commit_sha, candidate_image, runner
    )
    require_current_main(commit_sha, OPERATIONS_REMOTE, OPERATIONS_DEPLOY_KEY, runner)
    require_current_main(landing_sha, LANDING_REMOTE, LANDING_DEPLOY_KEY, runner)
    previous_image_id = inspect_running_image(runner)

    def require_release_still_current() -> None:
        require_current_main(
            commit_sha, OPERATIONS_REMOTE, OPERATIONS_DEPLOY_KEY, runner
        )
        require_current_main(landing_sha, LANDING_REMOTE, LANDING_DEPLOY_KEY, runner)

    activate_candidate(
        candidate_sha=commit_sha,
        candidate_image=candidate_image,
        candidate_image_id=candidate_image_id,
        previous_image_id=previous_image_id,
        runner=runner,
        read_health=read_health,
        post_smoke_check=require_release_still_current,
    )
    print(
        json.dumps(
            {
                "event": "staging_operations_deployed",
                "operations_sha": commit_sha,
                "landing_sha": landing_sha,
                "catalog_sha256": candidate.catalog_sha256,
            },
            sort_keys=True,
        )
    )


def resolve_current_main(remote: str, deploy_key: str, runner: CommandRunner) -> str:
    output = runner.run(
        ("git", "ls-remote", remote, MAIN_REF),
        timeout=30,
        env=git_environment(deploy_key),
    )
    fields = output.strip().split()
    if len(fields) != 2 or fields[1] != MAIN_REF:
        raise DeploymentError("cannot resolve current main SHA")
    validate_commit_sha(fields[0])
    return fields[0]


def require_current_main(
    expected_sha: str,
    remote: str,
    deploy_key: str,
    runner: CommandRunner,
) -> None:
    actual_sha = resolve_current_main(remote, deploy_key, runner)
    if actual_sha != expected_sha:
        raise DeploymentError(
            f"deploy accepts only current main; requested={expected_sha}, actual={actual_sha}"
        )


def fetch_main(
    cache: Path,
    remote: str,
    deploy_key: str,
    runner: CommandRunner,
) -> None:
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists():
        runner.run(("git", "init", "--bare", "--quiet", str(cache)))
    runner.run(
        (
            "git",
            "--git-dir",
            str(cache),
            "fetch",
            "--quiet",
            "--force",
            "--depth=1",
            remote,
            f"{MAIN_REF}:{CACHED_MAIN_REF}",
        ),
        timeout=300,
        env=git_environment(deploy_key),
    )


def materialize_release(commit_sha: str, runner: CommandRunner) -> Path:
    release_root = RELEASE_ROOT / commit_sha
    RELEASE_ROOT.mkdir(parents=True, exist_ok=True)
    if release_root.exists():
        current_sha = runner.run(
            ("git", "-C", str(release_root), "rev-parse", "HEAD")
        ).strip()
        dirty = runner.run(
            ("git", "-C", str(release_root), "status", "--porcelain")
        ).strip()
        if current_sha != commit_sha or dirty:
            raise DeploymentError("existing release checkout is not immutable")
        return release_root

    temporary = Path(tempfile.mkdtemp(prefix=f".{commit_sha}-", dir=RELEASE_ROOT))
    try:
        runner.run(("git", "init", "--quiet", str(temporary)))
        runner.run(
            (
                "git",
                "-C",
                str(temporary),
                "fetch",
                "--quiet",
                "--depth=1",
                str(OPERATIONS_CACHE),
                CACHED_MAIN_REF,
            ),
            timeout=300,
        )
        runner.run(
            ("git", "-C", str(temporary), "checkout", "--quiet", "--detach", commit_sha)
        )
        temporary.rename(release_root)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return release_root


def read_git_file(
    cache: Path, commit_sha: str, relative_path: Path, runner: CommandRunner
) -> bytes:
    validate_commit_sha(commit_sha)
    return runner.read_bytes(
        (
            "git",
            "--git-dir",
            str(cache),
            "show",
            f"{commit_sha}:{relative_path.as_posix()}",
        )
    )


def git_environment(deploy_key: str) -> dict[str, str]:
    ssh_command = " ".join(
        (
            "ssh", "-i", deploy_key,
            "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes",
            "-o", f"UserKnownHostsFile={KNOWN_HOSTS}",
        )
    )
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "GIT_SSH_COMMAND": ssh_command,
    }


def require_compose_image(runner: CommandRunner) -> None:
    source = runner.run(
        (
            "docker",
            "compose",
            "--env-file",
            str(COMPOSE_ENV_FILE),
            "-f",
            str(COMPOSE_FILE),
            "config",
            "--format",
            "json",
        )
    )
    try:
        config = json.loads(source)
        service = config["services"]["ops-api"]
        image = service["image"]
        environment = service.get("environment", {})
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise DeploymentError("cannot verify staging ops-api Compose contract") from error
    if image != ACTIVE_IMAGE:
        raise DeploymentError(
            f"staging ops-api image must be exactly {ACTIVE_IMAGE}"
        )
    runtime_overrides = (
        "build", "command", "configs", "entrypoint", "secrets", "volumes",
        "working_dir",
    )
    if any(service.get(field) is not None for field in runtime_overrides):
        raise DeploymentError("staging ops-api Compose runtime override is forbidden")
    if not isinstance(environment, dict):
        raise DeploymentError("staging ops-api Compose environment is invalid")
    if "OPERATIONS_RELEASE_SHA" in environment:
        raise DeploymentError("staging Compose must not override the image release SHA")


def build_candidate_image(
    candidate: ReleaseCandidate,
    commit_sha: str,
    candidate_image: str,
    runner: CommandRunner,
) -> str:
    runner.run(
        (
            "docker",
            "build",
            "--pull=false",
            "--build-arg",
            f"OPERATIONS_RELEASE_SHA={commit_sha}",
            "--label",
            f"org.opencontainers.image.revision={commit_sha}",
            "--tag",
            candidate_image,
            "--file",
            str(candidate.root / DOCKERFILE_PATH),
            str(candidate.root),
        ),
        timeout=1800,
    )
    metadata = runner.run(
        ("docker", "image", "inspect", candidate_image, "--format", "{{json .Config}}")
    )
    try:
        config = json.loads(metadata)
        labels = config["Labels"]
        environment = config["Env"]
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise DeploymentError("cannot inspect candidate image metadata") from error
    if labels.get("org.opencontainers.image.revision") != commit_sha:
        raise DeploymentError("candidate image revision label differs from commit SHA")
    if f"OPERATIONS_RELEASE_SHA={commit_sha}" not in environment:
        raise DeploymentError("candidate image does not contain exact release SHA")
    image_id = runner.run(
        ("docker", "image", "inspect", candidate_image, "--format", "{{.Id}}")
    ).strip()
    validate_image_id(image_id, "candidate image ID is unavailable")
    return image_id


def inspect_running_image(runner: CommandRunner) -> str:
    container_id = runner.run(
        (
            "docker",
            "compose",
            "--env-file",
            str(COMPOSE_ENV_FILE),
            "-f",
            str(COMPOSE_FILE),
            "ps",
            "--quiet",
            "ops-api",
        )
    ).strip()
    if not re.fullmatch(r"[0-9a-f]{12,64}", container_id):
        raise DeploymentError("running staging ops-api container is unavailable")
    image_id = runner.run(
        ("docker", "inspect", container_id, "--format", "{{.Image}}")
    ).strip()
    validate_image_id(image_id, "running staging ops-api image ID is unavailable")
    return image_id


def inspect_image_revision(image_id: str, runner: CommandRunner) -> str:
    validate_image_id(image_id, "staging image ID is unavailable")
    revision = runner.run(
        ("docker", "image", "inspect", image_id, "--format",
         '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    ).strip()
    validate_commit_sha(revision)
    return revision


def activate_candidate(
    *,
    candidate_sha: str,
    candidate_image: str,
    candidate_image_id: str,
    previous_image_id: str,
    runner,
    read_health: Callable,
    post_smoke_check: Callable[[], None] = lambda: None,
    inspect_running: Callable = inspect_running_image,
    read_image_revision: Callable = inspect_image_revision,
) -> None:
    previous = read_health(LOCAL_HEALTH_URL)
    previous_sha = read_operations_sha(previous)
    read_health(PUBLIC_HEALTH_URL, previous_sha)
    if read_image_revision(previous_image_id, runner) != previous_sha:
        raise DeploymentError("running staging image revision differs from health SHA")
    runner.run(("docker", "tag", candidate_image, ACTIVE_IMAGE))
    try:
        runner.run(COMPOSE_UP_COMMAND, timeout=300)
        read_health(LOCAL_HEALTH_URL, candidate_sha)
        read_health(PUBLIC_HEALTH_URL, candidate_sha)
        if inspect_running(runner) != candidate_image_id:
            raise DeploymentError("running candidate image differs from built image")
        post_smoke_check()
    except Exception as candidate_error:
        try:
            runner.run(("docker", "tag", previous_image_id, ACTIVE_IMAGE))
            runner.run(COMPOSE_UP_COMMAND, timeout=300)
            read_health(LOCAL_HEALTH_URL, previous_sha)
            read_health(PUBLIC_HEALTH_URL, previous_sha)
            if inspect_running(runner) != previous_image_id:
                raise DeploymentError("running rollback image differs from previous image")
        except Exception as rollback_error:
            raise DeploymentError(
                "candidate failed and automatic rollback did not recover previous staging"
            ) from rollback_error
        if isinstance(candidate_error, DeploymentError):
            raise candidate_error
        raise DeploymentError("candidate staging smoke failed") from candidate_error


def read_health(url: str, expected_sha: str | None = None) -> dict:
    last_error: Exception | None = None
    for _attempt in range(20):
        try:
            with urlopen(url, timeout=10) as response:
                health = json.load(response)
            actual_sha = read_operations_sha(health)
            if expected_sha is not None and actual_sha != expected_sha:
                raise DeploymentError(
                    f"health deployed SHA differs: expected={expected_sha}, actual={actual_sha}"
                )
            return health
        except (OSError, ValueError, DeploymentError) as error:
            last_error = error
            time.sleep(3)
    raise DeploymentError(f"staging health is unavailable: {url}") from last_error


def read_operations_sha(health: object) -> str:
    if not isinstance(health, dict):
        raise DeploymentError("staging health payload is invalid")
    release = health.get("release")
    operations_sha = release.get("operationsSha") if isinstance(release, dict) else None
    validate_commit_sha(operations_sha)
    if health.get("ok") is not True or health.get("service") != "granit-operations-api":
        raise DeploymentError("staging health payload is invalid")
    return operations_sha


@contextmanager
def deployment_lock() -> Iterator[None]:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        with DEPLOY_LOCK.open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise DeploymentError(
                    "another operations deploy is already in progress"
                ) from error
            yield
    except DeploymentError:
        raise
    except OSError as error:
        raise DeploymentError("operations deploy lock is unavailable") from error

if __name__ == "__main__":
    raise SystemExit(main())
