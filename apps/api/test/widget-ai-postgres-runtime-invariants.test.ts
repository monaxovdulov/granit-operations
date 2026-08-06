import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetV2MessageRequest
} from "@granit/contracts";
import {
  aiQualityEvents,
  aiRunAttempts,
  aiRunSpans,
  aiRuns,
  conversationHandoffs,
  conversationMessages,
  conversationRequirements,
  conversationSlots,
  conversations,
  managerTelegramBindings,
  managerUsers,
  widgetAiJobs
} from "@granit/db";
import { sha256Hex, stableStringify } from "@granit/shared";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildAppContext } from "../src/app-context.js";
import type { ObservedLiveV2DecisionGenerator } from "../src/modules/ai/ports/live-v2-runtime.js";
import type {
  AiRunRepository,
  AiRunTerminalCompletion,
  BeginAiRunInput,
  RunningAiRunRecord
} from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  AiRunInputInvariantError,
  AiRunReplayConflictError,
  completeAiRunInTransaction,
  PostgresAiRunRepository
} from "../src/modules/ai/repositories/postgres-ai-run-repository.js";
import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { PostgresIntakeRepository } from "../src/modules/conversations/repositories/postgres-intake-repository.js";
import { WidgetAiJobWorker } from "../src/modules/intake/services/widget-ai-job-worker.js";
import { PublicWidgetIntakeService } from "../src/modules/intake/use-cases/public-widget-intake-service.js";
import { validTelegramInbound } from "./helpers/telegram-fixtures.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
import {
  resetPostgresWidgetAiState,
  startPostgresWidgetAiTestHarness,
  type PostgresWidgetAiTestHarness
} from "./helpers/postgres-widget-ai-test-harness.js";

type Runtime = {
  repository: PostgresIntakeRepository;
  service: PublicWidgetIntakeService;
  worker: WidgetAiJobWorker;
};

type AcceptedV2Body = {
  ok: true;
  public_session_id: string;
  public_conversation_id: string;
  public_message_id: string;
};

