import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import {
  aiQualityEvents,
  aiRunSpans,
  aiRuns,
  conversationMessages,
  conversations,
  createOperationsDb,
  leadTimelineEvents
} from "@granit/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import type { BeginAiRunInput } from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  AiRunInputInvariantError,
  PostgresAiRunRepository
} from "../src/modules/ai/repositories/postgres-ai-run-repository.js";
import { PostgresIntakeRepository } from "../src/modules/conversations/repositories/postgres-intake-repository.js";

const connectionString = process.env.P2_TEST_DATABASE_URL;
const postgresDescribe = connectionString ? describe.sequential : describe.skip;

postgresDescribe("P2 PostgreSQL AI observability atomicity", () => {
  const database = connectionString ? createOperationsDb(connectionString) : undefined;
  let app: ReturnType<typeof buildApi> | undefined;

  beforeAll(() => {
    if (!database) throw new Error("P2_TEST_DATABASE_URL is required");
  });

  beforeEach(async () => {
    await database?.client.unsafe("TRUNCATE TABLE leads RESTART IDENTITY CASCADE");
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await database?.client.unsafe("DROP TRIGGER IF EXISTS p2_reject_persisted_ai_run ON ai_runs");
    await database?.client.unsafe("DROP FUNCTION IF EXISTS p2_reject_persisted_ai_run()");
  });

  afterAll(async () => {
    await database?.client.end();
  });

  it("commits outbound, allowed gate and terminal run once across replay", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    const generateReply = vi.fn(async () => ({
      text: "Подберу варианты. Какой стиль вам ближе?",
      modelProvider: "fake" as const,
      modelName: "p2-postgres-fake",
      usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 }
    }));
    app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        modelName: "p2-postgres-fake",
        provider: { providerKind: "fake", generateReply },
        runRepository
      }
    });
    const payload = widgetRequest("p2-postgres-success-0001");

    const first = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });
    const replay = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });

    expect(first.json()).toMatchObject({ automation: { status: "replied" } });
    expect(replay.json()).toMatchObject({ status: "replayed", automation: { status: "replied" } });
    expect(first.json().trace_id).toBeUndefined();
    expect(generateReply).toHaveBeenCalledTimes(1);

    const [runRows, outboundRows, spanRows, eventRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages).where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(aiRunSpans),
      database.db.select().from(aiQualityEvents)
    ]);
    expect(runRows).toHaveLength(1);
    expect(outboundRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      status: "persisted",
      decisionAction: "answer",
      outcomeReason: "reply_persisted",
      configuredModelProvider: "fake",
      configuredModelName: "p2-postgres-fake",
      observedModelProvider: "fake",
      observedModelName: "p2-postgres-fake",
      inputTokens: 10,
      outputTokens: 7,
      totalTokens: 17,
      sendGateResult: "allowed",
      outboundMessageId: outboundRows[0]?.id
    });
    expect(runRows[0]?.sendGateCheckedAt).toBeInstanceOf(Date);
    expect(runRows[0]!.sendGateCheckedAt!.getTime()).toBeLessThanOrEqual(
      runRows[0]!.completedAt!.getTime()
    );
    expect(spanRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "send_gate_check", status: "succeeded" }),
        expect.objectContaining({ name: "reply_persistence", status: "succeeded" })
      ])
    );
    expect(eventRows).toHaveLength(0);
  });

  it("commits a blocked terminal run without an outbound after manager takeover", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        replyGenerator: {
          async generateReply(input) {
            await repository.takeoverConversationByPublicId({
              publicConversationId: input.conversation.publicConversationId,
              changedByManagerId: "p2-postgres-manager",
              changedByManagerEmail: "owner@example.test",
              changedByManagerRole: "owner"
            });
            return {
              decision: "reply_candidate",
              text: "Этот draft должен быть заблокирован.",
              metadata: { model_provider: "fake" }
            };
          }
        },
        runRepository
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-postgres-gate-block-0001")
    });

    expect(response.json()).toMatchObject({ automation: { status: "fallback", reason: "agent_reply_blocked" } });
    const [runRows, outboundRows, spanRows, eventRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages).where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(aiRunSpans),
      database.db.select().from(aiQualityEvents)
    ]);
    expect(runRows).toMatchObject([
      { status: "blocked", outcomeReason: "agent_reply_blocked", sendGateResult: "blocked", outboundMessageId: null }
    ]);
    expect(outboundRows).toHaveLength(0);
    expect(runRows[0]?.sendGateCheckedAt).toBeInstanceOf(Date);
    expect(runRows[0]!.sendGateCheckedAt!.getTime()).toBeLessThanOrEqual(
      runRows[0]!.completedAt!.getTime()
    );
    expect(spanRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "send_gate_check",
          status: "blocked",
          usedInFinalAnswer: false
        })
      ])
    );
    expect(eventRows).toMatchObject([
      { eventType: "blocked", reasonCode: "agent_reply_blocked", managerVisible: true }
    ]);
  });

  it("rolls back outbound and gate when terminal success update fails", async () => {
    if (!database) throw new Error("expected test database");
    await database.client.unsafe(`
      CREATE FUNCTION p2_reject_persisted_ai_run() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'persisted' THEN
          RAISE EXCEPTION 'forced P2 atomic rollback canary';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER p2_reject_persisted_ai_run
      BEFORE UPDATE ON ai_runs
      FOR EACH ROW EXECUTE FUNCTION p2_reject_persisted_ai_run();
    `);
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        replyGenerator: {
          async generateReply() {
            return {
              decision: "reply_candidate",
              text: "Этот ответ должен откатиться вместе с run update.",
              metadata: { model_provider: "fake", raw_error: "NEVER_STORE_TRIGGER_ERROR" }
            };
          }
        },
        runRepository
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-postgres-rollback-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    const [runRows, outboundRows, conversationRows, spanRows, eventRows, timelineRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages).where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(conversations),
      database.db.select().from(aiRunSpans),
      database.db.select().from(aiQualityEvents),
      database.db.select().from(leadTimelineEvents)
    ]);
    expect(outboundRows).toHaveLength(0);
    expect(conversationRows).toMatchObject([
      { agentAllowedToReply: false, aiState: "needs_manager" }
    ]);
    expect(runRows).toMatchObject([
      { status: "failed", outcomeReason: "ai_persistence_unconfirmed", failureCode: "persistence_failure", outboundMessageId: null }
    ]);
    expect(eventRows).toMatchObject([
      { eventType: "runtime_failure", reasonCode: "ai_persistence_unconfirmed" }
    ]);
    expect(timelineRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "conversation.ai_manager_review_required",
          metadata: expect.objectContaining({
            reason: "ai_reply_persistence_unconfirmed"
          })
        })
      ])
    );
    expect(JSON.stringify({ runRows, spanRows, eventRows, timelineRows })).not.toContain(
      "NEVER_STORE_TRIGGER_ERROR"
    );
    expect(JSON.stringify({ runRows, spanRows, eventRows, timelineRows })).not.toContain(
      "forced P2 atomic rollback canary"
    );
  });

  it("never replays a visitor inbound that collides with the outbound idempotency key", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildApi({
      repository,
      widgetAi: {
        enabled: true,
        replyGenerator: {
          async generateReply(input) {
            const [acceptedInbound] = await database.db
              .select({
                conversationId: conversationMessages.conversationId,
                leadId: conversationMessages.leadId,
                channelIdentityId: conversationMessages.channelIdentityId
              })
              .from(conversationMessages)
              .where(
                eq(
                  conversationMessages.publicMessageId,
                  input.inboundMessage.publicMessageId
                )
              )
              .limit(1);

            if (!acceptedInbound) throw new Error("expected accepted inbound for collision test");

            const collisionAt = new Date("2026-07-14T21:00:00.500Z");
            await database.db.insert(conversationMessages).values({
              publicMessageId: randomUUID(),
              conversationId: acceptedInbound.conversationId,
              leadId: acceptedInbound.leadId,
              channelIdentityId: acceptedInbound.channelIdentityId,
              direction: "inbound",
              senderRole: "visitor",
              body: "Visitor collision canary",
              idempotencyKey: `ai:${input.inboundMessage.publicMessageId}`,
              requestFingerprint: "b".repeat(64),
              contentType: "text",
              metadata: { collision_canary: "visitor_inbound" },
              submittedAt: collisionAt,
              createdAt: collisionAt
            });

            return {
              decision: "reply_candidate",
              text: "Этот ответ не должен переиспользовать visitor inbound.",
              metadata: { model_provider: "fake" }
            };
          }
        },
        runRepository
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-postgres-outbound-collision-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    const [runRows, messageRows, conversationRows, timelineRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages),
      database.db.select().from(conversations),
      database.db.select().from(leadTimelineEvents)
    ]);
    const collisionRows = messageRows.filter((message) =>
      message.idempotencyKey.startsWith("ai:")
    );
    expect(collisionRows).toMatchObject([
      {
        direction: "inbound",
        senderRole: "visitor",
        body: "Visitor collision canary",
        metadata: { collision_canary: "visitor_inbound" }
      }
    ]);
    expect(messageRows.filter((message) => message.senderRole === "ai_assistant")).toHaveLength(0);
    expect(runRows).toMatchObject([
      {
        status: "failed",
        outcomeReason: "ai_persistence_unconfirmed",
        failureCode: "persistence_failure",
        outboundMessageId: null
      }
    ]);
    expect(conversationRows).toMatchObject([
      { agentAllowedToReply: false, aiState: "needs_manager" }
    ]);
    expect(timelineRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "conversation.ai_manager_review_required",
          metadata: expect.objectContaining({ reason: "ai_reply_persistence_unconfirmed" })
        })
      ])
    );
  });

  it("accepts only the approved runtime mode and decision profile pairs", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    app = buildApi({ repository });
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-runtime-profile-pairs-0001")
    });
    const [inbound] = await database.db
      .select({
        id: conversationMessages.id,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.direction, "inbound"))
      .limit(1);

    if (!inbound) throw new Error("expected accepted inbound message");

    const runRepository = new PostgresAiRunRepository(database.db);
    const directLegacy = p2BeginRunInput(inbound, "direct_openai", "legacy_s05");
    const mastraLive = p2BeginRunInput(inbound, "mastra_openai_api", "live_v2");

    await expect(runRepository.beginOrReplay(directLegacy)).resolves.toMatchObject({
      kind: "started",
      run: { runtimeMode: "direct_openai", decisionProfile: "legacy_s05" }
    });
    await expect(runRepository.beginOrReplay(mastraLive)).resolves.toMatchObject({
      kind: "started",
      run: { runtimeMode: "mastra_openai_api", decisionProfile: "live_v2" }
    });

    const directLive = p2BeginRunInput(inbound, "direct_openai", "live_v2");
    const mastraLegacy = p2BeginRunInput(inbound, "mastra_openai_api", "legacy_s05");

    await expect(runRepository.beginOrReplay(directLive)).rejects.toBeInstanceOf(
      AiRunInputInvariantError
    );
    await expect(runRepository.beginOrReplay(mastraLegacy)).rejects.toBeInstanceOf(
      AiRunInputInvariantError
    );
    await expect(
      database.db.insert(aiRuns).values(p2RunInsert(directLive))
    ).rejects.toMatchObject({
      cause: { constraint_name: "ai_runs_runtime_profile_check" }
    });
    await expect(
      database.db.insert(aiRuns).values(p2RunInsert(mastraLegacy))
    ).rejects.toMatchObject({
      cause: { constraint_name: "ai_runs_runtime_profile_check" }
    });
  });
});

