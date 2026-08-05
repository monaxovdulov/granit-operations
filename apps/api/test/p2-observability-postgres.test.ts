import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import {
  aiRuntimeControls,
  aiQualityEvents,
  aiRunSpans,
  aiRuns,
  conversationMessages,
  conversations,
  leadTimelineEvents
} from "@granit/db";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import type { MastraLiveV2AgentPort } from "../src/modules/ai/adapters/mastra-live-v2-decision-generator.js";
import type {
  AiRunTerminalCompletion,
  BeginAiRunInput
} from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  AiRunInputInvariantError,
  PostgresAiRunRepository
} from "../src/modules/ai/repositories/postgres-ai-run-repository.js";
import { PostgresIntakeRepository } from "../src/modules/conversations/repositories/postgres-intake-repository.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  noReplyCandidate
} from "./fixtures/live-v2-synthetic.v1.js";
import {
  resetPostgresWidgetAiState,
  startPostgresWidgetAiTestHarness,
  type PostgresWidgetAiTestHarness
} from "./helpers/postgres-widget-ai-test-harness.js";

const TEST_PRECOMPUTED_COST_RATE_VERSION = "unit_test_precomputed_cost.v1";

describe.sequential("P2 PostgreSQL AI observability atomicity", () => {
  let database: PostgresWidgetAiTestHarness;
  let app: ReturnType<typeof buildApi> | undefined;

  beforeAll(async () => {
    database = await startPostgresWidgetAiTestHarness();
  }, 180_000);

  beforeEach(async () => {
    await resetPostgresWidgetAiState(database);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    await database?.client.unsafe("DROP TRIGGER IF EXISTS p2_reject_persisted_ai_run ON ai_runs");
    await database?.client.unsafe("DROP FUNCTION IF EXISTS p2_reject_persisted_ai_run()");
  });

  afterAll(async () => {
    await database?.stop();
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
    app = buildQueuedApi({
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
    const history = await waitForTerminalHistory(app, first);
    const replay = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });

    expect(first.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({ automation: { status: "replied" } });
    expect(replay.json()).toMatchObject({ status: "replayed", automation: { status: "replied" } });
    expect(first.json().trace_id).toBeUndefined();
    expect(generateReply).not.toHaveBeenCalled();

    const [runRows, outboundRows, spanRows, eventRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages).where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(aiRunSpans),
      database.db.select().from(aiQualityEvents)
    ]);
    expect(runRows).toHaveLength(1);
    expect(outboundRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      recordingContract: "native_grounded",
      status: "persisted",
      outboundMessageId: outboundRows[0]?.id,
      metadata: {
        queue_wait_ms: expect.any(Number),
        response_window_epoch: 1,
        responds_through_sequence: 1
      }
    });
    expect(spanRows).toHaveLength(0);
    expect(eventRows).toHaveLength(0);
  });

  it("supersedes the stale run when manager takeover advances the PostgreSQL turn fence", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildQueuedApi({
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

    const history = await waitForTerminalHistory(app, response);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({
      automation: { status: "superseded", reason: "turn_not_current" }
    });
    const [runRows, outboundRows, spanRows, eventRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db.select().from(conversationMessages).where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(aiRunSpans),
      database.db.select().from(aiQualityEvents)
    ]);
    expect(runRows).toMatchObject([
      {
        status: "running",
        outcomeReason: null,
        failureCode: null,
        sendGateResult: "not_checked"
      }
    ]);
    expect(outboundRows).toHaveLength(0);
    expect(spanRows).toHaveLength(0);
    expect(eventRows).toHaveLength(0);
  });

  it("does not call the generator while the global AI control is stopped", async () => {
    if (!database) throw new Error("expected test database");
    await database.db
      .update(aiRuntimeControls)
      .set({ enabled: false, version: 2 })
      .where(eq(aiRuntimeControls.scope, "site_widget"));
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    const generateReply = vi.fn(async () => ({
      decision: "reply_candidate" as const,
      text: "Этот генератор не должен быть вызван.",
      metadata: { model_provider: "fake" }
    }));
    app = buildQueuedApi({
      repository,
      widgetAi: { enabled: true, replyGenerator: { generateReply }, runRepository }
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-global-stop-before-generation-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: { status: "disabled" }
    });
    expect(generateReply).not.toHaveBeenCalled();
    expect(await database.db.select().from(aiRuns)).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.senderRole, "ai_assistant"))
    ).toHaveLength(0);
  });

  it("records a blocked run when a later global stop closes the PostgreSQL send gate", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildQueuedApi({
      repository,
      widgetAi: {
        enabled: true,
        replyGenerator: {
          async generateReply() {
            await database.db
              .update(aiRuntimeControls)
              .set({ enabled: false, version: 2 })
              .where(eq(aiRuntimeControls.scope, "site_widget"));
            return {
              decision: "reply_candidate",
              text: "Этот draft должен быть остановлен глобальным gate.",
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
      payload: widgetRequest("p2-global-stop-in-flight-0001")
    });

    const history = await waitForTerminalHistory(app, response);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({
      automation: { status: "superseded", reason: "agent_reply_blocked" }
    });
    expect(await database.db.select().from(aiRuns)).toMatchObject([
      {
        status: "blocked",
        outcomeReason: "agent_reply_blocked",
        failureCode: "send_gate_blocked",
        sendGateResult: "blocked"
      }
    ]);
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.senderRole, "ai_assistant"))
    ).toHaveLength(0);
  });

  it("rolls back the outbound and records a sanitized terminal failure", async () => {
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
    app = buildQueuedApi({
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

    const history = await waitForTerminalHistory(app, response);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]?.automation?.status).toMatch(/blocked|failed/);
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
      { agentAllowedToReply: true, aiState: "ai_collecting_info" }
    ]);
    expect(runRows).toMatchObject([
      {
        status: "failed",
        outcomeReason: "ai_persistence_unconfirmed",
        failureCode: "persistence_failure",
        sendGateResult: "not_checked"
      }
    ]);
    expect(spanRows.length).toBeGreaterThan(0);
    expect(eventRows).toMatchObject([
      { eventType: "runtime_failure", reasonCode: "ai_persistence_unconfirmed" }
    ]);
    expect(timelineRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "conversation.ai_manager_review_required" })
      ])
    );
    expect(JSON.stringify({ runRows, spanRows, eventRows, timelineRows })).not.toContain(
      "NEVER_STORE_TRIGGER_ERROR"
    );
    expect(JSON.stringify({ runRows, spanRows, eventRows, timelineRows })).not.toContain(
      "forced P2 atomic rollback canary"
    );
  });

  it("preserves a visitor collision without terminalizing the stale PostgreSQL run", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    app = buildQueuedApi({
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
              messageSequence: 2,
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

    const history = await waitForTerminalHistory(app, response);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({
      automation: { status: "superseded", reason: "turn_not_current" }
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
      { senderRole: "visitor", body: "Visitor collision canary" }
    ]);
    expect(messageRows.filter((message) => message.senderRole === "ai_assistant")).toHaveLength(0);
    expect(runRows).toMatchObject([
      {
        status: "running",
        outcomeReason: null,
        failureCode: null,
        sendGateResult: "not_checked"
      }
    ]);
    expect(conversationRows).toMatchObject([
      { agentAllowedToReply: true, aiState: "ai_collecting_info" }
    ]);
    expect(timelineRows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "conversation.ai_manager_review_required" })
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
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-runtime-profile-pairs-0002")
    });
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-runtime-profile-pairs-0003")
    });
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-runtime-profile-pairs-0004")
    });
    const inboundRows = await database.db
      .select({
        id: conversationMessages.id,
        publicMessageId: conversationMessages.publicMessageId,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.direction, "inbound"));

    const [directInbound, mastraInbound, directLiveInbound, mastraLegacyInbound] = inboundRows;
    if (!directInbound || !mastraInbound || !directLiveInbound || !mastraLegacyInbound) {
      throw new Error("expected four accepted inbound messages");
    }

    const runRepository = new PostgresAiRunRepository(database.db);
    const directLegacy = p2BeginRunInput(directInbound, "direct_openai", "legacy_s05");
    const mastraLive = p2BeginRunInput(mastraInbound, "mastra_openai_api", "live_v2");

    await expect(runRepository.beginOrReplay(directLegacy)).resolves.toMatchObject({
      kind: "started",
      run: { runtimeMode: "direct_openai", decisionProfile: "legacy_s05" }
    });
    await expect(runRepository.beginOrReplay(mastraLive)).resolves.toMatchObject({
      kind: "started",
      run: { runtimeMode: "mastra_openai_api", decisionProfile: "live_v2" }
    });

    const directLive = p2BeginRunInput(directLiveInbound, "direct_openai", "live_v2");
    const mastraLegacy = p2BeginRunInput(
      mastraLegacyInbound,
      "mastra_openai_api",
      "legacy_s05"
    );

    await expect(runRepository.beginOrReplay(directLive)).resolves.toMatchObject({
      kind: "started",
      run: { runtimeMode: "direct_openai", decisionProfile: "live_v2" }
    });
    await expect(runRepository.beginOrReplay(mastraLegacy)).rejects.toBeInstanceOf(
      AiRunInputInvariantError
    );
    await expect(
      database.db
        .insert(aiRuns)
        .values(p2RunInsert(mastraLegacy, mastraLegacyInbound.publicMessageId))
    ).rejects.toMatchObject({
      cause: { constraint_name: "ai_runs_runtime_profile_check" }
    });
  });

  it("persists and replays one recorded Mastra reply through PostgreSQL", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => ({
      candidate: answerCandidate(),
      modelProvider: "fake",
      providerModelName: "mastra-local-pg-fixture-v1",
      runtimeRunId: "mastra-local-pg-run-001",
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 }
    }));
    app = buildQueuedApi({
      repository,
      widgetAi: {
        enabled: true,
        runtimeMode: "mastra_openai_api",
        runRepository,
        localFake: {
          agent: { generate },
          modelName: "mastra-local-pg-fixture-v1",
          approvedFacts: TEST_LIVE_V2_FACTS
        }
      }
    });
    const payload = widgetRequest("m2-postgres-local-fake-0001");

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const history = await waitForTerminalHistory(app, first);
    const replay = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const [runRows, outboundRows, spanRows] = await Promise.all([
      database.db.select().from(aiRuns),
      database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.senderRole, "ai_assistant")),
      database.db.select().from(aiRunSpans)
    ]);

    expect(first.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({ automation: { status: "replied" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "replied" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(outboundRows).toHaveLength(1);
    expect(runRows).toMatchObject([
      {
        runtimeMode: "mastra_openai_api",
        decisionProfile: "live_v2",
        status: "persisted",
        runtimeRunId: "mastra-local-pg-run-001",
        observedModelProvider: "fake",
        observedModelName: "mastra-local-pg-fixture-v1",
        outboundMessageId: outboundRows[0]?.id
      }
    ]);
    expect(spanRows.length).toBeGreaterThan(0);
  });

  it("records a controlled Mastra no-reply once through PostgreSQL", async () => {
    if (!database) throw new Error("expected test database");
    const repository = new PostgresIntakeRepository(database.db);
    const runRepository = new PostgresAiRunRepository(database.db);
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => ({
      candidate: noReplyCandidate("missing_approved_fact"),
      modelProvider: "fake",
      providerModelName: "mastra-local-pg-fixture-v1",
      runtimeRunId: "mastra-local-pg-no-reply-001",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }
    }));
    app = buildQueuedApi({
      repository,
      widgetAi: {
        enabled: true,
        runtimeMode: "mastra_openai_api",
        runRepository,
        localFake: {
          agent: { generate },
          modelName: "mastra-local-pg-fixture-v1",
          approvedFacts: TEST_LIVE_V2_FACTS
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-postgres-controlled-no-reply-0001")
    });
    const history = await waitForTerminalHistory(app, response);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(history.messages[0]).toMatchObject({
      automation: { status: "blocked", reason: "missing_approved_fact" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(aiRuns)).toMatchObject([
      {
        runtimeMode: "mastra_openai_api",
        decisionProfile: "live_v2",
        status: "fallback_unavailable",
        outcomeReason: "missing_approved_fact",
        sendGateResult: "not_checked",
        runtimeRunId: "mastra-local-pg-no-reply-001"
      }
    ]);
    expect(
      await database.db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.senderRole, "ai_assistant"))
    ).toHaveLength(0);
  });

  it("persists and replays allowlisted externally precomputed cost evidence", async () => {
    if (!database) throw new Error("expected test database");
    const intakeRepository = new PostgresIntakeRepository(database.db);
    app = buildApi({ repository: intakeRepository });
    await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-runtime-evidence-0001")
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

    const repository = new PostgresAiRunRepository(database.db);
    const input = p2BeginRunInput(inbound, "mastra_openai_api", "live_v2");
    input.model = {
      modelProvider: "openai",
      requestedModelName: "gpt-5.6-sol",
      reasoningEffort: "medium"
    };
    const started = await repository.beginOrReplay(input);
    if (started.kind !== "started") throw new Error("expected a new Mastra run");

    const completion = {
      status: "failed",
      normalizedAction: "no_reply",
      outcomeReason: "generator_failed",
      failureCode: "runtime_failure",
      validatorResult: "failed",
      runtimeRunId: "mastra-local-run-001",
      observedModelProvider: "openai",
      observedModelName: "gpt-5.6-sol",
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      costEstimateMicrounits: 150,
      costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION,
      sendGateResult: "not_checked",
      completedAt: new Date(started.run.startedAt.getTime() + 10),
      latencyMs: 10,
      spans: [],
      qualityEvents: [],
      rawProviderPayload: "M2_RAW_PROVIDER_CANARY"
    } as AiRunTerminalCompletion;
    const terminal = await repository.completeWithoutReply({
      run: started.run,
      completion
    });
    const replay = await repository.beginOrReplay(input);
    const [row] = await database.db.select().from(aiRuns).where(eq(aiRuns.id, started.run.id));

    expect(terminal).toMatchObject({
      runtimeRunId: "mastra-local-run-001",
      model: {
        modelProvider: "openai",
        requestedModelName: "gpt-5.6-sol"
      },
      observedModelProvider: "openai",
      observedModelName: "gpt-5.6-sol",
      costEstimateMicrounits: 150,
      costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION
    });
    expect(replay).toEqual({ kind: "terminal_replay", run: terminal });
    expect(row).toMatchObject({
      runtimeRunId: "mastra-local-run-001",
      configuredModelProvider: "openai",
      configuredModelName: "gpt-5.6-sol",
      observedModelProvider: "openai",
      observedModelName: "gpt-5.6-sol",
      costEstimateMicrounits: 150,
      costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION
    });
    expect(JSON.stringify({ terminal, replay, row })).not.toContain(
      "M2_RAW_PROVIDER_CANARY"
    );
  });
});