describe.sequential("PR0a real PostgreSQL widget AI runtime invariants", () => {
  let harness: PostgresWidgetAiTestHarness;

  beforeAll(async () => {
    harness = await startPostgresWidgetAiTestHarness();
  }, 180_000);

  beforeEach(async () => {
    await resetPostgresWidgetAiState(harness);
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it("allows only one concurrent lease owner for one pending job", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("claim-one"));

    const now = readyNow();
    const claims = await Promise.all([
      repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now }),
      repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now })
    ]);
    const claimed = claims.filter(Boolean);
    const rows = await jobRows();

    expect(claimed).toHaveLength(1);
    expect(rows).toMatchObject([{ status: "processing", attemptCount: 1 }]);
    expect(await countMessagesByRole("visitor")).toBe(1);
  });

  it("reclaims an expired lease and ignores stale completion", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("lease-reclaim"));
    const first = await repository.claimSiteWidgetAiJob!({
      leaseMs: 5_000,
      now: readyNow()
    });
    expect(first).not.toBeNull();

    const second = await repository.claimSiteWidgetAiJob!({
      leaseMs: 5_000,
      now: new Date(Date.now() + 7_000)
    });
    expect(second).toMatchObject({ id: first!.id, attemptCount: 2 });

    await repository.finishSiteWidgetAiJob!({
      jobId: first!.id,
      attemptCount: first!.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: new Date(Date.now() + 60_000),
      completedAt: readyNow()
    });

    expect(await jobRows()).toMatchObject([{ status: "processing", attemptCount: 2 }]);
  });

  it("terminally fails the logical run when the final lease expires", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("final-lease-expiry"));
    await harness.db.update(widgetAiJobs).set({ maxAttempts: 1 });
    const claimTime = readyNow();
    const job = await repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now: claimTime });
    if (!job) throw new Error("expected final claimed attempt");
    const runRepository = new PostgresAiRunRepository(harness.db);
    const started = await runRepository.beginOrReplay({
      traceId: randomUUID(),
      leadId: job.leadId,
      conversationId: job.conversationId,
      inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
      attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:1`,
      attemptNumber: 1,
      jobId: job.id,
      jobAttemptCount: 1,
      maxAttempts: 1,
      inputFingerprint: sha256Hex(stableStringify(job.aiTurnInput)),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: claimTime
    });
    if (started.kind !== "started") throw new Error("expected a fresh final attempt");

    await expect(
      repository.claimSiteWidgetAiJob!({
        leaseMs: 5_000,
        now: new Date(claimTime.getTime() + 6_000)
      })
    ).resolves.toBeNull();
    expect(await jobRows()).toMatchObject([
      { status: "failed", attemptCount: 1, terminalReason: "worker_failed" }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "fenced" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        id: started.run.id,
        status: "failed",
        decisionAction: "no_reply",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure",
        winningAttemptId: null
      }
    ]);
    expect(await harness.db.select().from(aiQualityEvents)).toMatchObject([
      {
        aiRunId: started.run.id,
        aiRunAttemptId: started.run.attempt.id,
        eventType: "runtime_failure",
        reasonCode: "runtime_failed"
      }
    ]);
  });

  it("rejects a late begin after the final lease expired before an attempt existed", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("final-lease-before-begin"));
    await harness.db.update(widgetAiJobs).set({ maxAttempts: 1 });
    const claimTime = readyNow();
    const job = await repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now: claimTime });
    if (!job) throw new Error("expected final claimed job before begin");

    await expect(
      repository.claimSiteWidgetAiJob!({
        leaseMs: 5_000,
        now: new Date(claimTime.getTime() + 6_000)
      })
    ).resolves.toBeNull();
    expect(await jobRows()).toMatchObject([
      { status: "failed", attemptCount: 1, terminalReason: "worker_failed" }
    ]);

    const runRepository = new PostgresAiRunRepository(harness.db);
    await expect(
      runRepository.beginOrReplay({
        traceId: randomUUID(),
        leadId: job.leadId,
        conversationId: job.conversationId,
        inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
        channel: "site_widget",
        runtimeMode: "direct_openai",
        decisionProfile: "live_v2",
        idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
        attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:1`,
        attemptNumber: 1,
        jobId: job.id,
        jobAttemptCount: 1,
        maxAttempts: 1,
        inputFingerprint: sha256Hex(stableStringify(job.aiTurnInput)),
        versions: {
          policyVersion: "pr0b_policy.v1",
          promptVersion: "pr0b_prompt.v1",
          toolVersion: "pr0b_tools.none.v1",
          disclosureVersion: "pr0b_disclosure.v1",
          modelProfileVersion: "pr0b_model_profile.v1"
        },
        model: {
          modelProvider: "fake",
          requestedModelName: "pr0b-recorded-fake",
          reasoningEffort: "none"
        },
        startedAt: new Date(claimTime.getTime() + 6_001)
      })
    ).rejects.toBeInstanceOf(AiRunInputInvariantError);
    expect(await harness.db.select().from(aiRuns)).toHaveLength(0);
    expect(await aiAttemptRows()).toHaveLength(0);
  });

  it("fences an abort immediately after begin and closes the final logical run", async () => {
    const controller = new AbortController();
    const runRepository = new PostgresAiRunRepository(harness.db);
    const abortingRepository: AiRunRepository = {
      beginOrReplay: async (input) => {
        const result = await runRepository.beginOrReplay(input);
        if (result.kind === "started") controller.abort("abort_after_begin");
        return result;
      },
      completeWithoutReply: (input) => runRepository.completeWithoutReply(input),
      failAttempt: (input) => runRepository.failAttempt(input),
      fenceAttempt: (input) => runRepository.fenceAttempt(input)
    };
    const repository = new PostgresIntakeRepository(harness.db);
    const { service } = runtime(defaultGenerator(), repository, abortingRepository);
    await accept(service, widgetRequest("abort-after-begin"));
    await harness.db.update(widgetAiJobs).set({ maxAttempts: 1 });
    const claimTime = readyNow();
    const job = await repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now: claimTime });
    if (!job) throw new Error("expected claimed abort attempt");

    await expect(
      service.processClaimedSiteWidgetAiJob(job, controller.signal)
    ).rejects.toThrow("widget AI job execution aborted");
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "fenced" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      { status: "running", winningAttemptId: null }
    ]);

    await repository.finishSiteWidgetAiJob!({
      jobId: job.id,
      attemptCount: job.attemptCount,
      status: "failed",
      terminalReason: "worker_failed",
      completedAt: new Date(claimTime.getTime() + 100)
    });
    expect(await jobRows()).toMatchObject([
      { status: "failed", attemptCount: 1, terminalReason: "worker_failed" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "failed",
        decisionAction: "no_reply",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure",
        winningAttemptId: null
      }
    ]);
  });

  it("blocks an in-flight reply after manager takeover", async () => {
    const gate = barrier();
    let publicConversationId = "";
    const { repository, service, worker } = runtime({
      async generateReply(input) {
        publicConversationId = input.conversation.publicConversationId;
        gate.enter();
        await gate.wait;
        return replyWithAiRun("Этот draft должен быть заблокирован takeover.");
      }
    });
    await accept(service, widgetRequest("manager-takeover"));

    const running = worker.runOnce(readyNow());
    await gate.entered;
    await repository.takeoverConversationByPublicId({
      publicConversationId,
      changedByManagerId: randomUUID(),
      changedByManagerEmail: "owner@example.test",
      changedByManagerRole: "owner"
    });
    gate.release();

    expect(await running).toBe(true);
    expect(await countMessagesByRole("ai_assistant")).toBe(0);
    expect(await jobRows()).toMatchObject([
      {
        status: "superseded",
        attemptCount: 1,
        terminalReason: "turn_not_current"
      }
    ]);
    expect(await conversationRows()).toMatchObject([
      { agentAllowedToReply: false, aiState: "manager_active" }
    ]);
    const [takenOver] = await harness.db
      .select({ generationEpoch: conversations.generationEpoch })
      .from(conversations)
      .where(eq(conversations.publicConversationId, publicConversationId));
    expect(takenOver?.generationEpoch).toBe(2);
    expect(await aiRunRows()).toMatchObject([
      {
        recordingContract: "logical_recorded_v2",
        status: "failed",
        outboundLinked: false,
        sendGateResult: "not_checked"
      }
    ]);
    expect(await aiAttemptRows()).toMatchObject([{ status: "fenced" }]);
  });

  it("recovers exactly one outbound after reply commit succeeds but job finish fails", async () => {
    let calls = 0;
    const { repository, service, worker } = runtime({
      async generateReply() {
        calls += 1;
        return reply("Ответ сохранён один раз после retry.");
      }
    });
    await accept(service, widgetRequest("lost-finish"));
    const finish = repository.finishSiteWidgetAiJob!.bind(repository);
    let loseCompletion = true;
    repository.finishSiteWidgetAiJob = async (input) => {
      if (loseCompletion && input.status === "replied") {
        loseCompletion = false;
        throw new Error("job completion acknowledgement lost");
      }
      await finish(input);
    };

    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await jobRows()).toMatchObject([{ status: "replied", attemptCount: 1 }]);
    expect(await worker.runOnce(new Date(Date.now() + 2_000))).toBe(false);

    expect(calls).toBe(1);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await jobRows()).toMatchObject([{ status: "replied", attemptCount: 1 }]);
  });

  it("deduplicates concurrent duplicate widget intake and produces one reply", async () => {
    const { service, worker } = runtime();
    const payload = widgetRequest("duplicate-intake", { sessionId: undefined });

    const [left, right] = await Promise.all([
      service.acceptSiteWidgetMessage(payload),
      service.acceptSiteWidgetMessage(payload)
    ]);
    expect([left.body.ok, right.body.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(await countMessagesByRole("visitor")).toBe(1);
    expect(await jobRows()).toHaveLength(1);

    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await jobRows()).toMatchObject([{ status: "replied" }]);
  });

  it("schedules a newly accepted widget job 600ms after its creation", async () => {
    const { service } = runtime();
    await accept(service, widgetRequest("pr0c-min-debounce"));

    const [job] = await harness.db
      .select({
        availableAt: widgetAiJobs.availableAt,
        createdAt: widgetAiJobs.createdAt,
        expectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
        respondsThroughSequence: widgetAiJobs.respondsThroughSequence,
        inboundMessageSequence: conversationMessages.messageSequence,
        generationEpoch: conversations.generationEpoch,
        lastMessageSequence: conversations.lastMessageSequence
      })
      .from(widgetAiJobs)
      .innerJoin(conversationMessages, eq(widgetAiJobs.inboundMessageId, conversationMessages.id))
      .innerJoin(conversations, eq(widgetAiJobs.conversationId, conversations.id));
    expect(job).toBeDefined();
    expect(job!.availableAt.getTime() - job!.createdAt.getTime()).toBe(600);
    expect(job).toMatchObject({
      expectedGenerationEpoch: 1,
      respondsThroughSequence: 1,
      inboundMessageSequence: 1,
      generationEpoch: 1,
      lastMessageSequence: 1
    });
  });

  it("preserves watching while committing an otherwise allowed AI reply", async () => {
    const { service, worker } = runtime();
    const accepted = await accept(service, widgetRequest("pr0c-preserve-watching"));
    await harness.db
      .update(conversations)
      .set({ aiState: "watching", agentAllowedToReply: true })
      .where(eq(conversations.publicConversationId, accepted.public_conversation_id));

    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await conversationRows()).toEqual([{ agentAllowedToReply: true, aiState: "watching" }]);
  });

  it("advances generation epoch only for effective AI control changes", async () => {
    const { repository, service } = runtime();
    const accepted = await accept(service, widgetRequest("pr1-control-epoch"));
    const [identity] = await harness.db
      .select({
        leadId: conversations.leadId,
        generationEpoch: conversations.generationEpoch
      })
      .from(conversations)
      .where(eq(conversations.publicConversationId, accepted.public_conversation_id));
    expect(identity).toMatchObject({ generationEpoch: 1 });

    const managerId = randomUUID();
    await harness.db.insert(managerUsers).values({
      id: managerId,
      email: "owner@example.test",
      role: "owner",
      status: "active"
    });
    const actor = {
      changedByManagerId: managerId,
      changedByManagerEmail: "owner@example.test",
      changedByManagerRole: "owner"
    };
    await repository.setConversationAiControl({
      leadId: identity!.leadId,
      publicConversationId: accepted.public_conversation_id,
      enabled: true,
      ...actor
    });
    await repository.setConversationAiControl({
      leadId: identity!.leadId,
      publicConversationId: accepted.public_conversation_id,
      enabled: false,
      ...actor
    });
    await repository.setConversationAiControl({
      leadId: identity!.leadId,
      publicConversationId: accepted.public_conversation_id,
      enabled: true,
      ...actor
    });

    let control = await repository.getManagerAiControl();
    control = await repository.setManagerAiControl({
      enabled: true,
      expectedVersion: control.version,
      ...actor
    });
    control = await repository.setManagerAiControl({
      enabled: false,
      expectedVersion: control.version,
      ...actor
    });
    await repository.setManagerAiControl({
      enabled: true,
      expectedVersion: control.version,
      ...actor
    });

    const [updated] = await harness.db
      .select({ generationEpoch: conversations.generationEpoch })
      .from(conversations)
      .where(eq(conversations.publicConversationId, accepted.public_conversation_id));
    expect(updated?.generationEpoch).toBe(5);
  });

  it.each(["takeover", "conversation control"] as const)(
    "serializes concurrent inbound behind %s without stale AI re-enable or deadlock",
    async (controlKind) => {
      const { repository, service } = runtime();
      const controlKey = controlKind.replaceAll(" ", "-");
      const accepted = await accept(service, widgetRequest(`pr1-${controlKey}-race`));
      const [identity] = await harness.db
        .select({
          leadId: conversations.leadId,
          generationEpoch: conversations.generationEpoch
        })
        .from(conversations)
        .where(eq(conversations.publicConversationId, accepted.public_conversation_id));
      expect(identity).toMatchObject({ generationEpoch: 1 });

      const managerId = randomUUID();
      await harness.db.insert(managerUsers).values({
        id: managerId,
        email: `${controlKey}@example.test`,
        role: "owner",
        status: "active"
      });
      const actor = {
        changedByManagerId: managerId,
        changedByManagerEmail: `${controlKey}@example.test`,
        changedByManagerRole: "owner"
      };
      const leadBlocker = await harness.client.reserve();
      let blockerCommitted = false;

      await leadBlocker.unsafe("BEGIN");
      try {
        await leadBlocker.unsafe("SELECT id FROM leads WHERE id = $1 FOR UPDATE", [
          identity!.leadId
        ]);
        const control =
          controlKind === "takeover"
            ? repository.takeoverConversationByPublicId({
                publicConversationId: accepted.public_conversation_id,
                ...actor
              })
            : repository.setConversationAiControl({
                leadId: identity!.leadId,
                publicConversationId: accepted.public_conversation_id,
                enabled: false,
                ...actor
              });

        await waitForBlockedTransactions(1);
        const concurrentInbound = service.acceptSiteWidgetMessage(
          widgetRequest(`pr1-${controlKey}-race-inbound`, {
            sessionId: accepted.public_session_id,
            text: "Новое сообщение одновременно с manager control"
          })
        );
        await waitForBlockedTransactions(2);
        await leadBlocker.unsafe("COMMIT");
        blockerCommitted = true;

        const [, inboundResult] = await Promise.all([control, concurrentInbound]);
        const inbound = acceptBody(inboundResult);
        expect(inbound).toMatchObject({ ok: true });
      } finally {
        if (!blockerCommitted) {
          await leadBlocker.unsafe("ROLLBACK").catch(() => undefined);
        }
        leadBlocker.release();
      }

      expect(await conversationRows()).toEqual([
        { agentAllowedToReply: false, aiState: "manager_active" }
      ]);
      expect(await jobRows()).toHaveLength(1);
      expect(await countMessagesByRole("visitor")).toBe(2);
      const [afterRace] = await harness.db
        .select({
          generationEpoch: conversations.generationEpoch,
          lastMessageSequence: conversations.lastMessageSequence
        })
        .from(conversations)
        .where(eq(conversations.publicConversationId, accepted.public_conversation_id));
      expect(afterRace).toEqual({ generationEpoch: 3, lastMessageSequence: 2 });
    }
  );

  it("executes the PostgreSQL manager Telegram writer with monotonic sequence and epoch", async () => {
    const { repository } = runtime();
    const inbound = await repository.acceptInboundMessage(
      validTelegramInbound({
        idempotencyKey: "pr1-manager-writer-inbound",
        providerMessageId: "pr1-manager-writer-message",
        providerUpdateId: "pr1-manager-writer-update"
      })
    );
    const managerId = randomUUID();
    const managerEmail = "manager-writer@example.test";
    await harness.db.insert(managerUsers).values({
      id: managerId,
      email: managerEmail,
      role: "owner",
      status: "active"
    });
    const [binding] = await harness.db
      .insert(managerTelegramBindings)
      .values({
        managerUserId: managerId,
        provider: "telegram_bot",
        providerAccountId: "bot-main",
        externalChatId: "manager-chat-pr1",
        externalUserId: "manager-user-pr1",
        status: "active"
      })
      .returning({ id: managerTelegramBindings.id });
    expect(binding).toBeDefined();

    await repository.takeoverConversation({
      leadId: inbound.leadId,
      publicConversationId: inbound.publicConversationId,
      changedByManagerId: managerId,
      changedByManagerEmail: managerEmail,
      changedByManagerRole: "owner"
    });
    await repository.createManagerTelegramReplyContext({
      managerUserId: managerId,
      managerTelegramBindingId: binding!.id,
      publicConversationId: inbound.publicConversationId
    });
    const persisted = await repository.persistManagerTelegramReply({
      managerUserId: managerId,
      managerEmail,
      managerRole: "owner",
      managerTelegramBindingId: binding!.id,
      publicMessageId: randomUUID(),
      idempotencyKey: "pr1-manager-writer-reply",
      requestFingerprint: "pr1-manager-writer-reply-fingerprint",
      body: "Ответ менеджера",
      providerAccountId: "bot-main",
      externalChatId: "manager-chat-pr1",
      providerUpdateId: "manager-update-pr1",
      providerMessageId: "manager-message-pr1",
      metadata: { test_scope: "pr1_manager_writer" }
    });

    expect(persisted).toMatchObject({
      deliveryStatus: "pending",
      replayed: false
    });
    const messages = await harness.db
      .select({
        senderRole: conversationMessages.senderRole,
        messageSequence: conversationMessages.messageSequence
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, inbound.conversationId))
      .orderBy(asc(conversationMessages.messageSequence));
    expect(messages).toEqual([
      { senderRole: "visitor", messageSequence: 1 },
      { senderRole: "manager", messageSequence: 2 }
    ]);
    const [conversation] = await harness.db
      .select({
        generationEpoch: conversations.generationEpoch,
        lastMessageSequence: conversations.lastMessageSequence,
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState
      })
      .from(conversations)
      .where(eq(conversations.id, inbound.conversationId));
    expect(conversation).toEqual({
      generationEpoch: 3,
      lastMessageSequence: 2,
      agentAllowedToReply: false,
      aiState: "manager_active"
    });
  });

  it("persists one canonically linked production-shaped ai_run", async () => {
    const { service, worker } = runtime({
      async generateReply() {
        return replyWithAiRun("Production-shaped ответ проходит canonical ai_runs persistence.");
      }
    });

    const accepted = await accept(service, widgetRequest("production-shaped-ai-run"));
    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await countMessagesByRole("visitor")).toBe(1);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await jobRows()).toMatchObject([{ status: "replied" }]);
    await expect(aiRunRows()).resolves.toMatchObject([
      {
        recordingContract: "logical_recorded_v2",
        status: "persisted",
        inboundPublicMessageId: accepted.public_message_id,
        outboundLinked: true,
        sendGateResult: "allowed"
      }
    ]);
  });

  it("persists a linked degradation run and manager-visible quality evidence", async () => {
    const { service, worker } = runtime({
      async generateReply() {
        return {
          decision: "no_reply" as const,
          reason: "turn_timeout" as const,
          metadata: { model_provider: "none" }
        };
      }
    });

    const accepted = await accept(service, widgetRequest("canonical-degradation"));
    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await countMessagesByRole("ai_assistant")).toBe(0);

    const [runRows, eventRows] = await Promise.all([
      harness.db.select().from(aiRuns),
      harness.db.select().from(aiQualityEvents)
    ]);
    expect(runRows).toMatchObject([
      {
        recordingContract: "logical_recorded_v2",
        status: "fallback_unavailable",
        decisionAction: "no_reply",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure",
        inboundPublicMessageId: accepted.public_message_id,
        traceId: expect.any(String),
        configuredModelProvider: "openai",
        configuredModelName: "gpt-5.6-luna",
        observedModelProvider: "none",
        observedModelName: null,
        metadata: {}
      }
    ]);
    expect(eventRows).toMatchObject([
      {
        aiRunId: runRows[0]!.id,
        messageId: runRows[0]!.inboundMessageId,
        eventType: "runtime_failure",
        reasonCode: "runtime_failed",
        severity: "critical",
        managerVisible: true,
        resolutionStatus: "open"
      }
    ]);
  });

  it("starts, replays and completes a logical recorded run with child evidence", async () => {
    const { service } = runtime();
    const accepted = await accept(service, widgetRequest("native-recorded-replay"));
    const [inbound] = await harness.db
      .select({
        id: conversationMessages.id,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.publicMessageId, accepted.public_message_id));
    if (!inbound) throw new Error("expected accepted inbound message");

    const repository = new PostgresAiRunRepository(harness.db);
    const input: BeginAiRunInput = {
      traceId: randomUUID(),
      leadId: inbound.leadId,
      conversationId: inbound.conversationId,
      inboundMessageId: inbound.id,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: `ai-turn:${inbound.id}`,
      attemptIdempotencyKey: `ai-turn:${inbound.id}:attempt:1`,
      attemptNumber: 1,
      jobAttemptCount: 1,
      inputFingerprint: "d".repeat(64),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1",
        runtimeVersion: "pr0b_runtime.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: new Date("2026-08-04T11:00:00.000Z")
    };
    const started = await repository.beginOrReplay(input);
    if (started.kind !== "started") throw new Error("expected a new recorded run");

    await expect(
      harness.db
        .update(aiRuns)
        .set({ configuredModelName: null })
        .where(eq(aiRuns.id, started.run.id))
    ).rejects.toMatchObject({
      cause: { constraint_name: "ai_runs_contract_evidence_check" }
    });
    await expect(
      repository.beginOrReplay({
        ...input,
        traceId: randomUUID(),
        startedAt: new Date("2026-08-04T11:00:00.010Z")
      })
    ).resolves.toEqual({
      kind: "running_replay",
      run: started.run
    });
    for (const mismatch of [
      {
        ...input,
        versions: { ...input.versions, promptVersion: "pr0b_prompt.v2" }
      },
      {
        ...input,
        model: { ...input.model, requestedModelName: "pr0b-recorded-fake-v2" }
      }
    ]) {
      await expect(repository.beginOrReplay(mismatch)).rejects.toBeInstanceOf(
        AiRunReplayConflictError
      );
    }
    await expect(
      repository.beginOrReplay({
        ...input,
        inboundMessageId: randomUUID(),
        idempotencyKey: `ai-turn:${randomUUID()}`
      })
    ).rejects.toBeInstanceOf(AiRunInputInvariantError);

    const completion: AiRunTerminalCompletion = {
      status: "fallback_unavailable",
      normalizedAction: "no_reply",
      outcomeReason: "no_safe_answer",
      validatorResult: "passed",
      observedModelProvider: "none",
      sendGateResult: "not_checked",
      completedAt: new Date("2026-08-04T11:00:00.100Z"),
      latencyMs: 100,
      spans: [
        {
          spanId: "model-1",
          kind: "model",
          name: "model_generation",
          status: "failed",
          latencyMs: 90,
          errorCode: "model_error"
        }
      ],
      qualityEvents: [
        {
          eventType: "model_failure",
          reasonCode: "model_error",
          severity: "error",
          managerVisible: true
        }
      ]
    };
    const terminal = await repository.completeWithoutReply({
      run: started.run,
      completion
    });
    await expect(repository.beginOrReplay(input)).resolves.toEqual({
      kind: "terminal_replay",
      run: terminal
    });

    const [runRows, spanRows, eventRows] = await Promise.all([
      harness.db.select().from(aiRuns).where(eq(aiRuns.id, started.run.id)),
      harness.db.select().from(aiRunSpans).where(eq(aiRunSpans.aiRunId, started.run.id)),
      harness.db.select().from(aiQualityEvents).where(eq(aiQualityEvents.aiRunId, started.run.id))
    ]);
    expect(runRows).toMatchObject([
      {
        recordingContract: "logical_recorded_v2",
        winningAttemptId: started.run.attempt.id,
        status: "fallback_unavailable",
        inboundMessageId: inbound.id,
        inboundPublicMessageId: accepted.public_message_id,
        configuredModelProvider: "fake",
        configuredModelName: "pr0b-recorded-fake",
        traceId: input.traceId
      }
    ]);
    expect(spanRows).toMatchObject([
      {
        aiRunId: started.run.id,
        aiRunAttemptId: started.run.attempt.id,
        spanId: "model-1",
        status: "failed"
      }
    ]);
    expect(eventRows).toMatchObject([
      {
        aiRunId: started.run.id,
        aiRunAttemptId: started.run.attempt.id,
        messageId: inbound.id,
        eventType: "model_failure",
        reasonCode: "model_error",
        managerVisible: true
      }
    ]);
  });

  it("records a failed no-reply terminal without a winning attempt", async () => {
    const { service } = runtime();
    const accepted = await accept(service, widgetRequest("recorded-failed-terminal"));
    const [inbound] = await harness.db
      .select({
        id: conversationMessages.id,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.publicMessageId, accepted.public_message_id));
    if (!inbound) throw new Error("expected accepted inbound message");

    const repository = new PostgresAiRunRepository(harness.db);
    const input: BeginAiRunInput = {
      traceId: randomUUID(),
      leadId: inbound.leadId,
      conversationId: inbound.conversationId,
      inboundMessageId: inbound.id,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: `ai-turn:${inbound.id}`,
      attemptIdempotencyKey: `ai-turn:${inbound.id}:attempt:1`,
      attemptNumber: 1,
      jobAttemptCount: 1,
      inputFingerprint: "c".repeat(64),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: new Date("2026-08-04T11:05:00.000Z")
    };
    const started = await repository.beginOrReplay(input);
    if (started.kind !== "started") throw new Error("expected failed terminal attempt");

    const terminal = await repository.completeWithoutReply({
      run: started.run,
      completion: failedTerminalCompletion(started.run)
    });
    expect(terminal).toMatchObject({ status: "failed", failureCode: "recorder_failure" });
    expect(terminal.winningAttemptId).toBeUndefined();
    expect(await harness.db.select().from(aiRuns).where(eq(aiRuns.id, started.run.id))).toMatchObject([
      { status: "failed", winningAttemptId: null }
    ]);
    expect(await aiAttemptRows()).toMatchObject([{ status: "failed" }]);
    await expect(repository.beginOrReplay(input)).resolves.toEqual({
      kind: "terminal_replay",
      run: terminal
    });
  });

  it("keeps retry failure attempt-scoped and fails the logical run at max attempts", async () => {
    const { service } = runtime();
    const accepted = await accept(service, widgetRequest("recorded-attempt-failure-budget"));
    const [inbound] = await harness.db
      .select({
        id: conversationMessages.id,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.publicMessageId, accepted.public_message_id));
    if (!inbound) throw new Error("expected accepted inbound message");

    const repository = new PostgresAiRunRepository(harness.db);
    const firstInput: BeginAiRunInput = {
      traceId: randomUUID(),
      leadId: inbound.leadId,
      conversationId: inbound.conversationId,
      inboundMessageId: inbound.id,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: `ai-turn:${inbound.id}`,
      attemptIdempotencyKey: `ai-turn:${inbound.id}:attempt:1`,
      attemptNumber: 1,
      jobAttemptCount: 1,
      maxAttempts: 2,
      inputFingerprint: "e".repeat(64),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: new Date("2026-08-04T11:10:00.000Z")
    };
    const first = await repository.beginOrReplay(firstInput);
    if (first.kind !== "started") throw new Error("expected first attempt");
    await repository.failAttempt({
      run: first.run,
      completion: failedAttemptCompletion(first.run, "2026-08-04T11:10:00.100Z")
    });

    const secondInput: BeginAiRunInput = {
      ...firstInput,
      traceId: randomUUID(),
      attemptIdempotencyKey: `ai-turn:${inbound.id}:attempt:2`,
      attemptNumber: 2,
      jobAttemptCount: 2,
      startedAt: new Date("2026-08-04T11:10:01.000Z")
    };
    const second = await repository.beginOrReplay(secondInput);
    if (second.kind !== "started") throw new Error("expected second attempt");
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      { id: first.run.id, status: "running", winningAttemptId: null }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "failed" },
      { attemptNumber: 2, jobAttemptCount: 2, status: "running" }
    ]);

    await repository.failAttempt({
      run: second.run,
      completion: failedAttemptCompletion(second.run, "2026-08-04T11:10:01.100Z")
    });
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      { id: first.run.id, status: "failed", winningAttemptId: null }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "failed" },
      { attemptNumber: 2, jobAttemptCount: 2, status: "failed" }
    ]);
    await expect(repository.beginOrReplay(secondInput)).resolves.toMatchObject({
      kind: "terminal_replay",
      run: { id: first.run.id, status: "failed" }
    });
  });

  it("records every queue execution failure and exhausts the shared attempt budget", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("recorded-queue-failure-budget"));
    const runRepository = new PostgresAiRunRepository(harness.db);
    const attemptRuns: RunningAiRunRecord[] = [];

    for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
      const claimTime = new Date(Date.now() + attemptNumber * 1_000);
      const job = await repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now: claimTime });
      if (!job) throw new Error(`expected claimed attempt ${attemptNumber}`);
      const started = await runRepository.beginOrReplay({
        traceId: randomUUID(),
        leadId: job.leadId,
        conversationId: job.conversationId,
        inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
        channel: "site_widget",
        runtimeMode: "direct_openai",
        decisionProfile: "live_v2",
        idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
        attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:${job.attemptCount}`,
        attemptNumber: job.attemptCount,
        jobId: job.id,
        jobAttemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        inputFingerprint: sha256Hex(stableStringify(job.aiTurnInput)),
        versions: {
          policyVersion: "pr0b_policy.v1",
          promptVersion: "pr0b_prompt.v1",
          toolVersion: "pr0b_tools.none.v1",
          disclosureVersion: "pr0b_disclosure.v1",
          modelProfileVersion: "pr0b_model_profile.v1"
        },
        model: {
          modelProvider: "fake",
          requestedModelName: "pr0b-recorded-fake",
          reasoningEffort: "none"
        },
        startedAt: claimTime
      });
      if (started.kind !== "started") throw new Error("expected a fresh physical attempt");
      attemptRuns.push(started.run);
      const completedAt = new Date(claimTime.getTime() + 100);
      await repository.failRecordedSiteWidgetAiAttempt({
        run: started.run,
        completion: failedAttemptCompletion(started.run, completedAt.toISOString()),
        inboundPublicMessageId: job.inboundPublicMessageId,
        expectedGenerationEpoch: job.expectedGenerationEpoch,
        respondsThroughSequence: job.respondsThroughSequence,
        runtimeMode: job.runtimeMode,
        jobCommit: {
          jobId: job.id,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts
        }
      });
      if (attemptNumber < job.maxAttempts) {
        await repository.finishSiteWidgetAiJob!({
          jobId: job.id,
          attemptCount: job.attemptCount,
          status: "retrying",
          terminalReason: "worker_failed",
          retryAt: completedAt,
          completedAt
        });
      }
    }

    expect(new Set(attemptRuns.map((run) => run.id))).toEqual(new Set([attemptRuns[0]!.id]));
    expect(await jobRows()).toMatchObject([
      { status: "failed", attemptCount: 3, terminalReason: "worker_failed" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      { status: "failed", winningAttemptId: null, outboundMessageId: null }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "failed" },
      { attemptNumber: 2, jobAttemptCount: 2, status: "failed" },
      { attemptNumber: 3, jobAttemptCount: 3, status: "failed" }
    ]);
    expect(await countMessagesByRole("ai_assistant")).toBe(0);
  });

  it("survives pre-begin retry gaps and closes the logical run on a final gap", async () => {
    const { repository, service } = runtime();
    await accept(service, widgetRequest("recorded-pre-begin-attempt-gap"));
    await harness.db.update(widgetAiJobs).set({ maxAttempts: 4 });
    const runRepository = new PostgresAiRunRepository(harness.db);
    const firstClaimAt = readyNow();

    const beginClaimedAttempt = async (
      job: NonNullable<Awaited<ReturnType<typeof repository.claimSiteWidgetAiJob>>>,
      startedAt: Date
    ) => {
      const started = await runRepository.beginOrReplay({
        traceId: randomUUID(),
        leadId: job.leadId,
        conversationId: job.conversationId,
        inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
        channel: "site_widget",
        runtimeMode: "direct_openai",
        decisionProfile: "live_v2",
        idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
        attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:${job.attemptCount}`,
        attemptNumber: job.attemptCount,
        jobId: job.id,
        jobAttemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        inputFingerprint: sha256Hex(stableStringify(job.aiTurnInput)),
        versions: {
          policyVersion: "pr0b_policy.v1",
          promptVersion: "pr0b_prompt.v1",
          toolVersion: "pr0b_tools.none.v1",
          disclosureVersion: "pr0b_disclosure.v1",
          modelProfileVersion: "pr0b_model_profile.v1"
        },
        model: {
          modelProvider: "fake",
          requestedModelName: "pr0b-recorded-fake",
          reasoningEffort: "none"
        },
        startedAt
      });
      if (started.kind !== "started") throw new Error("expected a fresh physical attempt");
      return started.run;
    };

    const first = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: firstClaimAt });
    if (!first) throw new Error("expected first claimed attempt");
    const firstRun = await beginClaimedAttempt(first, firstClaimAt);
    const firstFailedAt = new Date(firstClaimAt.getTime() + 100);
    await repository.failRecordedSiteWidgetAiAttempt({
      run: firstRun,
      completion: failedAttemptCompletion(firstRun, firstFailedAt.toISOString()),
      inboundPublicMessageId: first.inboundPublicMessageId,
      expectedGenerationEpoch: first.expectedGenerationEpoch,
      respondsThroughSequence: first.respondsThroughSequence,
      runtimeMode: first.runtimeMode,
      jobCommit: {
        jobId: first.id,
        attemptCount: first.attemptCount,
        maxAttempts: first.maxAttempts
      }
    });
    await repository.finishSiteWidgetAiJob({
      jobId: first.id,
      attemptCount: first.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: firstFailedAt,
      completedAt: firstFailedAt
    });

    const secondClaimAt = new Date(firstClaimAt.getTime() + 200);
    const second = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: secondClaimAt });
    if (!second) throw new Error("expected pre-begin second claim");
    const secondFailedAt = new Date(secondClaimAt.getTime() + 100);
    await repository.finishSiteWidgetAiJob({
      jobId: second.id,
      attemptCount: second.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: secondFailedAt,
      completedAt: secondFailedAt
    });

    const thirdClaimAt = new Date(firstClaimAt.getTime() + 400);
    const third = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: thirdClaimAt });
    if (!third) throw new Error("expected third claim after the ledger gap");
    const thirdRun = await beginClaimedAttempt(third, thirdClaimAt);
    expect(thirdRun.attempt).toMatchObject({ attemptNumber: 3, jobAttemptCount: 3 });
    const thirdFailedAt = new Date(thirdClaimAt.getTime() + 100);
    await repository.failRecordedSiteWidgetAiAttempt({
      run: thirdRun,
      completion: failedAttemptCompletion(thirdRun, thirdFailedAt.toISOString()),
      inboundPublicMessageId: third.inboundPublicMessageId,
      expectedGenerationEpoch: third.expectedGenerationEpoch,
      respondsThroughSequence: third.respondsThroughSequence,
      runtimeMode: third.runtimeMode,
      jobCommit: {
        jobId: third.id,
        attemptCount: third.attemptCount,
        maxAttempts: third.maxAttempts
      }
    });
    await repository.finishSiteWidgetAiJob({
      jobId: third.id,
      attemptCount: third.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: thirdFailedAt,
      completedAt: thirdFailedAt
    });

    const fourthClaimAt = new Date(firstClaimAt.getTime() + 600);
    const fourth = await repository.claimSiteWidgetAiJob({ leaseMs: 5_000, now: fourthClaimAt });
    if (!fourth) throw new Error("expected final pre-begin claim");
    const fourthFailedAt = new Date(fourthClaimAt.getTime() + 100);
    await repository.finishSiteWidgetAiJob({
      jobId: fourth.id,
      attemptCount: fourth.attemptCount,
      status: "failed",
      terminalReason: "worker_failed",
      completedAt: fourthFailedAt
    });

    expect(await jobRows()).toMatchObject([
      { status: "failed", attemptCount: 4, terminalReason: "worker_failed" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "failed",
        outcomeReason: "generator_failed",
        failureCode: "runtime_failure",
        winningAttemptId: null
      }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "failed" },
      { attemptNumber: 3, jobAttemptCount: 3, status: "failed" }
    ]);
    expect(await countAiRuns()).toBe(1);
  });

  it("atomically commits the direct model-turn body, hash, patches, handoff, run and job", async () => {
    const repository = new PostgresIntakeRepository(harness.db);
    const finalText = "Подберём подходящий вариант.";
    const generator: ObservedLiveV2DecisionGenerator = {
      async generateDecision() {
        return {
          candidate: {
            version: "granit_model_turn.v1",
            message: { answerText: finalText, question: null },
            statePatches: [
              {
                operation: "set_slot",
                name: "material",
                value: "чёрный гранит",
                confidence: 0.96,
                evidence: { quote: "чёрный гранит" }
              },
              {
                operation: "upsert_requirement",
                category: "decoration",
                mode: "avoidance",
                value: "золото",
                confidence: 0.9,
                evidence: { quote: "без золота" }
              }
            ],
            recommendationIds: [],
            handoffIntent: { reason: "customer_ready_to_order" }
          },
          observation: {
            observedModelProvider: "openai",
            observedModelName: "gpt-5.6-luna",
            runtimeRunId: "resp_postgres_model_turn_001",
            usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 }
          }
        };
      }
    };
    const runRepository = new PostgresAiRunRepository(harness.db);
    const context = buildAppContext({
      repository,
      widgetAi: {
        enabled: true,
        runRepository,
        directLiveV2: {
          generator,
          modelName: "gpt-5.6-luna",
          approvedFacts: TEST_LIVE_V2_FACTS
        },
        jobWorker: {
          enabled: true,
          pollIntervalMs: 10,
          leaseMs: 5_000,
          retryBackoffMs: 10,
          maxAttempts: 3
        }
      }
    });
    const worker = new WidgetAiJobWorker(repository, context.publicIntake.siteWidget, {
      pollIntervalMs: 10,
      leaseMs: 5_000,
      retryBackoffMs: 10
    });

    await accept(
      context.publicIntake.siteWidget,
      widgetRequest("direct-model-turn-postgres", {
        text: "Нужен памятник: чёрный гранит, без золота"
      })
    );
    const [queuedJob] = await harness.db
      .select({ availableAt: widgetAiJobs.availableAt })
      .from(widgetAiJobs);
    if (!queuedJob) throw new Error("expected queued direct model-turn job");
    expect(await worker.runOnce(new Date(queuedJob.availableAt.getTime() + 1))).toBe(true);
    expect(await jobRows()).toEqual([
      { status: "replied", attemptCount: 1, terminalReason: "handoff" }
    ]);

    const [outbound] = await harness.db
      .select({
        id: conversationMessages.id,
        publicMessageId: conversationMessages.publicMessageId,
        body: conversationMessages.body,
        metadata: conversationMessages.metadata
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.senderRole, "ai_assistant"));
    const [run] = await harness.db.select().from(aiRuns);
    const [slot] = await harness.db.select().from(conversationSlots);
    const [requirement] = await harness.db.select().from(conversationRequirements);
    const [handoff] = await harness.db.select().from(conversationHandoffs);
    const [conversation] = await harness.db.select().from(conversations);

    expect(outbound).toMatchObject({
      body: finalText,
      metadata: {
        turn_contract: "granit_model_turn.v1",
        final_text_hash: sha256Hex(finalText),
        applied_patch_count: 2
      }
    });
    expect(run).toMatchObject({
      status: "handed_off",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      runtimeRunId: "resp_postgres_model_turn_001",
      configuredModelName: "gpt-5.6-luna",
      reasoningEffort: "medium",
      outboundMessageId: outbound?.id,
      outboundPublicMessageId: outbound?.publicMessageId,
      sendGateResult: "allowed"
    });
    expect(slot).toMatchObject({
      name: "material",
      value: "чёрный гранит",
      evidenceQuote: "чёрный гранит",
      confidencePermille: 960
    });
    expect(requirement).toMatchObject({
      category: "decoration",
      mode: "avoidance",
      value: "золото",
      evidenceQuote: "без золота",
      confidencePermille: 900
    });
    expect(handoff).toMatchObject({
      reason: "lead_ready",
      summary: "Нужен памятник: чёрный гранит, без золота",
      outboundPublicMessageId: outbound?.publicMessageId,
      status: "active"
    });
    expect(conversation).toMatchObject({
      aiState: "needs_manager",
      agentAllowedToReply: false
    });
    expect(await jobRows()).toMatchObject([
      { status: "replied", attemptCount: 1, terminalReason: "handoff" }
    ]);
  });

  it("atomically completes and replays a reply-bearing recorded run with public linkage", async () => {
    const { service } = runtime();
    const accepted = await accept(service, widgetRequest("native-recorded-reply"));
    const [inbound] = await harness.db
      .select({
        id: conversationMessages.id,
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.publicMessageId, accepted.public_message_id));
    if (!inbound) throw new Error("expected accepted inbound message");

    const repository = new PostgresAiRunRepository(harness.db);
    const input: BeginAiRunInput = {
      traceId: randomUUID(),
      leadId: inbound.leadId,
      conversationId: inbound.conversationId,
      inboundMessageId: inbound.id,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: `ai-turn:${inbound.id}`,
      attemptIdempotencyKey: `ai-turn:${inbound.id}:attempt:1`,
      attemptNumber: 1,
      jobAttemptCount: 1,
      inputFingerprint: "e".repeat(64),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1",
        runtimeVersion: "pr0b_runtime.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: new Date("2026-08-04T12:00:00.000Z")
    };
    const started = await repository.beginOrReplay(input);
    if (started.kind !== "started") throw new Error("expected a new recorded run");

    const completed = await harness.db.transaction(async (tx) => {
      const [sequence] = await tx
        .update(conversations)
        .set({
          lastMessageSequence: sql`${conversations.lastMessageSequence} + 1`
        })
        .where(eq(conversations.id, inbound.conversationId))
        .returning({ messageSequence: conversations.lastMessageSequence });
      if (!sequence) throw new Error("expected recorded outbound sequence");

      const [outbound] = await tx
        .insert(conversationMessages)
        .values({
          publicMessageId: randomUUID(),
          conversationId: inbound.conversationId,
          leadId: inbound.leadId,
          direction: "outbound",
          senderRole: "ai_assistant",
          messageSequence: sequence.messageSequence,
          body: "Recorded reply persisted with canonical linkage.",
          idempotencyKey: `ai:${accepted.public_message_id}`,
          requestFingerprint: "f".repeat(64),
          submittedAt: new Date("2026-08-04T12:00:00.100Z"),
          createdAt: new Date("2026-08-04T12:00:00.100Z")
        })
        .returning({
          id: conversationMessages.id,
          publicMessageId: conversationMessages.publicMessageId
        });
      if (!outbound) throw new Error("expected recorded outbound message");

      const completion: AiRunTerminalCompletion = {
        status: "persisted",
        normalizedAction: "answer",
        outcomeReason: "reply_persisted",
        validatorResult: "passed",
        observedModelProvider: "fake",
        observedModelName: "pr0b-recorded-fake",
        sendGateResult: "allowed",
        sendGateCheckedAt: new Date("2026-08-04T12:00:00.090Z"),
        completedAt: new Date("2026-08-04T12:00:00.100Z"),
        latencyMs: 100,
        spans: [
          {
            spanId: "reply-persistence-1",
            kind: "runtime",
            name: "reply_persistence",
            status: "succeeded",
            latencyMs: 10,
            usedInFinalAnswer: true
          }
        ],
        qualityEvents: []
      };
      const run = await completeAiRunInTransaction(tx, {
        run: started.run,
        completion,
        outboundMessageId: outbound.id
      });
      return { run, outbound };
    });

    await expect(repository.beginOrReplay(input)).resolves.toEqual({
      kind: "terminal_replay",
      run: completed.run
    });
    const [runRow] = await harness.db.select().from(aiRuns).where(eq(aiRuns.id, started.run.id));
    expect(runRow).toMatchObject({
      recordingContract: "logical_recorded_v2",
      winningAttemptId: started.run.attempt.id,
      status: "persisted",
      outboundMessageId: completed.outbound.id,
      outboundPublicMessageId: completed.outbound.publicMessageId,
      sendGateResult: "allowed"
    });
    expect(completed.run).toMatchObject({
      outboundMessageId: completed.outbound.id,
      status: "persisted",
      normalizedAction: "answer"
    });
  });

  it("collapses a burst to one fresh response window", async () => {
    const sessionId = randomUUID();
    let generationCalls = 0;
    let compactContextTexts: string[] = [];
    const { service, worker } = runtime({
      async generateReply(input) {
        generationCalls += 1;
        compactContextTexts = input.compactContext.messages.map((message) => message.text);
        return reply(`Ответ на: ${input.inboundMessage.text}`);
      }
    });
    await accept(service, widgetRequest("burst-1", { sessionId, text: "Первый вопрос" }));
    await accept(service, widgetRequest("burst-2", { sessionId, text: "Уточнение" }));
    await accept(service, widgetRequest("burst-3", { sessionId, text: "Финальный контекст" }));
    await harness.client.unsafe(`
      UPDATE conversation_messages
      SET created_at = '2026-08-04T12:00:00.000Z'::timestamptz,
          submitted_at = '2026-08-04T12:00:10.000Z'::timestamptz
            - (message_sequence * interval '1 second')
      WHERE sender_role = 'visitor'
    `);

    await drain(worker, 3);

    expect(generationCalls).toBe(1);
    expect(compactContextTexts).toEqual(["Первый вопрос", "Уточнение", "Финальный контекст"]);
    expect(await countMessagesByRole("visitor")).toBe(3);
    expect(await jobRows()).toMatchObject([
      { status: "superseded", terminalReason: "newer_inbound" },
      { status: "superseded", terminalReason: "newer_inbound" },
      { status: "replied" }
    ]);
    expect(await outboundRows()).toMatchObject([
      {
        body: "Ответ на: Финальный контекст",
        idempotencyKey: expect.stringMatching(/^ai-window:/)
      }
    ]);
  });

  it("retires migrated non-latest pending jobs before history polling", async () => {
    const sessionId = randomUUID();
    const { service, worker } = runtime();

    await accept(service, widgetRequest("legacy-backlog-1", { sessionId, text: "Первый вопрос" }));
    await accept(
      service,
      widgetRequest("legacy-backlog-2", {
        sessionId,
        text: "Актуальный вопрос"
      })
    );

    // Reproduce the 0016 -> 0018 backfill shape: several legacy pending jobs
    // receive the conversation's current epoch while keeping their own inbound sequence.
    await harness.db
      .update(widgetAiJobs)
      .set({
        status: "pending",
        terminalReason: null,
        completedAt: null,
        expectedGenerationEpoch: 2,
        availableAt: new Date(0)
      })
      .where(eq(widgetAiJobs.respondsThroughSequence, 1));

    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await jobRows()).toMatchObject([
      { status: "superseded", terminalReason: "turn_not_current" },
      { status: "replied" }
    ]);

    const history = await service.getSiteWidgetHistory(sessionId, "site_widget.history.v2");
    expect(history.body).toMatchObject({ poll_after_ms: undefined });
  });

  it("retires an expired non-latest processing job after worker loss", async () => {
    const sessionId = randomUUID();
    const { service, worker } = runtime();

    await accept(
      service,
      widgetRequest("lost-worker-backlog-1", {
        sessionId,
        text: "Первый вопрос"
      })
    );
    await accept(
      service,
      widgetRequest("lost-worker-backlog-2", {
        sessionId,
        text: "Актуальный вопрос"
      })
    );

    await harness.db
      .update(widgetAiJobs)
      .set({
        status: "processing",
        terminalReason: null,
        completedAt: null,
        expectedGenerationEpoch: 2,
        attemptCount: 1,
        leaseExpiresAt: new Date(0),
        availableAt: new Date(0)
      })
      .where(eq(widgetAiJobs.respondsThroughSequence, 1));

    expect(await worker.runOnce(readyNow())).toBe(true);
    expect(await jobRows()).toMatchObject([
      { status: "superseded", terminalReason: "turn_not_current" },
      { status: "replied" }
    ]);

    const history = await service.getSiteWidgetHistory(sessionId, "site_widget.history.v2");
    expect(history.body).toMatchObject({ poll_after_ms: undefined });
  });

  it("keeps the newest active job visible after history exceeds one hundred messages", async () => {
    const sessionId = randomUUID();
    const { service } = runtime();

    for (let index = 1; index <= 101; index += 1) {
      await accept(
        service,
        widgetRequest(`history-window-${index}`, {
          sessionId,
          text: `Сообщение ${index}`
        })
      );
    }

    const result = await service.getSiteWidgetHistory(sessionId, "site_widget.history.v2");
    expect(result.statusCode).toBe(200);
    if (!result.body.ok) throw new Error("expected public widget history");
    if (result.body.schema_version !== "site_widget.history.v2") {
      throw new Error("expected v2 public widget history");
    }
    expect(result.body.poll_after_ms).toBe(700);
    expect(result.body.messages).toHaveLength(100);
    expect(result.body.messages[0]).toMatchObject({ text: "Сообщение 2" });
    expect(result.body.messages.at(-1)).toMatchObject({
      text: "Сообщение 101",
      automation: { status: "pending" }
    });
  });

  it("runs four conversations in parallel without overlapping one conversation", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fourStarted!: () => void;
    const firstWaveStarted = new Promise<void>((resolve) => {
      fourStarted = resolve;
    });
    let active = 0;
    let maxActive = 0;
    let generationCalls = 0;
    const activeConversations = new Set<string>();
    const { service, worker } = runtime({
      async generateReply(input) {
        expect(activeConversations.has(input.conversation.publicConversationId)).toBe(false);
        activeConversations.add(input.conversation.publicConversationId);
        active += 1;
        generationCalls += 1;
        maxActive = Math.max(maxActive, active);
        if (active === 4) fourStarted();
        await gate;
        active -= 1;
        activeConversations.delete(input.conversation.publicConversationId);
        return reply(`Параллельный ответ ${generationCalls}`);
      }
    });

    for (let index = 0; index < 5; index += 1) {
      await accept(service, widgetRequest(`pool-${index}`, { sessionId: randomUUID() }));
    }
    await harness.db.update(widgetAiJobs).set({ availableAt: new Date(0) });

    const controller = new AbortController();
    const running = worker.run(controller.signal);
    await firstWaveStarted;
    expect(maxActive).toBe(4);
    expect(activeConversations.size).toBe(4);
    release();
    await waitForCondition(async () => (await countMessagesByRole("ai_assistant")) === 5);
    controller.abort();
    await running;

    expect(generationCalls).toBe(5);
    expect(maxActive).toBe(4);
    expect(await jobRows()).toEqual(
      expect.arrayContaining(
        Array.from({ length: 5 }, () => expect.objectContaining({ status: "replied" }))
      )
    );
  }, 10_000);

  it("blocks an in-flight reply after a newer inbound advances turn identity", async () => {
    let observedStart!: () => void;
    const started = new Promise<void>((resolve) => {
      observedStart = resolve;
    });
    let observedAbort!: () => void;
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const sessionId = randomUUID();
    const { service, worker } = runtime({
      async generateReply(_input, options) {
        observedStart();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            observedAbort();
            reject(new DOMException("Superseded", "AbortError"));
          };
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) abort();
        });
      }
    });
    const first = acceptBody(
      await service.acceptSiteWidgetMessage(
        widgetRequest("newer-during-generation-1", { sessionId })
      )
    ).public_message_id;

    const running = worker.runOnce(readyNow());
    await started;
    await accept(service, widgetRequest("newer-during-generation-2", { sessionId }));
    await aborted;
    await running;

    expect(await countMessagesByRole("visitor")).toBe(2);
    expect(await countMessagesByIdempotency(`ai:${first}`)).toBe(0);
    expect(await jobRows()).toMatchObject([
      { status: "superseded", terminalReason: "turn_not_current" },
      { status: "pending" }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "failed",
        outcomeReason: "execution_context_mismatch",
        failureCode: "execution_context_mismatch",
        winningAttemptId: null
      }
    ]);
    expect(await aiAttemptRows()).toMatchObject([{ status: "fenced" }]);
  });

  it("closes a retrying logical run when a newer inbound supersedes its job", async () => {
    const sessionId = randomUUID();
    const { repository, service } = runtime();
    await accept(service, widgetRequest("retrying-before-newer-1", { sessionId }));
    const claimTime = readyNow();
    const job = await repository.claimSiteWidgetAiJob!({ leaseMs: 5_000, now: claimTime });
    if (!job) throw new Error("expected retrying job claim");
    const runRepository = new PostgresAiRunRepository(harness.db);
    const attemptStartedAt = new Date(Date.now() - 1_000);
    const started = await runRepository.beginOrReplay({
      traceId: randomUUID(),
      leadId: job.leadId,
      conversationId: job.conversationId,
      inboundMessageId: job.aiTurnExecutionContext.internal.inboundMessageId,
      channel: "site_widget",
      runtimeMode: "direct_openai",
      decisionProfile: "live_v2",
      idempotencyKey: job.aiTurnExecutionContext.turn.idempotencyKey,
      attemptIdempotencyKey: `${job.aiTurnExecutionContext.turn.idempotencyKey}:attempt:1`,
      attemptNumber: 1,
      jobId: job.id,
      jobAttemptCount: 1,
      maxAttempts: job.maxAttempts,
      inputFingerprint: sha256Hex(stableStringify(job.aiTurnInput)),
      versions: {
        policyVersion: "pr0b_policy.v1",
        promptVersion: "pr0b_prompt.v1",
        toolVersion: "pr0b_tools.none.v1",
        disclosureVersion: "pr0b_disclosure.v1",
        modelProfileVersion: "pr0b_model_profile.v1"
      },
      model: {
        modelProvider: "fake",
        requestedModelName: "pr0b-recorded-fake",
        reasoningEffort: "none"
      },
      startedAt: attemptStartedAt
    });
    if (started.kind !== "started") throw new Error("expected retrying attempt");
    const failedAt = new Date(Date.now() - 500);
    await runRepository.failAttempt({
      run: started.run,
      completion: failedAttemptCompletion(started.run, failedAt.toISOString())
    });
    await repository.finishSiteWidgetAiJob!({
      jobId: job.id,
      attemptCount: job.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: new Date(failedAt.getTime() + 1_000),
      completedAt: failedAt
    });

    expect(await jobRows()).toMatchObject([{ status: "retrying", attemptCount: 1 }]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      { status: "running", winningAttemptId: null }
    ]);
    expect(await aiAttemptRows()).toMatchObject([{ status: "failed" }]);

    await accept(service, widgetRequest("retrying-before-newer-2", { sessionId }));
    expect(await jobRows()).toMatchObject([
      { status: "superseded", attemptCount: 1, terminalReason: "newer_inbound" },
      { status: "pending", attemptCount: 0 }
    ]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "failed",
        outcomeReason: "execution_context_mismatch",
        failureCode: "execution_context_mismatch",
        winningAttemptId: null
      }
    ]);
  });

  it("blocks persistence from a worker that lost its lease attempt", async () => {
    const gate = barrier();
    const { repository, service, worker } = runtime({
      async generateReply() {
        gate.enter();
        await gate.wait;
        return reply("Этот ответ потерял lease до commit.");
      }
    });
    await accept(service, widgetRequest("lost-lease"));

    const running = worker.runOnce(readyNow());
    await gate.entered;
    const reclaimed = await repository.claimSiteWidgetAiJob!({
      leaseMs: 5_000,
      now: new Date(Date.now() + 7_000)
    });
    expect(reclaimed).toMatchObject({ attemptCount: 2 });
    gate.release();
    await running;

    expect(await countMessagesByRole("ai_assistant")).toBe(0);
    expect(await jobRows()).toMatchObject([{ status: "processing", attemptCount: 2 }]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "fenced" }
    ]);
    expect(await countAiRuns()).toBe(1);
  });

  it("rolls back stale degradation before the reclaimed attempt replies", async () => {
    const gate = barrier();
    let generationCalls = 0;
    const { repository, service, worker } = runtime({
      async generateReply() {
        generationCalls += 1;
        if (generationCalls === 1) {
          gate.enter();
          await gate.wait;
          return {
            decision: "no_reply",
            reason: "model_error",
            metadata: { model_provider: "fake" }
          };
        }

        return replyWithAiRun("Свежая попытка сохранила ответ. Какой материал вам ближе?");
      }
    });
    await accept(service, widgetRequest("lost-lease-degradation"));

    const staleAttempt = worker.runOnce(readyNow());
    await gate.entered;
    const reclaimed = await repository.claimSiteWidgetAiJob!({
      leaseMs: 5_000,
      now: new Date(Date.now() + 7_000)
    });
    expect(reclaimed).toMatchObject({ attemptCount: 2 });
    gate.release();
    await staleAttempt;

    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "running",
        winningAttemptId: null,
        outboundMessageId: null,
        sendGateResult: "not_checked"
      }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "fenced" }
    ]);
    expect(await jobRows()).toMatchObject([{ status: "processing", attemptCount: 2 }]);
    if (!reclaimed) throw new Error("expected reclaimed widget AI job");

    await expect(service.processClaimedSiteWidgetAiJob(reclaimed)).resolves.toEqual({
      status: "replied",
      outputPublicMessageId: expect.any(String)
    });
    expect(generationCalls).toBe(2);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await jobRows()).toMatchObject([{ status: "replied", attemptCount: 2 }]);
    expect(await harness.db.select().from(aiRuns)).toMatchObject([
      {
        status: "persisted",
        winningAttemptId: expect.any(String),
        outboundMessageId: expect.any(String),
        sendGateResult: "allowed"
      }
    ]);
    expect(await aiAttemptRows()).toMatchObject([
      { attemptNumber: 1, jobAttemptCount: 1, status: "fenced" },
      { attemptNumber: 2, jobAttemptCount: 2, status: "succeeded" }
    ]);
    expect(await countAiRuns()).toBe(1);
  });

  function runtime(
    replyGenerator: PublicWidgetAiReplyGenerator = defaultGenerator(),
    repository = new PostgresIntakeRepository(harness.db),
    runRepository: AiRunRepository = new PostgresAiRunRepository(harness.db)
  ): Runtime {
    const generator: ObservedLiveV2DecisionGenerator = {
      async generateDecision(input, options) {
        const [run] = await harness.db
          .select({
            conversationId: aiRuns.conversationId,
            inboundPublicMessageId: aiRuns.inboundPublicMessageId
          })
          .from(aiRunAttempts)
          .innerJoin(aiRuns, eq(aiRunAttempts.aiRunId, aiRuns.id))
          .where(eq(aiRunAttempts.traceId, options.appTraceId));
        const [conversation] = run
          ? await harness.db
              .select({
                publicConversationId: conversations.publicConversationId
              })
              .from(conversations)
              .where(eq(conversations.id, run.conversationId))
          : [];
        const inboundText = input.turn.messages.at(-1)?.text ?? "";
        const legacyResult = (await replyGenerator.generateReply(
          {
            conversation: {
              publicConversationId: conversation?.publicConversationId ?? randomUUID()
            },
            inboundMessage: {
              publicMessageId: run?.inboundPublicMessageId ?? randomUUID(),
              text: inboundText
            },
            compactContext: {
              messages: input.turn.messages.map((message, index) => ({
                publicMessageId: `test-context-${index}`,
                direction: message.role === "visitor" ? "inbound" : "outbound",
                senderRole: message.role === "visitor" ? "visitor" : "ai_assistant",
                text: message.text,
                createdAt: "2026-08-03T10:00:00.000Z"
              }))
            }
          } as never,
          { signal: options.signal }
        )) as { decision?: string; text?: string };

        if (legacyResult.decision !== "reply_candidate" || !legacyResult.text) {
          throw new Error("test generator returned no reply");
        }

        return {
          candidate: modelTurnCandidate(legacyResult.text),
          observation: {
            observedModelProvider: "openai",
            observedModelName: "gpt-5.6-luna"
          }
        };
      }
    };
    const service = buildAppContext({
      repository,
      widgetAi: {
        enabled: true,
        runRepository,
        directLiveV2: {
          generator,
          modelName: "gpt-5.6-luna",
          approvedFacts: TEST_LIVE_V2_FACTS
        },
        jobWorker: {
          enabled: true,
          pollIntervalMs: 25,
          leaseMs: 5_000,
          retryBackoffMs: 1,
          maxAttempts: 3
        }
      }
    }).publicIntake.siteWidget;
    const worker = new WidgetAiJobWorker(repository, service, {
      pollIntervalMs: 25,
      leaseMs: 5_000,
      retryBackoffMs: 1
    });
    return { repository, service, worker };
  }

  async function accept(
    service: PublicWidgetIntakeService,
    payload: SiteWidgetV2MessageRequest
  ): Promise<AcceptedV2Body> {
    return acceptBody(await service.acceptSiteWidgetMessage(payload));
  }

  function acceptBody(
    result: Awaited<ReturnType<PublicWidgetIntakeService["acceptSiteWidgetMessage"]>>
  ) {
    expect(result.statusCode).toBe(202);
    expect(result.body.ok).toBe(true);
    return result.body as AcceptedV2Body;
  }

  async function drain(worker: WidgetAiJobWorker, maxJobs: number) {
    const base = Date.now() + 1_000;
    for (let index = 0; index < maxJobs; index += 1) {
      const processed = await worker.runOnce(new Date(base + index * 1_000));
      if (!processed) return;
    }
  }

  async function jobRows() {
    return harness.db
      .select({
        status: widgetAiJobs.status,
        attemptCount: widgetAiJobs.attemptCount,
        terminalReason: widgetAiJobs.terminalReason
      })
      .from(widgetAiJobs)
      .orderBy(asc(widgetAiJobs.createdAt));
  }

  async function conversationRows() {
    return harness.db
      .select({
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState
      })
      .from(conversations);
  }

  async function countMessagesByRole(senderRole: string) {
    const [row] = await harness.db
      .select({ value: count() })
      .from(conversationMessages)
      .where(eq(conversationMessages.senderRole, senderRole));
    return row?.value ?? 0;
  }

  async function countMessagesByIdempotency(idempotencyKey: string) {
    const [row] = await harness.db
      .select({ value: count() })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.senderRole, "ai_assistant"),
          eq(conversationMessages.idempotencyKey, idempotencyKey)
        )
      );
    return row?.value ?? 0;
  }

  async function outboundRows() {
    return harness.db
      .select({
        body: conversationMessages.body,
        idempotencyKey: conversationMessages.idempotencyKey
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.senderRole, "ai_assistant"))
      .orderBy(asc(conversationMessages.createdAt));
  }

  async function countAiRuns() {
    const [row] = await harness.db.select({ value: count() }).from(aiRuns);
    return row?.value ?? 0;
  }

  async function aiAttemptRows() {
    return harness.db
      .select({
        attemptNumber: aiRunAttempts.attemptNumber,
        jobAttemptCount: aiRunAttempts.jobAttemptCount,
        status: aiRunAttempts.status
      })
      .from(aiRunAttempts)
      .orderBy(asc(aiRunAttempts.attemptNumber));
  }

  async function waitForBlockedTransactions(expected: number) {
    const deadline = Date.now() + 10_000;

    while (Date.now() < deadline) {
      const [row] = await harness.client.unsafe<Array<{ value: number }>>(`
        SELECT count(*)::int AS value
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
      `);

      if ((row?.value ?? 0) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(`timed out waiting for ${expected} blocked PostgreSQL transactions`);
  }

  async function waitForCondition(condition: () => Promise<boolean>) {
    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error("timed out waiting for PostgreSQL runtime condition");
  }

  async function aiRunRows() {
    return harness.db
      .select({
        recordingContract: aiRuns.recordingContract,
        status: aiRuns.status,
        inboundPublicMessageId: aiRuns.inboundPublicMessageId,
        outboundLinked: sql<boolean>`${aiRuns.outboundMessageId} IS NOT NULL`,
        sendGateResult: aiRuns.sendGateResult
      })
      .from(aiRuns);
  }
});

