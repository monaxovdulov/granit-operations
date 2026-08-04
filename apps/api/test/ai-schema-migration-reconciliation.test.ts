import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createOperationsDb } from "@granit/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AI_QUALITY_REASON_CODES,
  AI_RUN_OUTCOME_REASONS
} from "../src/modules/ai/repositories/ai-run-repository.js";
import { PR0A_POSTGRES_IMAGE } from "./helpers/postgres-widget-ai-test-harness.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrationsDir = resolve(repositoryRoot, "packages/db/migrations");
const archiveDir = resolve(repositoryRoot, "packages/db/migration-archive/mastra-live-v2");
const reconciliationMigration = "0017_ai_schema_reconciliation.sql";
const turnIdentityMigration = "0018_widget_ai_turn_identity.sql";
const latestWinsMigration = "0019_widget_ai_latest_wins.sql";
const narrowThrough0016 = [
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
] as const;
const broadBase = narrowThrough0016.slice(0, 9);
const broadArchive = [
  "0010_ai_run_quality_observability.sql",
  "0011_live_v2_controlled_no_reply.sql"
] as const;

type Database = ReturnType<typeof createOperationsDb>;

describe.sequential("PR0b canonical AI schema migration reconciliation", () => {
  let container: StartedPostgreSqlContainer;
  let admin: Database;

  beforeAll(async () => {
    if (process.env.P2_TEST_DATABASE_URL) {
      throw new Error("PR0b migration tests require disposable PostgreSQL");
    }
    container = await new PostgreSqlContainer(PR0A_POSTGRES_IMAGE)
      .withDatabase("pr0b_admin")
      .withUsername("pr0b_admin")
      .withPassword("pr0b_admin")
      .withLabels({ "granit.pr0b.ai-schema-reconciliation": "true" })
      .start();
    admin = createOperationsDb(container.getConnectionUri());
  }, 180_000);

  afterAll(async () => {
    await admin?.client.end({ timeout: 5 });
    await container?.stop({ remove: true, removeVolumes: true });
  });

  it("applies the exact fresh narrow 0001..0019 root chain", async () => {
    await withDatabase("fresh_narrow", async (database) => {
      const rootMigrations = (await readdir(migrationsDir))
        .filter((file) => file.endsWith(".sql"))
        .sort();
      expect(rootMigrations).toEqual([
        ...narrowThrough0016,
        reconciliationMigration,
        turnIdentityMigration,
        latestWinsMigration
      ]);

      await applyMigrations(database, migrationsDir, rootMigrations);
      await expectInventory(database, { runs: 0, spans: 0, quality: 0 });
    });
  }, 120_000);

  it("preserves and links seeded narrow runs and quality rows", async () => {
    await withDatabase("seeded_narrow", async (database) => {
      await applyMigrations(database, migrationsDir, [...narrowThrough0016]);
      await seedConversation(database);
      await database.client.unsafe(`
        INSERT INTO ai_runs (
          id, conversation_id, lead_id, inbound_public_message_id,
          outbound_public_message_id, status, action, intent, input_fingerprint,
          prompt_version, policy_version, knowledge_version, model_name, metadata
        ) VALUES
          (
            '55555555-5555-4555-8555-555555555551',
            '22222222-2222-4222-8222-222222222222',
            '11111111-1111-4111-8111-111111111111',
            '33333333-3333-4333-8333-333333333331',
            '44444444-4444-4444-8444-444444444444',
            'replied', 'answer', 'product_selection', repeat('a', 64),
            'prompt.v1', 'policy.v1', 'knowledge.v1', 'fake-model', '{}'::jsonb
          ),
          (
            '55555555-5555-4555-8555-555555555552',
            '22222222-2222-4222-8222-222222222222',
            '11111111-1111-4111-8111-111111111111',
            '33333333-3333-4333-8333-333333333332',
            NULL, 'degraded', 'fallback', 'general_question', repeat('b', 64),
            'prompt.v1', 'policy.v1', 'knowledge.v1', NULL,
            '{"fallback_reason":"turn_timeout"}'::jsonb
          );

        UPDATE ai_runs
        SET reason = 'turn_timeout'
        WHERE id = '55555555-5555-4555-8555-555555555552';

        INSERT INTO ai_quality_events (
          id, ai_run_id, lead_id, conversation_id, message_id,
          event_type, reason_code, severity
        ) VALUES (
          '77777777-7777-4777-8777-777777777777',
          '55555555-5555-4555-8555-555555555552',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333332',
          'model_failure', 'turn_timeout', 'error'
        );
      `);

      await applyMigrations(database, migrationsDir, [
        reconciliationMigration,
        turnIdentityMigration,
        latestWinsMigration
      ]);
      await expectInventory(database, { runs: 2, spans: 0, quality: 1 });
      const rows = await database.client.unsafe<
        Array<{
          recording_contract: string;
          status: string;
          linked: boolean;
          trace_id: string | null;
          configured_model_provider: string | null;
          configured_model_name: string | null;
          model_name: string | null;
          started_at: Date | null;
          latency_ms: number | null;
        }>
      >(`
        SELECT recording_contract, status,
          inbound_message_id IS NOT NULL
            AND (outbound_public_message_id IS NULL OR outbound_message_id IS NOT NULL) AS linked,
          trace_id, configured_model_provider, configured_model_name, model_name,
          started_at, latency_ms
        FROM ai_runs
        ORDER BY id
      `);
      expect(rows).toEqual([
        expect.objectContaining({
          recording_contract: "legacy_narrow",
          status: "persisted",
          linked: true,
          trace_id: null,
          configured_model_provider: null,
          configured_model_name: null,
          model_name: "fake-model",
          started_at: null,
          latency_ms: null
        }),
        expect.objectContaining({
          recording_contract: "legacy_narrow",
          status: "fallback_unavailable",
          linked: true,
          trace_id: null,
          configured_model_provider: null,
          configured_model_name: null,
          model_name: null,
          started_at: null,
          latency_ms: null
        })
      ]);
    });
  }, 120_000);

  it("preserves seeded known broad runs, spans and quality rows", async () => {
    await withDatabase("seeded_broad", async (database) => {
      await applyMigrations(database, migrationsDir, [...broadBase]);
      await seedConversation(database);
      await applyMigrations(database, archiveDir, [...broadArchive]);
      await database.client.unsafe(`
        INSERT INTO ai_runs (
          id, trace_id, lead_id, conversation_id, inbound_message_id, outbound_message_id,
          channel, runtime_mode, decision_profile, decision_action, idempotency_key,
          input_fingerprint, status, policy_version, prompt_version, tool_version,
          disclosure_version, configured_model_provider, configured_model_name,
          observed_model_provider, observed_model_name, reasoning_effort,
          model_profile_version, send_gate_result, send_gate_checked_at,
          outcome_reason, profile_validator_result, started_at, completed_at, latency_ms
        ) VALUES (
          '55555555-5555-4555-8555-555555555553',
          '99999999-9999-4999-8999-999999999999',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333331',
          '44444444-4444-4444-8444-444444444444',
          'site_widget', 'direct_openai', 'legacy_s05', 'answer',
          'ai-turn:33333333-3333-4333-8333-333333333331', repeat('c', 64),
          'persisted', 'policy.v1', 'prompt.v1', 'tools.v1', 'disclosure.v1',
          'fake', 'fake-model', 'fake', 'fake-model', 'none', 'legacy_s05',
          'allowed', '2026-08-04T10:00:01Z', 'reply_persisted', 'passed',
          '2026-08-04T10:00:00Z', '2026-08-04T10:00:01Z', 1000
        );

        INSERT INTO ai_run_spans (
          id, ai_run_id, span_id, kind, name, status, latency_ms
        ) VALUES (
          '66666666-6666-4666-8666-666666666666',
          '55555555-5555-4555-8555-555555555553',
          'model-1', 'model', 'model_generation', 'succeeded', 900
        );

        INSERT INTO ai_quality_events (
          id, ai_run_id, lead_id, conversation_id, message_id,
          event_type, reason_code, severity
        ) VALUES (
          '77777777-7777-4777-8777-777777777778',
          '55555555-5555-4555-8555-555555555553',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '44444444-4444-4444-8444-444444444444',
          'model_failure', 'model_error', 'error'
        );
      `);

      await applyMigrations(database, migrationsDir, [
        reconciliationMigration,
        turnIdentityMigration,
        latestWinsMigration
      ]);
      await expectInventory(database, { runs: 1, spans: 1, quality: 1 });
      const [row] = await database.client.unsafe<
        Array<{
          recording_contract: string;
          inbound_public_message_id: string;
          outbound_public_message_id: string;
        }>
      >(`
        SELECT recording_contract, inbound_public_message_id, outbound_public_message_id
        FROM ai_runs
      `);
      expect(row).toEqual({
        recording_contract: "native_recorded",
        inbound_public_message_id: "33333333-3333-4333-8333-333333333331",
        outbound_public_message_id: "44444444-4444-4444-8444-444444444444"
      });
    });
  }, 120_000);

  it("fails closed before persistent DDL for a hybrid lineage", async () => {
    await withDatabase("hybrid_rejected", async (database) => {
      await applyMigrations(database, migrationsDir, [...narrowThrough0016]);
      await database.client.unsafe("ALTER TABLE ai_runs ADD COLUMN trace_id uuid");
      await expect(
        applyMigrations(database, migrationsDir, [reconciliationMigration])
      ).rejects.toThrow(/unknown or hybrid lineage/);
      const [row] = await database.client.unsafe<Array<{ present: boolean }>>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'ai_runs'
            AND column_name = 'recording_contract'
        ) AS present
      `);
      expect(row?.present).toBe(false);
    });
  }, 120_000);

  it("backfills deterministic message and queued turn identity", async () => {
    await withDatabase("turn_identity_backfill", async (database) => {
      await applyMigrations(database, migrationsDir, [...narrowThrough0016]);
      await seedConversation(database);
      await database.client.unsafe(`
        INSERT INTO widget_ai_jobs (
          id, inbound_message_id, inbound_public_message_id,
          conversation_id, lead_id, input_payload
        ) VALUES (
          '88888888-8888-4888-8888-888888888888',
          '33333333-3333-4333-8333-333333333332',
          '33333333-3333-4333-8333-333333333332',
          '22222222-2222-4222-8222-222222222222',
          '11111111-1111-4111-8111-111111111111',
          '{}'::jsonb
        )
      `);

      await applyMigrations(database, migrationsDir, [
        reconciliationMigration,
        turnIdentityMigration,
        latestWinsMigration
      ]);

      const [conversation] = await database.client.unsafe<
        Array<{ last_message_sequence: number; generation_epoch: number }>
      >(`
        SELECT last_message_sequence::int, generation_epoch::int
        FROM conversations
        WHERE id = '22222222-2222-4222-8222-222222222222'
      `);
      expect(conversation).toEqual({ last_message_sequence: 3, generation_epoch: 0 });

      const messages = await database.client.unsafe<
        Array<{ id: string; message_sequence: number }>
      >(`
        SELECT id, message_sequence::int
        FROM conversation_messages
        WHERE conversation_id = '22222222-2222-4222-8222-222222222222'
        ORDER BY message_sequence
      `);
      expect(messages).toEqual([
        { id: "33333333-3333-4333-8333-333333333331", message_sequence: 1 },
        { id: "33333333-3333-4333-8333-333333333332", message_sequence: 2 },
        { id: "44444444-4444-4444-8444-444444444444", message_sequence: 3 }
      ]);

      const [job] = await database.client.unsafe<
        Array<{ expected_generation_epoch: number; responds_through_sequence: number }>
      >(`
        SELECT expected_generation_epoch::int, responds_through_sequence::int
        FROM widget_ai_jobs
        WHERE id = '88888888-8888-4888-8888-888888888888'
      `);
      expect(job).toEqual({
        expected_generation_epoch: 0,
        responds_through_sequence: 2
      });
    });
  }, 120_000);

  async function withDatabase(name: string, run: (database: Database) => Promise<void>) {
    await admin.client.unsafe(`CREATE DATABASE "${name}"`);
    const uri = new URL(container.getConnectionUri());
    uri.pathname = `/${name}`;
    const database = createOperationsDb(uri.toString());
    try {
      await run(database);
    } finally {
      await database.client.end({ timeout: 5 });
    }
  }
});

async function applyMigrations(database: Database, directory: string, migrations: readonly string[]) {
  for (const migration of migrations) {
    const connection = await database.client.reserve();
    try {
      await connection.unsafe(await readFile(resolve(directory, migration), "utf8"));
    } catch (error) {
      await connection.unsafe("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function seedConversation(database: Database) {
  await database.client.unsafe(`
    INSERT INTO leads (
      id, status, source_channel, source_page_url, source_form_kind,
      contact_name, submitted_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111', 'new', 'site_widget',
      'https://example.test/catalog', 'site_widget', 'Migration test visitor',
      '2026-08-04T10:00:00Z'
    );

    INSERT INTO widget_sessions (
      id, public_session_id, source_page_url, widget_instance_id
    ) VALUES (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'https://example.test/catalog', 'migration-test'
    );

    INSERT INTO conversations (
      id, public_conversation_id, lead_id, widget_session_id, channel,
      agent_allowed_to_reply, source_page_url, widget_instance_id
    ) VALUES (
      '22222222-2222-4222-8222-222222222222',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'site_widget', true, 'https://example.test/catalog', 'migration-test'
    );

    INSERT INTO conversation_messages (
      id, public_message_id, conversation_id, lead_id, direction, sender_role,
      body, idempotency_key, request_fingerprint, source_page_url, submitted_at
    ) VALUES
      (
        '33333333-3333-4333-8333-333333333331',
        '33333333-3333-4333-8333-333333333331',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'inbound', 'visitor', 'Первое сообщение', 'seed-inbound-1', repeat('1', 64),
        'https://example.test/catalog', '2026-08-04T10:00:00Z'
      ),
      (
        '33333333-3333-4333-8333-333333333332',
        '33333333-3333-4333-8333-333333333332',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'inbound', 'visitor', 'Второе сообщение', 'seed-inbound-2', repeat('2', 64),
        'https://example.test/catalog', '2026-08-04T10:00:00Z'
      ),
      (
        '44444444-4444-4444-8444-444444444444',
        '44444444-4444-4444-8444-444444444444',
        '22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111',
        'outbound', 'ai_assistant', 'Ответ', 'seed-outbound', repeat('3', 64),
        'https://example.test/catalog', '2026-08-04T10:00:01Z'
      );
  `);
}

async function expectInventory(
  database: Database,
  expected: { runs: number; spans: number; quality: number }
) {
  const [counts] = await database.client.unsafe<
    Array<{ runs: number; spans: number; quality: number; orphans: number }>
  >(`
    SELECT
      (SELECT count(*)::int FROM ai_runs) AS runs,
      (SELECT count(*)::int FROM ai_run_spans) AS spans,
      (SELECT count(*)::int FROM ai_quality_events) AS quality,
      (
        SELECT count(*)::int FROM (
          SELECT r.id
          FROM ai_runs r
          LEFT JOIN conversation_messages inbound ON inbound.id = r.inbound_message_id
          LEFT JOIN conversation_messages outbound ON outbound.id = r.outbound_message_id
          WHERE inbound.id IS NULL OR (r.outbound_message_id IS NOT NULL AND outbound.id IS NULL)
          UNION ALL
          SELECT s.id FROM ai_run_spans s LEFT JOIN ai_runs r ON r.id = s.ai_run_id WHERE r.id IS NULL
          UNION ALL
          SELECT q.id FROM ai_quality_events q LEFT JOIN ai_runs r ON r.id = q.ai_run_id WHERE r.id IS NULL
        ) orphan_rows
      ) AS orphans
  `);
  expect(counts).toEqual({ ...expected, orphans: 0 });

  const constraints = await database.client.unsafe<
    Array<{ conname: string; convalidated: boolean }>
  >(`
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid IN (
      'ai_runs'::regclass, 'ai_run_spans'::regclass, 'ai_quality_events'::regclass
    )
  `);
  expect(constraints.length).toBeGreaterThan(20);
  expect(constraints.every((constraint) => constraint.convalidated)).toBe(true);
  expect(constraints.map((constraint) => constraint.conname)).toEqual(
    expect.arrayContaining([
      "ai_runs_recording_contract_check",
      "ai_runs_contract_evidence_check",
      "ai_runs_public_internal_linkage_check",
      "ai_quality_events_reason_code_check"
    ])
  );

  await expectCanonicalAiStorageContract(database);
  await expectLatestWinsWidgetJobContract(database);
}

async function expectLatestWinsWidgetJobContract(database: Database) {
  const columns = await database.client.unsafe<
    Array<{ column_name: string; column_default: string | null; is_nullable: "YES" | "NO" }>
  >(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'widget_ai_jobs'
      AND column_name IN ('input_payload', 'runtime_mode')
    ORDER BY column_name
  `);
  expect(columns).toEqual([
    {
      column_name: "runtime_mode",
      column_default: "'direct_openai'::text",
      is_nullable: "NO"
    }
  ]);

  const constraints = await database.client.unsafe<Array<{ conname: string; definition: string }>>(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'widget_ai_jobs'::regclass
      AND conname IN ('widget_ai_jobs_runtime_mode_check', 'widget_ai_jobs_status_check')
    ORDER BY conname
  `);
  const definitions = new Map(
    constraints.map((constraint) => [constraint.conname, normalizeSql(constraint.definition)])
  );
  expect(quotedLiterals(definitions.get("widget_ai_jobs_runtime_mode_check"))).toEqual([
    "direct_openai",
    "mastra_openai_api"
  ]);
  expect(quotedLiterals(definitions.get("widget_ai_jobs_status_check"))).toContain(
    "superseded"
  );

  const [index] = await database.client.unsafe<
    Array<{ indexname: string; definition: string }>
  >(`
    SELECT indexname, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'widget_ai_jobs_response_window_idx'
  `);
  expect(normalizeSql(index?.definition)).toContain(
    "CREATE UNIQUE INDEX widget_ai_jobs_response_window_idx"
  );
  expect(normalizeSql(index?.definition)).toContain(
    "conversation_id, expected_generation_epoch, responds_through_sequence, runtime_mode"
  );
}

async function expectCanonicalAiStorageContract(database: Database) {
  const columns = await database.client.unsafe<
    Array<{ column_name: string; column_default: string | null; is_nullable: "YES" | "NO" }>
  >(`
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_runs'
      AND column_name IN (
        'channel', 'created_at', 'decision_profile', 'inbound_message_id',
        'inbound_public_message_id', 'metadata', 'profile_validator_result',
        'reasoning_effort', 'recording_contract', 'send_gate_result', 'started_at',
        'status', 'trace_id', 'updated_at'
      )
    ORDER BY column_name
  `);
  expect(columns).toEqual([
    { column_name: "channel", column_default: "'site_widget'::text", is_nullable: "NO" },
    { column_name: "created_at", column_default: "now()", is_nullable: "NO" },
    {
      column_name: "decision_profile",
      column_default: "'legacy_s05'::text",
      is_nullable: "NO"
    },
    { column_name: "inbound_message_id", column_default: null, is_nullable: "NO" },
    { column_name: "inbound_public_message_id", column_default: null, is_nullable: "NO" },
    { column_name: "metadata", column_default: "'{}'::jsonb", is_nullable: "NO" },
    {
      column_name: "profile_validator_result",
      column_default: "'not_run'::text",
      is_nullable: "NO"
    },
    { column_name: "reasoning_effort", column_default: null, is_nullable: "YES" },
    {
      column_name: "recording_contract",
      column_default: "'native_recorded'::text",
      is_nullable: "NO"
    },
    {
      column_name: "send_gate_result",
      column_default: "'not_checked'::text",
      is_nullable: "NO"
    },
    { column_name: "started_at", column_default: null, is_nullable: "YES" },
    { column_name: "status", column_default: "'running'::text", is_nullable: "NO" },
    { column_name: "trace_id", column_default: null, is_nullable: "YES" },
    { column_name: "updated_at", column_default: "now()", is_nullable: "NO" }
  ]);

  const constraintRows = await database.client.unsafe<
    Array<{ conname: string; definition: string }>
  >(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid IN ('ai_runs'::regclass, 'ai_quality_events'::regclass)
      AND conname IN (
        'ai_runs_outcome_reason_check',
        'ai_runs_cost_estimate_check',
        'ai_runs_terminal_action_check',
        'ai_runs_verifier_verdict_check',
        'ai_runs_catalog_content_hash_check',
        'ai_quality_events_reason_code_check'
      )
    ORDER BY conname
  `);
  const definitions = new Map(
    constraintRows.map((constraint) => [constraint.conname, normalizeSql(constraint.definition)])
  );
  expect(quotedLiterals(definitions.get("ai_runs_outcome_reason_check"))).toEqual(
    [...AI_RUN_OUTCOME_REASONS].sort()
  );
  expect(quotedLiterals(definitions.get("ai_quality_events_reason_code_check"))).toEqual(
    [...AI_QUALITY_REASON_CODES].sort()
  );
  expect(definitions.get("ai_runs_cost_estimate_check")).toContain(
    "cost_rate_version ~ '^[A-Za-z0-9._:/@+-]+$'::text"
  );
  expect(definitions.get("ai_runs_cost_estimate_check")).toContain(
    "char_length(cost_rate_version)"
  );
  expect(definitions.get("ai_runs_terminal_action_check")).toContain(
    "ARRAY['answer'::text, 'ask_clarifying_question'::text]"
  );
  expect(definitions.get("ai_runs_terminal_action_check")).not.toContain(
    "ARRAY['answer'::text, 'ask_clarifying_question'::text, 'no_reply'::text]"
  );
  expect(quotedLiterals(definitions.get("ai_runs_verifier_verdict_check"))).toEqual([
    "block",
    "handoff",
    "pass",
    "repair"
  ]);
  expect(definitions.get("ai_runs_catalog_content_hash_check")).toContain(
    "char_length(catalog_content_hash) = 64"
  );

  const schemaSource = await readFile(resolve(repositoryRoot, "packages/db/src/schema.ts"), "utf8");
  const schemaCheckNames = [
    ...schemaSource.matchAll(
      /check\(\s*"(ai_(?:runs|run_spans|quality_events)_[a-z0-9_]+)"/g
    )
  ]
    .map((match) => match[1]!)
    .sort();
  const databaseCheckRows = await database.client.unsafe<Array<{ conname: string }>>(`
    SELECT conname
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN (
        'ai_runs'::regclass, 'ai_run_spans'::regclass, 'ai_quality_events'::regclass
      )
    ORDER BY conname
  `);
  expect(databaseCheckRows.map((row) => row.conname)).toEqual(schemaCheckNames);

  const foreignKeys = await database.client.unsafe<
    Array<{ conname: string; delete_action: string; validated: boolean }>
  >(`
    SELECT conname, confdeltype::text AS delete_action, convalidated AS validated
    FROM pg_constraint
    WHERE conrelid = 'ai_runs'::regclass
      AND conname IN ('ai_runs_inbound_message_id_fkey', 'ai_runs_outbound_message_id_fkey')
    ORDER BY conname
  `);
  expect(foreignKeys).toEqual([
    { conname: "ai_runs_inbound_message_id_fkey", delete_action: "a", validated: true },
    { conname: "ai_runs_outbound_message_id_fkey", delete_action: "a", validated: true }
  ]);

  const indexRows = await database.client.unsafe<Array<{ indexname: string; definition: string }>>(`
    SELECT indexname, indexdef AS definition
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'ai_runs_trace_id_idx',
        'ai_runs_idempotency_key_idx',
        'ai_runs_inbound_public_message_id_idx',
        'ai_runs_outbound_message_id_idx',
        'ai_runs_conversation_started_idx',
        'ai_runs_status_started_idx'
      )
    ORDER BY indexname
  `);
  expect(indexRows.map((row) => row.indexname)).toEqual([
    "ai_runs_conversation_started_idx",
    "ai_runs_idempotency_key_idx",
    "ai_runs_inbound_public_message_id_idx",
    "ai_runs_outbound_message_id_idx",
    "ai_runs_status_started_idx",
    "ai_runs_trace_id_idx"
  ]);
  const indexDefinitions = new Map(
    indexRows.map((row) => [row.indexname, normalizeSql(row.definition)])
  );
  expect(indexDefinitions.get("ai_runs_trace_id_idx")).toContain("UNIQUE INDEX");
  expect(indexDefinitions.get("ai_runs_idempotency_key_idx")).toContain("UNIQUE INDEX");
  expect(indexDefinitions.get("ai_runs_inbound_public_message_id_idx")).toContain(
    "UNIQUE INDEX"
  );
  expect(indexDefinitions.get("ai_runs_outbound_message_id_idx")).toContain(
    "WHERE (outbound_message_id IS NOT NULL)"
  );
  expect(indexDefinitions.get("ai_runs_conversation_started_idx")).toContain(
    "(conversation_id, started_at DESC)"
  );
  expect(indexDefinitions.get("ai_runs_status_started_idx")).toContain(
    "(status, started_at DESC)"
  );
}

function normalizeSql(value: string | undefined) {
  if (!value) throw new Error("expected canonical PostgreSQL inventory entry");
  return value.replace(/\s+/g, " ").trim();
}

function quotedLiterals(value: string | undefined) {
  const normalized = normalizeSql(value);
  return [...normalized.matchAll(/'([^']+)'::text/g)]
    .map((match) => match[1]!)
    .sort();
}