function buildQueuedApi(options: Parameters<typeof buildApi>[0]): ReturnType<typeof buildApi> {
  return buildApi({
    ...options,
    widgetAi: options.widgetAi
      ? ({
          ...options.widgetAi,
          jobWorker: {
            enabled: true,
            pollIntervalMs: 10,
            leaseMs: 5_000,
            retryBackoffMs: 10,
            maxAttempts: 3
          }
        } as NonNullable<Parameters<typeof buildApi>[0]["widgetAi"]>)
      : undefined
  });
}

async function waitForTerminalHistory(
  currentApp: ReturnType<typeof buildApi>,
  accepted: { json(): Record<string, unknown> }
) {
  const publicSessionId = accepted.json().public_session_id;
  if (typeof publicSessionId !== "string") {
    throw new Error("accepted widget response did not include a public session id");
  }

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await currentApp.inject({
      method: "GET",
      url: `/public/intake/site-widget/sessions/${publicSessionId}/history?schema_version=site_widget.history.v2`
    });
    const history = response.json();
    const status = history.messages?.[0]?.automation?.status;
    if (status && !["pending", "processing", "retrying"].includes(status)) {
      return history;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("timed out waiting for terminal PostgreSQL widget history");
}

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

function p2RunInsert(input: BeginAiRunInput, inboundPublicMessageId: string) {
  return {
    traceId: input.traceId,
    leadId: input.leadId,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    inboundPublicMessageId,
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
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
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
