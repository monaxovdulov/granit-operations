import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetV2MessageRequest
} from "@granit/contracts";
import { describe, expect, it } from "vitest";

import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { WidgetAiJobWorker } from "../src/modules/intake/services/widget-ai-job-worker.js";
import { PublicWidgetIntakeService } from "../src/modules/intake/use-cases/public-widget-intake-service.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

describe("site widget AI durable job worker", () => {
  it("retries an unexpected worker failure and persists exactly one reply", async () => {
    const repository = new MemoryIntakeRepository();
    let calls = 0;
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        calls += 1;

        if (calls === 1) {
          throw new Error("temporary generator failure");
        }

        return {
          decision: "reply_candidate",
          text: "Помогу подобрать вариант. Какой материал вы рассматриваете?",
          action: "clarify",
          intent: "product_selection",
          requestedSlots: ["material"],
          slotUpdates: [],
          requirementUpdates: [],
          sourceEvidence: [],
          metadata: { grounding_verified: true }
        };
      }
    };
    const service = new PublicWidgetIntakeService(repository, {
      ai: { enabled: true, replyGenerator, jobMaxAttempts: 3 }
    });
    const worker = new WidgetAiJobWorker(repository, service, {
      pollIntervalMs: 25,
      leaseMs: 5_000,
      retryBackoffMs: 10
    });
    const accepted = await service.acceptSiteWidgetMessage(validV2Request());

    expect(accepted.body).toMatchObject({
      ok: true,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      automation: { status: "processing" }
    });
    expect(await worker.runOnce(new Date())).toBe(true);

    const afterFailure = await repository.getSiteWidgetHistory!(
      (accepted.body as { public_session_id: string }).public_session_id
    );
    expect(afterFailure?.messages[0]?.automation).toMatchObject({
      status: "retrying",
      reason: "worker_failed"
    });
    expect(afterFailure?.messages).toHaveLength(1);

    expect(await worker.runOnce(new Date(Date.now() + 1_000))).toBe(true);
    const afterRetry = await repository.getSiteWidgetHistory!(
      (accepted.body as { public_session_id: string }).public_session_id
    );

    expect(calls).toBe(2);
    expect(afterRetry?.messages[0]?.automation).toMatchObject({ status: "replied" });
    expect(afterRetry?.messages).toMatchObject([
      { senderRole: "visitor" },
      {
        senderRole: "ai_assistant",
        text: "Помогу подобрать вариант. Какой материал вы рассматриваете?"
      }
    ]);
  });

  it("reuses a persisted reply when job completion fails after the reply commit", async () => {
    const repository = new MemoryIntakeRepository();
    let calls = 0;
    const replyGenerator: PublicWidgetAiReplyGenerator = {
      async generateReply() {
        calls += 1;
        return {
          decision: "reply_candidate",
          text: "Ответ уже надёжно сохранён.",
          action: "clarify",
          intent: "product_selection",
          requestedSlots: ["material"],
          slotUpdates: [],
          requirementUpdates: [],
          sourceEvidence: [],
          metadata: { grounding_verified: true }
        };
      }
    };
    const service = new PublicWidgetIntakeService(repository, {
      ai: { enabled: true, replyGenerator, jobMaxAttempts: 3 }
    });
    const worker = new WidgetAiJobWorker(repository, service, {
      pollIntervalMs: 25,
      leaseMs: 5_000,
      retryBackoffMs: 10
    });
    const accepted = await service.acceptSiteWidgetMessage(validV2Request());
    const finishJob = repository.finishSiteWidgetAiJob.bind(repository);
    let failReplyCompletion = true;

    repository.finishSiteWidgetAiJob = async (input) => {
      if (failReplyCompletion && input.status === "replied") {
        failReplyCompletion = false;
        throw new Error("job completion acknowledgement lost");
      }

      await finishJob(input);
    };

    expect(await worker.runOnce(new Date())).toBe(true);

    const publicSessionId = (accepted.body as { public_session_id: string }).public_session_id;
    const afterLostCompletion = await repository.getSiteWidgetHistory!(publicSessionId);
    expect(afterLostCompletion?.messages).toMatchObject([
      { senderRole: "visitor", automation: { status: "retrying" } },
      { senderRole: "ai_assistant", text: "Ответ уже надёжно сохранён." }
    ]);

    expect(await worker.runOnce(new Date(Date.now() + 1_000))).toBe(true);

    const recovered = await repository.getSiteWidgetHistory!(publicSessionId);
    expect(calls).toBe(1);
    expect(repository.aiSaveCalls).toBe(1);
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[0]?.automation).toMatchObject({ status: "replied" });
  });

  it("ignores completion from a stale worker attempt", async () => {
    const repository = new MemoryIntakeRepository();
    const service = new PublicWidgetIntakeService(repository, {
      ai: {
        enabled: true,
        jobMaxAttempts: 3,
        replyGenerator: {
          async generateReply() {
            throw new Error("not used");
          }
        }
      }
    });
    const accepted = await service.acceptSiteWidgetMessage(validV2Request());
    const claimed = await repository.claimSiteWidgetAiJob!({
      leaseMs: 5_000,
      now: new Date()
    });

    expect(claimed).not.toBeNull();
    if (!claimed) {
      return;
    }

    await repository.finishSiteWidgetAiJob!({
      jobId: claimed.id,
      attemptCount: claimed.attemptCount + 1,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: new Date(Date.now() + 1_000),
      completedAt: new Date()
    });

    const publicSessionId = (accepted.body as { public_session_id: string }).public_session_id;
    const afterStaleCompletion = await repository.getSiteWidgetHistory!(publicSessionId);
    expect(afterStaleCompletion?.messages[0]?.automation).toMatchObject({
      status: "processing"
    });

    await repository.finishSiteWidgetAiJob!({
      jobId: claimed.id,
      attemptCount: claimed.attemptCount,
      status: "retrying",
      terminalReason: "worker_failed",
      retryAt: new Date(Date.now() + 1_000),
      completedAt: new Date()
    });

    const afterCurrentCompletion = await repository.getSiteWidgetHistory!(publicSessionId);
    expect(afterCurrentCompletion?.messages[0]?.automation).toMatchObject({
      status: "retrying"
    });
  });

  it("keeps polling after a transient repository failure", async () => {
    const repository = new MemoryIntakeRepository();
    const service = new PublicWidgetIntakeService(repository, {
      ai: {
        enabled: true,
        jobMaxAttempts: 3,
        replyGenerator: {
          async generateReply() {
            return {
              decision: "reply_candidate",
              text: "Очередь восстановилась после временной ошибки.",
              action: "clarify",
              intent: "product_selection",
              requestedSlots: ["material"],
              slotUpdates: [],
              requirementUpdates: [],
              sourceEvidence: [],
              metadata: { grounding_verified: true }
            };
          }
        }
      }
    });
    const accepted = await service.acceptSiteWidgetMessage(validV2Request());
    const claimJob = repository.claimSiteWidgetAiJob.bind(repository);
    const finishJob = repository.finishSiteWidgetAiJob.bind(repository);
    const abortController = new AbortController();
    const errors: unknown[] = [];
    let claimCalls = 0;

    repository.claimSiteWidgetAiJob = async (input) => {
      claimCalls += 1;
      if (claimCalls === 1) {
        throw new Error("temporary database outage");
      }

      return claimJob(input);
    };
    repository.finishSiteWidgetAiJob = async (input) => {
      await finishJob(input);
      if (input.status === "replied") {
        abortController.abort();
      }
    };

    const worker = new WidgetAiJobWorker(repository, service, {
      pollIntervalMs: 25,
      leaseMs: 5_000,
      retryBackoffMs: 10,
      onError: (error) => errors.push(error)
    });

    await worker.run(abortController.signal);

    const publicSessionId = (accepted.body as { public_session_id: string }).public_session_id;
    const history = await repository.getSiteWidgetHistory!(publicSessionId);
    expect(claimCalls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(history?.messages).toMatchObject([
      { senderRole: "visitor", automation: { status: "replied" } },
      {
        senderRole: "ai_assistant",
        text: "Очередь восстановилась после временной ошибки."
      }
    ]);
  });
});

function validV2Request(): SiteWidgetV2MessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: `widget-worker-${randomUUID()}`,
    submitted_at: "2020-01-01T00:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://preview.granitkr.ru/catalog.html",
      widget_instance_id: "floating-widget-v2"
    },
    message: {
      role: "visitor",
      text: "Помогите выбрать памятник"
    },
    consent: {
      privacy_policy: true
    }
  };
}
