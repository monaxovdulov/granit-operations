import { randomUUID } from "node:crypto";

import {
  aiQualityEvents,
  aiRunSpans,
  aiRuns,
  conversationMessages,
  conversations,
  createOperationsDb,
  leads
} from "@granit/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AI_RUN_SPAN_CLEANUP_MAX_BATCHES,
  AiRunSpanRetentionInputError,
  AiRunSpanRetentionService,
  parseAiRunSpanCleanupArgs,
  type AiRunSpanCleanupBatchInput,
  type AiRunSpanRetentionRepository
} from "../src/modules/ai/observability/ai-run-span-retention.js";
import { PostgresAiRunSpanRetentionRepository } from "../src/modules/ai/observability/postgres-ai-run-span-retention-repository.js";

const CUTOFF = new Date("2026-07-15T00:00:00.000Z");

describe("P3 bounded AI run span retention", () => {
  it("defaults to one bounded dry-run without deleting or repeating the same batch", async () => {
    const repository = new MemoryRetentionRepository([
      ["expired-1", -30],
      ["expired-2", -20],
      ["expired-3", -10],
      ["future-1", 10]
    ]);
    const result = await new AiRunSpanRetentionService(repository, {
      clock: () => CUTOFF
    }).cleanupExpired({ batchSize: 2, maxBatches: 50 });

    expect(result).toMatchObject({
      dryRun: true,
      batches: 1,
      matched: 2,
      deleted: 0,
      hasMore: true
    });
    expect(repository.remainingIds()).toEqual([
      "expired-1",
      "expired-2",
      "expired-3",
      "future-1"
    ]);
  });

  it("deletes expired spans across capped batches and preserves non-expired spans", async () => {
    const repository = new MemoryRetentionRepository([
      ["expired-1", -30],
      ["expired-2", -20],
      ["expired-3", -10],
      ["future-1", 10]
    ]);
    const result = await new AiRunSpanRetentionService(repository, {
      clock: () => CUTOFF
    }).cleanupExpired({
      cutoff: CUTOFF,
      batchSize: 2,
      maxBatches: 2,
      dryRun: false
    });

    expect(result).toMatchObject({
      dryRun: false,
      batches: 2,
      matched: 3,
      deleted: 3,
      hasMore: false
    });
    expect(repository.remainingIds()).toEqual(["future-1"]);
  });

  it("stops an apply race that deletes no rows instead of spinning", async () => {
    const repository: AiRunSpanRetentionRepository = {
      async cleanupExpiredBatch() {
        return { matched: 1, deleted: 0, hasMore: true };
      }
    };
    const result = await new AiRunSpanRetentionService(repository, {
      clock: () => CUTOFF
    }).cleanupExpired({
      cutoff: CUTOFF,
      dryRun: false,
      maxBatches: AI_RUN_SPAN_CLEANUP_MAX_BATCHES
    });

    expect(result.batches).toBe(1);
    expect(result.hasMore).toBe(true);
  });

  it("rejects a future cleanup cutoff before either dry-run or apply reaches storage", async () => {
    const repository = new MemoryRetentionRepository([["future-1", 10]]);
    const service = new AiRunSpanRetentionService(repository, { clock: () => CUTOFF });
    const futureCutoff = new Date(CUTOFF.getTime() + 1);

    await expect(service.cleanupExpired({ cutoff: futureCutoff })).rejects.toThrow(
      AiRunSpanRetentionInputError
    );
    await expect(
      service.cleanupExpired({ cutoff: futureCutoff, dryRun: false })
    ).rejects.toThrow(AiRunSpanRetentionInputError);
    expect(repository.calls).toBe(0);
  });

  it("parses an explicit apply command and rejects unbounded values", () => {
    expect(
      parseAiRunSpanCleanupArgs([
        "--apply",
        "--batch-size",
        "250",
        "--max-batches",
        "3",
        "--cutoff",
        "2026-07-15T00:00:00.000Z"
      ])
    ).toMatchObject({
      dryRun: false,
      batchSize: 250,
      maxBatches: 3,
      cutoff: CUTOFF
    });
    expect(() => parseAiRunSpanCleanupArgs(["--batch-size", "1001"])).toThrow(
      AiRunSpanRetentionInputError
    );
    expect(() => parseAiRunSpanCleanupArgs(["--max-batches", "101"])).toThrow(
      AiRunSpanRetentionInputError
    );
    expect(() => parseAiRunSpanCleanupArgs(["--unknown"])).toThrow(
      AiRunSpanRetentionInputError
    );
    expect(() => parseAiRunSpanCleanupArgs(["--cutoff", "2026-07-15"])).toThrow(
      AiRunSpanRetentionInputError
    );
    expect(() =>
      parseAiRunSpanCleanupArgs(["--cutoff", "2026-07-15T03:00:00+03:00"])
    ).toThrow(AiRunSpanRetentionInputError);
  });
});

const connectionString = process.env.P2_TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe.sequential : describe.skip;