function p2BeginRunInput(
  inbound: { id: string; leadId: string; conversationId: string },
  runtimeMode: BeginAiRunInput["runtimeMode"],
  decisionProfile: BeginAiRunInput["decisionProfile"]
): BeginAiRunInput {
  return {
    traceId: randomUUID(),
    leadId: inbound.leadId,
    conversationId: inbound.conversationId,
    inboundMessageId: inbound.id,
    channel: "site_widget",
    runtimeMode,
    decisionProfile,
    idempotencyKey: `ai-turn:${randomUUID()}`,
    inputFingerprint: "a".repeat(64),
    versions: {
      policyVersion: "p2_policy.v1",
      promptVersion: "p2_prompt.v1",
      toolVersion: "p2_tools.none.v1",
      disclosureVersion: "p2_disclosure.v1",
      modelProfileVersion: "p2_model_profile.v1",
      runtimeVersion: "p2_runtime.v1"
    },
    model: {
      modelProvider: "fake",
      requestedModelName: "p2-fake-model",
      reasoningEffort: runtimeMode === "mastra_openai_api" ? "medium" : "none"
    },
    startedAt: new Date("2026-07-14T21:00:01.000Z")
  };
}

function p2RunInsert(input: BeginAiRunInput) {
  return {
    traceId: input.traceId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    channel: input.channel,
    runtimeMode: input.runtimeMode,
    decisionProfile: input.decisionProfile,
    idempotencyKey: input.idempotencyKey,
    inputFingerprint: input.inputFingerprint,
    policyVersion: input.versions.policyVersion,
    promptVersion: input.versions.promptVersion,
    toolVersion: input.versions.toolVersion,
    disclosureVersion: input.versions.disclosureVersion,
    configuredModelProvider: input.model.modelProvider,
    configuredModelName: input.model.requestedModelName,
    reasoningEffort: input.model.reasoningEffort,
    modelProfileVersion: input.versions.modelProfileVersion,
    runtimeVersion: input.versions.runtimeVersion,
    startedAt: input.startedAt
  };
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-14T21:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "p2-postgres-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}