function failedAttemptCompletion(
  run: RunningAiRunRecord,
  completedAt: string
): AiRunTerminalCompletion {
  const completed = new Date(completedAt);
  return {
    status: "fallback_unavailable",
    normalizedAction: "no_reply",
    outcomeReason: "generator_failed",
    failureCode: "runtime_failure",
    validatorResult: "failed",
    observedModelProvider: "none",
    sendGateResult: "not_checked",
    completedAt: completed,
    latencyMs: completed.getTime() - run.attempt.startedAt.getTime(),
    spans: [],
    qualityEvents: []
  };
}

function failedTerminalCompletion(run: RunningAiRunRecord): AiRunTerminalCompletion {
  const completedAt = new Date(run.attempt.startedAt.getTime() + 100);
  return {
    status: "failed",
    normalizedAction: "no_reply",
    outcomeReason: "recorder_failure",
    failureCode: "recorder_failure",
    validatorResult: "failed",
    observedModelProvider: "none",
    sendGateResult: "not_checked",
    completedAt,
    latencyMs: completedAt.getTime() - run.attempt.startedAt.getTime(),
    spans: [],
    qualityEvents: []
  };
}

function readyNow() {
  return new Date(Date.now() + 1_000);
}

function defaultGenerator(): PublicWidgetAiReplyGenerator {
  return {
    async generateReply() {
      return reply("Помогу подобрать вариант. Какой материал вам ближе?");
    }
  };
}

