from __future__ import annotations

from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("deploy_operations_staging.py")
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = spec_from_file_location("deploy_operations_staging", MODULE_PATH)
assert SPEC and SPEC.loader
deploy = module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)

OPERATIONS_SHA = "a" * 40
PREVIOUS_SHA = "b" * 40
CANDIDATE_IMAGE_ID = "sha256:" + "3" * 64
PREVIOUS_IMAGE_ID = "sha256:" + "2" * 64
CATALOG = json.dumps(
    {
        "schema_version": "catalog-index.v1",
        "catalog_version": "landing-catalog.test123456789",
        "items": [{"id": "ent_1234567890abcdef"}],
    },
    separators=(",", ":"),
).encode()
CATALOG_HASH = sha256(CATALOG).hexdigest()


class OperationsReleaseValidationTest(unittest.TestCase):
    def test_rejects_an_invalid_commit_sha(self):
        with self.assertRaisesRegex(deploy.DeploymentError, "exactly 40"):
            deploy.validate_commit_sha("main")

    def test_accepts_only_a_catalog_matching_landing_main(self):
        with tempfile.TemporaryDirectory() as directory:
            root = build_candidate(Path(directory))

            candidate = deploy.load_release_candidate(root)
            deploy.validate_catalog_pair(candidate, CATALOG)

            self.assertEqual(candidate.catalog_version, "landing-catalog.test123456789")
            self.assertEqual(candidate.catalog_sha256, CATALOG_HASH)

    def test_rejects_a_catalog_that_differs_from_landing_main(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate = deploy.load_release_candidate(build_candidate(Path(directory)))
            different_catalog = json.dumps(
                {
                    "schema_version": "catalog-index.v1",
                    "catalog_version": "landing-catalog.test123456789",
                    "items": [{"id": "ent_fedcba0987654321"}],
                },
                separators=(",", ":"),
            ).encode()

            with self.assertRaisesRegex(deploy.DeploymentError, "catalog SHA-256"):
                deploy.validate_catalog_pair(candidate, different_catalog)

    def test_rejects_symbolic_links_before_building_untrusted_main(self):
        with tempfile.TemporaryDirectory() as directory:
            root = build_candidate(Path(directory))
            (root / "linked-catalog.json").symlink_to(
                root / "apps/api/src/modules/ai/catalog/catalog-index.v1.json"
            )

            with self.assertRaisesRegex(deploy.DeploymentError, "symbolic link"):
                deploy.load_release_candidate(root)

    def test_rejects_a_commit_that_is_no_longer_current_main(self):
        runner = StaticOutputRunner(f"{OPERATIONS_SHA}\t{deploy.MAIN_REF}\n")

        deploy.require_current_main(
            OPERATIONS_SHA, "local-remote", "unused-key", runner
        )
        with self.assertRaisesRegex(deploy.DeploymentError, "only current main"):
            deploy.require_current_main(
                "d" * 40, "local-remote", "unused-key", runner
            )

    def test_accepts_only_an_immutable_compose_runtime_contract(self):
        service = {
            "image": deploy.ACTIVE_IMAGE,
            "environment": {"DEPLOYMENT_TIER": "staging"},
        }
        deploy.require_compose_image(
            StaticOutputRunner(json.dumps({"services": {"ops-api": service}}))
        )

        unsafe_overrides = {
            "build": {"context": "/tmp/unreviewed"},
            "command": ["node", "/tmp/unreviewed.js"],
            "entrypoint": ["/tmp/unreviewed"],
            "volumes": [{"source": "/tmp", "target": "/app"}],
            "configs": [{"source": "runtime", "target": "/app/runtime.js"}],
            "secrets": [{"source": "runtime", "target": "/app/runtime.js"}],
            "working_dir": "/tmp",
        }
        for field, value in unsafe_overrides.items():
            with self.subTest(field=field):
                unsafe = service | {field: value}
                with self.assertRaisesRegex(
                    deploy.DeploymentError, "runtime override"
                ):
                    deploy.require_compose_image(
                        StaticOutputRunner(
                            json.dumps({"services": {"ops-api": unsafe}})
                        )
                    )

        release_override = service | {
            "environment": {"OPERATIONS_RELEASE_SHA": PREVIOUS_SHA}
        }
        with self.assertRaisesRegex(deploy.DeploymentError, "release SHA"):
            deploy.require_compose_image(
                StaticOutputRunner(
                    json.dumps({"services": {"ops-api": release_override}})
                )
            )

    def test_rolls_back_the_active_image_when_candidate_smoke_fails(self):
        runner = RecordingRunner()
        health = HealthSequence(
            [
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                deploy.DeploymentError("candidate health is red"),
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
            ]
        )

        with self.assertRaisesRegex(deploy.DeploymentError, "candidate health is red"):
            deploy.activate_candidate(
                candidate_sha=OPERATIONS_SHA,
                candidate_image="granit-staging-ops-api:sha-" + OPERATIONS_SHA,
                candidate_image_id=CANDIDATE_IMAGE_ID,
                previous_image_id=PREVIOUS_IMAGE_ID,
                runner=runner,
                read_health=health,
                inspect_running=StaticCallable(PREVIOUS_IMAGE_ID),
                read_image_revision=StaticCallable(PREVIOUS_SHA),
            )

        self.assertEqual(
            runner.commands,
            [
                ("docker", "tag", "granit-staging-ops-api:sha-" + OPERATIONS_SHA, "granit-staging-ops-api:latest"),
                deploy.COMPOSE_UP_COMMAND,
                ("docker", "tag", PREVIOUS_IMAGE_ID, "granit-staging-ops-api:latest"),
                deploy.COMPOSE_UP_COMMAND,
            ],
        )

    def test_rolls_back_when_compose_cannot_start_the_candidate(self):
        runner = FailFirstComposeRunner()
        health = HealthSequence(
            [
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
            ]
        )

        with self.assertRaisesRegex(deploy.DeploymentError, "compose start failed"):
            deploy.activate_candidate(
                candidate_sha=OPERATIONS_SHA,
                candidate_image="granit-staging-ops-api:sha-" + OPERATIONS_SHA,
                candidate_image_id=CANDIDATE_IMAGE_ID,
                previous_image_id=PREVIOUS_IMAGE_ID,
                runner=runner,
                read_health=health,
                inspect_running=StaticCallable(PREVIOUS_IMAGE_ID),
                read_image_revision=StaticCallable(PREVIOUS_SHA),
            )

        self.assertEqual(
            runner.commands[-2:],
            [
                ("docker", "tag", PREVIOUS_IMAGE_ID, "granit-staging-ops-api:latest"),
                deploy.COMPOSE_UP_COMMAND,
            ],
        )

    def test_accepts_only_the_exact_built_candidate_image_after_smoke(self):
        runner = RecordingRunner()
        health = HealthSequence(
            [
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                release_health(OPERATIONS_SHA),
                release_health(OPERATIONS_SHA),
            ]
        )

        deploy.activate_candidate(
            candidate_sha=OPERATIONS_SHA,
            candidate_image="granit-staging-ops-api:sha-" + OPERATIONS_SHA,
            candidate_image_id=CANDIDATE_IMAGE_ID,
            previous_image_id=PREVIOUS_IMAGE_ID,
            runner=runner,
            read_health=health,
            inspect_running=StaticCallable(CANDIDATE_IMAGE_ID),
            read_image_revision=StaticCallable(PREVIOUS_SHA),
        )

        self.assertEqual(runner.commands[-1], deploy.COMPOSE_UP_COMMAND)

    def test_rolls_back_when_running_candidate_differs_from_built_image(self):
        runner = RecordingRunner()
        health = HealthSequence(
            [
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                release_health(OPERATIONS_SHA),
                release_health(OPERATIONS_SHA),
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
            ]
        )
        wrong_image_id = "sha256:" + "4" * 64

        with self.assertRaisesRegex(
            deploy.DeploymentError, "running candidate image differs"
        ):
            deploy.activate_candidate(
                candidate_sha=OPERATIONS_SHA,
                candidate_image="granit-staging-ops-api:sha-" + OPERATIONS_SHA,
                candidate_image_id=CANDIDATE_IMAGE_ID,
                previous_image_id=PREVIOUS_IMAGE_ID,
                runner=runner,
                read_health=health,
                inspect_running=SequenceCallable(
                    [wrong_image_id, PREVIOUS_IMAGE_ID]
                ),
                read_image_revision=StaticCallable(PREVIOUS_SHA),
            )

        self.assertEqual(
            runner.commands[-2:],
            [
                ("docker", "tag", PREVIOUS_IMAGE_ID, deploy.ACTIVE_IMAGE),
                deploy.COMPOSE_UP_COMMAND,
            ],
        )

    def test_reports_failed_recovery_when_rollback_runs_the_wrong_image(self):
        runner = RecordingRunner()
        health = HealthSequence(
            [
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
                deploy.DeploymentError("candidate health is red"),
                release_health(PREVIOUS_SHA),
                release_health(PREVIOUS_SHA),
            ]
        )

        with self.assertRaisesRegex(
            deploy.DeploymentError, "automatic rollback did not recover"
        ):
            deploy.activate_candidate(
                candidate_sha=OPERATIONS_SHA,
                candidate_image="granit-staging-ops-api:sha-" + OPERATIONS_SHA,
                candidate_image_id=CANDIDATE_IMAGE_ID,
                previous_image_id=PREVIOUS_IMAGE_ID,
                runner=runner,
                read_health=health,
                inspect_running=StaticCallable("sha256:" + "5" * 64),
                read_image_revision=StaticCallable(PREVIOUS_SHA),
            )

    def test_materializes_the_exact_fetched_main_as_a_clean_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, commit_sha = build_git_remote(root)
            cache = root / "cache.git"
            releases = root / "releases"
            runner = deploy.CommandRunner()

            deploy.fetch_main(cache, str(remote), "unused-local-key", runner)
            with (
                patch.object(deploy, "OPERATIONS_CACHE", cache),
                patch.object(deploy, "RELEASE_ROOT", releases),
            ):
                release = deploy.materialize_release(commit_sha, runner)
                repeated = deploy.materialize_release(commit_sha, runner)

            self.assertEqual(release, repeated)
            self.assertEqual((release / "marker.txt").read_text(), "trusted main\n")
            self.assertEqual(
                run_git("-C", str(release), "status", "--porcelain").stdout,
                "",
            )
            self.assertEqual(
                deploy.read_git_file(
                    cache,
                    commit_sha,
                    deploy.LANDING_CATALOG_PATH,
                    runner,
                ),
                CATALOG,
            )

    def test_rollback_image_comes_from_the_running_container_not_latest_tag(self):
        runner = OutputSequenceRunner(
            ["1" * 64 + "\n", "sha256:" + "2" * 64 + "\n"]
        )

        image_id = deploy.inspect_running_image(runner)

        self.assertEqual(image_id, "sha256:" + "2" * 64)
        self.assertEqual(runner.commands[0][-3:], ("ps", "--quiet", "ops-api"))
        self.assertEqual(
            runner.commands[1],
            ("docker", "inspect", "1" * 64, "--format", "{{.Image}}"),
        )


class RecordingRunner:
    def __init__(self):
        self.commands = []

    def run(self, arguments, **_options):
        self.commands.append(tuple(arguments))
        return ""


class StaticOutputRunner:
    def __init__(self, output):
        self.output = output

    def run(self, _arguments, **_options):
        return self.output


class OutputSequenceRunner:
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.commands = []

    def run(self, arguments, **_options):
        self.commands.append(tuple(arguments))
        return next(self.outputs)


class FailFirstComposeRunner(RecordingRunner):
    def __init__(self):
        super().__init__()
        self.failed = False

    def run(self, arguments, **options):
        result = super().run(arguments, **options)
        if tuple(arguments) == deploy.COMPOSE_UP_COMMAND and not self.failed:
            self.failed = True
            raise deploy.DeploymentError("compose start failed")
        return result


class HealthSequence:
    def __init__(self, results):
        self.results = iter(results)

    def __call__(self, _url, _expected_sha=None):
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result


class StaticCallable:
    def __init__(self, result):
        self.result = result

    def __call__(self, *_arguments):
        return self.result


class SequenceCallable:
    def __init__(self, results):
        self.results = iter(results)

    def __call__(self, *_arguments):
        return next(self.results)


def release_health(operations_sha):
    return {
        "ok": True,
        "service": "granit-operations-api",
        "release": {"operationsSha": operations_sha},
    }


def build_candidate(root):
    catalog_path = root / "apps/api/src/modules/ai/catalog/catalog-index.v1.json"
    metadata_path = root / "apps/api/src/modules/ai/catalog/pinned-catalog-index.ts"
    dockerfile_path = root / "deploy/staging/Dockerfile.operations"
    catalog_path.parent.mkdir(parents=True)
    dockerfile_path.parent.mkdir(parents=True)
    catalog_path.write_bytes(CATALOG)
    metadata_path.write_text(
        "\n".join(
            (
                "export const PINNED_CATALOG_SOURCE_REPOSITORY =\n"
                '  "monaxovdulov/landing-granit-static" as const;',
                'export const PINNED_CATALOG_VERSION = "landing-catalog.test123456789" as const;',
                f'export const PINNED_CATALOG_CONTENT_HASH = "{CATALOG_HASH}" as const;',
            )
        ),
        encoding="utf-8",
    )
    dockerfile_path.write_text("FROM scratch\n", encoding="utf-8")
    return root


def build_git_remote(root):
    worktree = root / "source"
    remote = root / "source.git"
    run_git("init", "--quiet", "--initial-branch=main", str(worktree))
    run_git("-C", str(worktree), "config", "user.name", "Release Test")
    run_git("-C", str(worktree), "config", "user.email", "release@example.invalid")
    (worktree / "marker.txt").write_text("trusted main\n")
    catalog_path = worktree / "assets/catalog/catalog-index.v1.json"
    catalog_path.parent.mkdir(parents=True)
    catalog_path.write_bytes(CATALOG)
    run_git("-C", str(worktree), "add", "marker.txt", "assets")
    run_git("-C", str(worktree), "commit", "--quiet", "-m", "fixture")
    commit_sha = run_git(
        "-C", str(worktree), "rev-parse", "HEAD"
    ).stdout.strip()
    run_git("clone", "--bare", "--quiet", str(worktree), str(remote))
    return remote, commit_sha


def run_git(*arguments):
    return subprocess.run(
        ["git", *arguments],
        check=True,
        capture_output=True,
        text=True,
    )


if __name__ == "__main__":
    unittest.main()
