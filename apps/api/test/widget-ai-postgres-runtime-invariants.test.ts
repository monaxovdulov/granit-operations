import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetV2MessageRequest
} from "@granit/contracts";
import { aiRuns, conversationMessages, conversations, widgetAiJobs } from "@granit/db";
import { and, asc, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { PostgresIntakeRepository } from "../src/modules/conversations/repositories/postgres-intake-repository.js";
import { WidgetAiJobWorker } from "../src/modules/intake/services/widget-ai-job-worker.js";
import { PublicWidgetIntakeService } from "../src/modules/intake/use-cases/public-widget-intake-service.js";
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

type ExpectedInvariantCode =
  | "burst_not_latest_wins"
  | "newer_inbound_stale_reply"
  | "lost_lease_stale_reply";

class ExpectedInvariantViolation extends Error {
  constructor(
    readonly code: ExpectedInvariantCode,
    message: string
  ) {
    super(message);
    this.name = "ExpectedInvariantViolation";
  }
}

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
    const saveReply = repository.saveSiteWidgetAiMessage.bind(repository);
    let saveAttemptHadAiRun = false;
    repository.saveSiteWidgetAiMessage = async (input) => {
      saveAttemptHadAiRun = Boolean(input.aiRun);
      return saveReply(input);
    };
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
    expect(saveAttemptHadAiRun).toBe(true);
    expect(await countMessagesByRole("ai_assistant")).toBe(0);
    expect(await jobRows()).toMatchObject([
      { status: "blocked", attemptCount: 1, terminalReason: "agent_reply_blocked" }
    ]);
    expect(await conversationRows()).toMatchObject([
      { agentAllowedToReply: false, aiState: "manager_active" }
    ]);
    expect(await countAiRuns()).toBe(0);
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
    expect(await jobRows()).toMatchObject([{ status: "retrying", attemptCount: 1 }]);
    expect(await worker.runOnce(new Date(Date.now() + 2_000))).toBe(true);

    expect(calls).toBe(1);
    expect(await countMessagesByRole("ai_assistant")).toBe(1);
    expect(await jobRows()).toMatchObject([{ status: "replied", attemptCount: 2 }]);
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

  it("expected-failure: burst should collapse to one reply for the latest context", async () => {
    await expectBaselineViolation("burst latest-wins", "burst_not_latest_wins", async () => {
      const sessionId = randomUUID();
      const { service, worker } = runtime({
        async generateReply(input) {
          return reply(`Ответ на: ${input.inboundMessage.text}`);
        }
      });
      const first = await accept(
        service,
        widgetRequest("burst-1", { sessionId, text: "Первый вопрос" })
      );
      const second = await accept(
        service,
        widgetRequest("burst-2", { sessionId, text: "Уточнение" })
      );
      const latest = await accept(
        service,
        widgetRequest("burst-3", { sessionId, text: "Финальный контекст" })
      );

      await drain(worker, 3);
      expect(await countMessagesByRole("visitor")).toBe(3);
      expect(await jobRows()).toHaveLength(3);

      const outbounds = await outboundRows();
      expect(outbounds.length).toBeGreaterThan(0);
      const staleOutbounds = outbounds.filter((row) =>
        [`ai:${first.public_message_id}`, `ai:${second.public_message_id}`].includes(
          row.idempotencyKey
        )
      );
      const latestOutbound = outbounds.find(
        (row) => row.idempotencyKey === `ai:${latest.public_message_id}`
      );

      if (
        staleOutbounds.length > 0 ||
        outbounds.length !== 1 ||
        !latestOutbound?.body.includes("Финальный контекст")
      ) {
        throw new ExpectedInvariantViolation(
          "burst_not_latest_wins",
          `baseline produced ${outbounds.length} replies with ${staleOutbounds.length} stale replies`
        );
      }
    });
  });

  it("expected-failure: newer inbound during generation should block stale reply", async () => {
    await expectBaselineViolation("newer inbound fence", "newer_inbound_stale_reply", async () => {
      const gate = barrier();
      const sessionId = randomUUID();
      const { service, worker } = runtime({
        async generateReply() {
          gate.enter();
          await gate.wait;
          return reply("Старый ответ не должен быть отправлен.");
        }
      });
      const first = acceptBody(await service.acceptSiteWidgetMessage(
        widgetRequest("newer-during-generation-1", { sessionId })
      )).public_message_id;

      const running = worker.runOnce(readyNow());
      await gate.entered;
      await accept(service, widgetRequest("newer-during-generation-2", { sessionId }));
      gate.release();
      await running;
      expect(await countMessagesByRole("visitor")).toBe(2);
      expect(await jobRows()).toHaveLength(2);

      const staleOutbounds = await countMessagesByIdempotency(`ai:${first}`);
      if (staleOutbounds !== 0) {
        throw new ExpectedInvariantViolation(
          "newer_inbound_stale_reply",
          "baseline persisted a stale in-flight reply"
        );
      }
    });
  });

  it("expected-failure: lost lease during generation should block old worker persistence", async () => {
    await expectBaselineViolation("lease commit fence", "lost_lease_stale_reply", async () => {
      const gate = barrier();
      const { repository, service, worker } = runtime({
        async generateReply() {
          gate.enter();
          await gate.wait;
          return reply("Этот ответ потерял lease до commit.");
        }
      });
      const accepted = await accept(service, widgetRequest("lost-lease"));

      const running = worker.runOnce(readyNow());
      await gate.entered;
      const reclaimed = await repository.claimSiteWidgetAiJob!({
        leaseMs: 5_000,
        now: new Date(Date.now() + 7_000)
      });
      expect(reclaimed).toMatchObject({ attemptCount: 2 });
      gate.release();
      await running;

      const staleOutbounds = await countMessagesByIdempotency(
        `ai:${accepted.public_message_id}`
      );
      if (staleOutbounds !== 0) {
        throw new ExpectedInvariantViolation(
          "lost_lease_stale_reply",
          "baseline persisted after lease loss"
        );
      }
    });
  });

  function runtime(replyGenerator: PublicWidgetAiReplyGenerator = defaultGenerator()): Runtime {
    const repository = new PostgresIntakeRepository(harness.db);
    const service = new PublicWidgetIntakeService(repository, {
      ai: { enabled: true, replyGenerator, jobMaxAttempts: 3 }
    });
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

  function acceptBody(result: Awaited<ReturnType<PublicWidgetIntakeService["acceptSiteWidgetMessage"]>>) {
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

  async function expectBaselineViolation(
    name: string,
    expectedCode: ExpectedInvariantCode,
    run: () => Promise<void>
  ) {
    try {
      await run();
    } catch (error) {
      if (error instanceof ExpectedInvariantViolation && error.code === expectedCode) return;
      throw error;
    }
    throw new Error(`${name} unexpectedly passed; update PR0a expected-failure`);
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
});

function readyNow() {
  return new Date(Date.now() + 1_000);
}

function defaultGenerator(): PublicWidgetAiReplyGenerator {
  return {
    async generateReply() {
      return reply("Помогу подобрать вариант. Какие материал и сроки важны?");
    }
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