function modelTurnCandidate(text: string) {
  const questionMatch = text.match(/^(.*?)([^.!?]+\?)$/u);
  return {
    version: "granit_model_turn.v1" as const,
    message: questionMatch
      ? {
          answerText: questionMatch[1]?.trim() || "Уточню детали.",
          question: {
            text: questionMatch[2]!.trim(),
            target: "material" as const
          }
        }
      : { answerText: text, question: null },
    statePatches: [],
    recommendationIds: [],
    handoffIntent: null
  };
}

function reply(text: string) {
  return {
    decision: "reply_candidate" as const,
    text,
    requestedSlots: ["material"] as const,
    slotUpdates: [],
    requirementUpdates: [],
    sourceEvidence: [],
    metadata: { grounding_verified: true, model_provider: "fake" }
  };
}

function replyWithAiRun(text: string) {
  return {
    ...reply(text),
    action: "answer" as const,
    intent: "product_selection" as const
  };
}

function widgetRequest(
  key: string,
  options: { sessionId?: string; text?: string } = {}
): SiteWidgetV2MessageRequest {
  const request: SiteWidgetV2MessageRequest = {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: `pr0a-widget-ai-${key}`,
    submitted_at: "2026-08-03T10:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://preview.granitkr.ru/catalog.html",
      widget_instance_id: "pr0a-widget"
    },
    message: {
      role: "visitor",
      text: options.text ?? "Помогите выбрать памятник"
    },
    consent: { privacy_policy: true }
  };

  if (options.sessionId) {
    request.public_session_id = options.sessionId;
  }

  return request;
}

function barrier() {
  let release!: () => void;
  let enter!: () => void;
  return {
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
    entered: new Promise<void>((resolve) => {
      enter = resolve;
    }),
    enter,
    release
  };
}
