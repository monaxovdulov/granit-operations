import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createOperationsDb } from "@granit/db";

export const PR0A_POSTGRES_IMAGE =
  "postgres@sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2";
export const PR0A_CONTAINER_LABEL = "granit.pr0a.widget-ai-postgres";

const activeMigrationManifest = [
  "0001_s01_intake.sql",
  "0002_s02_manager_auth.sql",
  "0003_s03_min_lifecycle.sql",
  "0004_s04_widget_persistence.sql",
  "0005_s05_website_safe_ai.sql",
  "0006_p0_channel_neutral_conversation.sql",
  "0007_telegram_manager_mini_panel.sql",
  "0008_allow_manager_conversation_messages.sql",
  "0009_telegram_delivery_processing_uncertain.sql",
  "0010_ai_dialog_stage_b.sql",
  "0011_ai_handoff_degradation.sql",
  "0012_grounded_widget_ai.sql",
  "0013_live_widget_memory_shadow.sql",
  "0014_manager_ai_runtime_controls.sql",
  "0015_ai_quality_events.sql",
  "0016_widget_ai_jobs.sql"
];

const excludedMigrationBranches = new Set([
  "0010_ai_run_quality_observability.sql",
  "0011_live_v2_controlled_no_reply.sql",
  "0012_manager_ai_runtime_controls.sql"
]);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const migrationsDir = resolve(repositoryRoot, "packages/db/migrations");

type OperationsDbHandle = ReturnType<typeof createOperationsDb>;

export type PostgresWidgetAiTestHarness = OperationsDbHandle & {
  containerId: string;
  connectionUri: string;
  stop(): Promise<void>;
};

export async function startPostgresWidgetAiTestHarness(): Promise<PostgresWidgetAiTestHarness> {
  if (process.env.P2_TEST_DATABASE_URL) {
    throw new Error("PR0a harness must use disposable Testcontainers PostgreSQL, not P2_TEST_DATABASE_URL");
  }

  await assertMigrationManifestCurrent();
  const container = await new PostgreSqlContainer(PR0A_POSTGRES_IMAGE)
    .withDatabase("pr0a_widget_ai")
    .withUsername("pr0a_widget_ai")
    .withPassword("pr0a_widget_ai")
    .withLabels({ [PR0A_CONTAINER_LABEL]: "true" })
    .start();
  const database = createOperationsDb(container.getConnectionUri());

  try {
    await applyActiveMigrations(database);
  } catch (error) {
    await stopHarness(database, container);
    throw error;
  }

  return {
    ...database,
    containerId: container.getId(),
    connectionUri: container.getConnectionUri(),
    stop: () => stopHarness(database, container)
  };
}

export async function resetPostgresWidgetAiState(harness: PostgresWidgetAiTestHarness) {
  const tables = await harness.client.unsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );

  if (tables.length) {
    await harness.client.unsafe(
      `TRUNCATE TABLE ${tables.map((row) => quoteIdentifier(row.tablename)).join(", ")} RESTART IDENTITY`
    );
  }

  await harness.client.unsafe(`
    INSERT INTO ai_runtime_controls (scope, enabled, version)
    VALUES ('site_widget', true, 1)
    ON CONFLICT (scope) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        version = EXCLUDED.version,
        changed_by_manager_id = NULL,
        changed_by_manager_email = NULL,
        changed_at = now()
  `);
}

async function applyActiveMigrations(database: OperationsDbHandle) {
  for (const migration of activeMigrationManifest) {
    const sql = await readFile(resolve(migrationsDir, migration), "utf8");
    await database.client.unsafe(sql);
  }
}

async function assertMigrationManifestCurrent() {
  const sqlFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const expected = new Set([...activeMigrationManifest, ...excludedMigrationBranches]);
  const unknown = sqlFiles.filter((file) => !expected.has(file));
  const missing = activeMigrationManifest.filter((file) => !sqlFiles.includes(file));

  if (unknown.length || missing.length) {
    throw new Error(
      [
        "PR0a PostgreSQL harness migration manifest drift",
        unknown.length ? `unknown: ${unknown.join(", ")}` : undefined,
        missing.length ? `missing: ${missing.join(", ")}` : undefined
      ]
        .filter(Boolean)
        .join("; ")
    );
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`unsafe PostgreSQL identifier in PR0a reset: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function stopHarness(
  database: OperationsDbHandle,
  container: StartedPostgreSqlContainer
) {
  await database.client.end({ timeout: 5 }).catch(() => undefined);
  await container.stop({ remove: true, removeVolumes: true }).catch(() => undefined);
}
