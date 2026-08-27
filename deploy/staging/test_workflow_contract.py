from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = REPOSITORY_ROOT / ".github/workflows/deploy-staging-backend.yml"
GATE_PATH = REPOSITORY_ROOT / "deploy/staging/granit-operations-deploy-gate"
DOCKERFILE_PATH = REPOSITORY_ROOT / "deploy/staging/Dockerfile.operations"
DOCKERIGNORE_PATH = REPOSITORY_ROOT / ".dockerignore"


class StagingWorkflowContractTest(unittest.TestCase):
    def test_runs_only_for_pushes_to_main_with_read_only_permissions(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertRegex(workflow, r"(?m)^on:\n  push:\n    branches:\n      - main$")
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("workflow_dispatch:", workflow)
        self.assertRegex(workflow, r"(?m)^permissions:\n  contents: read$")
        self.assertIn("cancel-in-progress: false", workflow)

    def test_keeps_secrets_out_of_the_job_that_executes_repository_code(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")
        checks = workflow.split("\n  deploy:\n", maxsplit=1)[0]
        deploy = workflow.split("\n  deploy:\n", maxsplit=1)[1]

        self.assertNotIn("secrets.", checks)
        self.assertNotIn("environment: staging", checks)
        self.assertIn("environment: staging", deploy)
        self.assertNotIn("actions/checkout", deploy)
        self.assertNotIn("npm ", deploy)

    def test_pins_official_actions_and_deploys_only_after_all_gates(self):
        workflow = WORKFLOW_PATH.read_text(encoding="utf-8")

        self.assertIn(
            "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
            workflow,
        )
        self.assertIn(
            "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
            workflow,
        )
        self.assertIn("persist-credentials: false", workflow)
        self.assertIn("package-manager-cache: false", workflow)
        self.assertIn("needs: checks", workflow)
        self.assertIn("python3 -m unittest discover", workflow)
        self.assertIn("run: npm test", workflow)
        self.assertIn("run: npm run build", workflow)
        self.assertIn('"granit-deploy operations-staging $GITHUB_SHA"', workflow)
        self.assertIn("[!A-Za-z0-9]*) exit 1", workflow)
        self.assertIn("[!a-z_]*) exit 1", workflow)
        self.assertRegex(
            workflow,
            r"(?s)deploy:\n.*?timeout-minutes: 180\n.*?environment: staging",
        )

    def test_forced_command_accepts_only_one_exact_sha_argument(self):
        gate = GATE_PATH.read_text(encoding="utf-8")

        self.assertIn('prefix="granit-deploy operations-staging "', gate)
        self.assertIn('*[!0-9a-f]* | "")', gate)
        self.assertIn('[ "${#commit_sha}" -ne 40 ]', gate)
        self.assertIn(
            "exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin",
            gate,
        )
        deployer = (
            REPOSITORY_ROOT / "deploy/staging/deploy_operations_staging.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("os.environ", deployer)
        self.assertNotIn("GRANIT_", deployer)

    def test_image_bakes_the_exact_sha_and_uses_a_digest_pinned_base(self):
        dockerfile = DOCKERFILE_PATH.read_text(encoding="utf-8")
        dockerignore = DOCKERIGNORE_PATH.read_text(encoding="utf-8").splitlines()

        first_line = dockerfile.splitlines()[0]
        self.assertRegex(first_line, r"^FROM node:22\.22\.0-bookworm-slim@sha256:[0-9a-f]{64}$")
        self.assertIn('OPERATIONS_RELEASE_SHA="${OPERATIONS_RELEASE_SHA}"', dockerfile)
        self.assertIn('org.opencontainers.image.revision="${OPERATIONS_RELEASE_SHA}"', dockerfile)
        self.assertNotIn("COPY . ", dockerfile)
        self.assertIn(".git", dockerignore)
        self.assertIn(".env.*", dockerignore)
        self.assertIn("node_modules", dockerignore)


if __name__ == "__main__":
    unittest.main()