postgresDescribe("P3 PostgreSQL AI run span retention", () => {
  const database = connectionString ? createOperationsDb(connectionString) : undefined;

  beforeAll(() => {
    if (!database) throw new Error("P2_TEST_DATABASE_URL is required");
  });

  beforeEach(async () => {
    await database?.client.unsafe("TRUNCATE TABLE leads RESTART IDENTITY CASCADE");
  });

  afterAll(async () => {
    await database?.client.end();
  });

  it("deletes only an expired bounded span batch and preserves run and business state", async () => {
    if (!database) throw new Error("expected test database");
    const [lead] = await database.db
      .insert(leads)
      .values({
        sourceChannel: "site_widget",
        contactName: "P3 retention fixture",
        submittedAt: new Date("2026-06-01T00:00:00.000Z")
      })
      .returning({ id: leads.id });
    if (!lead) throw new Error("expected lead");
    const [conversation] = await database.db
      .insert(conversations)
      .values({
        leadId: lead.id,
        channel: "site_widget",
        agentAllowedToReply: false
      })
      .returning({ id: conversations.id });
    if (!conversation) throw new Error("expected conversation");
    const [message] = await database.db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        leadId: lead.id,
        direction: "inbound",
        senderRole: "visitor",
        body: "P3 retention business state",
        idempotencyKey: `p3-retention:${randomUUID()}`,
        requestFingerprint: "c".repeat(64),
        submittedAt: new Date("2026-06-01T00:00:00.000Z")
      })
      .returning({ id: conversationMessages.id });
    if (!message) throw new Error("expected message");
    const [run] = await database.db
      .insert(aiRuns)
      .values({
        traceId: randomUUID(),
        leadId: lead.id,
        conversationId: conversation.id,
        inboundMessageId: message.id,
        channel: "site_widget",
        runtimeMode: "direct_openai",
        decisionProfile: "legacy_s05",
        idempotencyKey: `p3-run:${randomUUID()}`,
        inputFingerprint: "d".repeat(64),
        policyVersion: "p3_policy.v1",
        promptVersion: "p3_prompt.v1",
        toolVersion: "p3_tools.none.v1",
        assetVersion: "p3_assets.v1",
        disclosureVersion: "p3_disclosure.v1",
        configuredModelProvider: "fake",
        configuredModelName: "p3-fake",
        reasoningEffort: "none",
        modelProfileVersion: "p3_model_profile.v1",
        startedAt: new Date("2026-06-01T00:00:01.000Z")
      })
      .returning({ id: aiRuns.id });
    if (!run) throw new Error("expected run");

    await database.db.insert(aiQualityEvents).values({
      aiRunId: run.id,
      leadId: lead.id,
      conversationId: conversation.id,
      messageId: message.id,
      eventType: "degradation",
      reasonCode: "missing_openai_config",
      severity: "warning"
    });
    await database.db.insert(aiRunSpans).values([
      spanRow(run.id, "expired-1", "2026-06-01T00:00:02.000Z", "2026-07-01T00:00:00.000Z"),
      spanRow(run.id, "expired-2", "2026-06-01T00:00:03.000Z", "2026-07-02T00:00:00.000Z"),
      spanRow(run.id, "future-1", "2026-07-14T00:00:00.000Z", "2026-07-16T00:00:00.000Z")
    ]);

    const service = new AiRunSpanRetentionService(
      new PostgresAiRunSpanRetentionRepository(database.db)
    );
    const dryRun = await service.cleanupExpired({
      cutoff: CUTOFF,
      batchSize: 1
    });
    expect(dryRun).toMatchObject({ matched: 1, deleted: 0, hasMore: true });

    const applied = await service.cleanupExpired({
      cutoff: CUTOFF,
      batchSize: 1,
      maxBatches: 1,
      dryRun: false
    });
    expect(applied).toMatchObject({ matched: 1, deleted: 1, hasMore: true });
    expect((await database.db.select().from(aiRunSpans)).map((row) => row.spanId).sort()).toEqual([
      "expired-2",
      "future-1"
    ]);
    expect(await database.db.select().from(aiRuns).where(eq(aiRuns.id, run.id))).toHaveLength(1);
    expect(
      await database.db.select().from(aiQualityEvents).where(eq(aiQualityEvents.aiRunId, run.id))
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.id, message.id))
    ).toMatchObject([{ body: "P3 retention business state" }]);
    expect(await database.db.select().from(conversations).where(eq(conversations.id, conversation.id))).toHaveLength(1);
    expect(await database.db.select().from(leads).where(eq(leads.id, lead.id))).toHaveLength(1);
  });
});

class MemoryRetentionRepository implements AiRunSpanRetentionRepository {
  private readonly spans: Array<{ id: string; expiresAt: Date }>;
  calls = 0;

  constructor(values: Array<readonly [string, number]>) {
    this.spans = values.map(([id, offsetMs]) => ({
      id,
      expiresAt: new Date(CUTOFF.getTime() + offsetMs)
    }));
  }

  remainingIds(): string[] {
    return this.spans.map((span) => span.id);
  }

  async cleanupExpiredBatch(input: AiRunSpanCleanupBatchInput) {
    this.calls += 1;
    const expired = this.spans
      .filter((span) => span.expiresAt <= input.cutoff)
      .sort(
        (left, right) =>
          left.expiresAt.getTime() - right.expiresAt.getTime() ||
          left.id.localeCompare(right.id)
      );
    const selected = expired.slice(0, input.batchSize);

    if (!input.dryRun) {
      const selectedIds = new Set(selected.map((span) => span.id));
      for (let index = this.spans.length - 1; index >= 0; index -= 1) {
        if (selectedIds.has(this.spans[index]!.id)) this.spans.splice(index, 1);
      }
    }

    return {
      matched: selected.length,
      deleted: input.dryRun ? 0 : selected.length,
      hasMore: expired.length > input.batchSize
    };
  }
}

function spanRow(aiRunId: string, spanId: string, createdAt: string, expiresAt: string) {
  return {
    aiRunId,
    spanId,
    kind: "runtime",
    name: "runtime_execution",
    status: "succeeded",
    latencyMs: 1,
    createdAt: new Date(createdAt),
    expiresAt: new Date(expiresAt)
  };
}
