import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import type { AiTurnInput } from "../src/modules/ai/ai-turn.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("P2 public widget observability integration", () => {
  it("atomically persists an answer, outbound linkage and controlled spans", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          modelName: "p2-fake-model",
          replyGenerator: {
            async generateReply() {
              return {
                decision: "reply_candidate",
                text: "Подберу варианты. Какой стиль памятника вам ближе?",
                metadata: {
                  model_provider: "fake",
                  input_tokens: 11,
                  output_tokens: 8,
                  total_tokens: 19,
                  raw_provider_payload: "MUST_NOT_ENTER_OBSERVABILITY"
                }
              };
            }
          }
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-observed-answer-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ automation: { status: "replied" } });
    expect(response.json().trace_id).toBeUndefined();
    expect(repository.aiRunCount).toBe(1);
    const [run] = repository.listAiRuns();
    if (!run) {
      throw new Error("expected one recorded AI run");
    }
    expect(run).toMatchObject({
      status: "persisted",
      outcomeReason: "reply_persisted",
      model: {
        modelProvider: "fake",
        requestedModelName: "p2-fake-model",
        reasoningEffort: "none"
      },
      observedModelProvider: "none",
      sendGateResult: "allowed",
    });
    expect(run.status === "running" ? undefined : run.observedModelName).toBeUndefined();
    expect(run.status === "running" ? undefined : run.usage).toBeUndefined();
    expect(run?.status === "running" ? undefined : run.outboundMessageId).toBeDefined();
    expect(run?.status === "running" ? undefined : run.sendGateCheckedAt).toBeInstanceOf(Date);
    expect(
      run?.status === "running"
        ? false
        : run.sendGateCheckedAt!.getTime() <= run.completedAt.getTime()
    ).toBe(true);
    expect(run?.status === "running" ? [] : run.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "send_gate_check", status: "succeeded" }),
        expect.objectContaining({ name: "reply_persistence", status: "succeeded" })
      ])
    );
    expect(JSON.stringify(run)).not.toContain("MUST_NOT_ENTER_OBSERVABILITY");
    expect(repository.lastAiSaveInput?.metadata).toMatchObject({
      decision_profile: "legacy_s05",
      normalized_action: "answer",
      model_provider: "none"
    });
    expect(repository.lastAiSaveInput?.metadata).not.toHaveProperty("input_tokens");
    expect(repository.lastAiSaveInput?.metadata).not.toHaveProperty("output_tokens");
    expect(repository.lastAiSaveInput?.metadata).not.toHaveProperty("total_tokens");
    expect(repository.lastAiSaveInput?.metadata).not.toHaveProperty("raw_provider_payload");
    expect(JSON.stringify(repository.onlyLead().timeline)).not.toContain(
      "MUST_NOT_ENTER_OBSERVABILITY"
    );
  });

  it("replays a terminal no-reply run without a duplicate generator call", async () => {
    const repository = new MemoryIntakeRepository();
    const generateReply = vi.fn(async () => ({
      decision: "no_reply",
      reason: "model_error",
      metadata: { model_provider: "openai", raw_error: "DO-NOT-STORE" }
    }));
    const app = track(
      buildApi({ repository, widgetAi: { enabled: true, modelName: "gpt-5.5", replyGenerator: { generateReply } } })
    );
    const payload = widgetRequest("p2-terminal-replay-0001");

    const first = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });
    const replay = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });

    expect(first.json()).toMatchObject({ automation: { status: "fallback", reason: "model_error" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: "model_error" }
    });
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(repository.aiRunCount).toBe(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "fallback_unavailable",
      qualityEvents: [{ eventType: "model_failure", reasonCode: "model_error" }]
    });
    expect(JSON.stringify(repository.listAiRuns()[0])).not.toContain("DO-NOT-STORE");
    expectManagerReview(repository, "ai_no_reply");
  });

  it("keeps a blocked policy rejection classified as no-reply on terminal replay", async () => {
    const target = new MemoryIntakeRepository();
    const managerReviewReasons: string[] = [];
    const repository = new Proxy(target, {
      get(object, property) {
        if (property === "transitionSiteWidgetConversationToManagerReview") {
          return async (input: { reason: string }) => {
            managerReviewReasons.push(input.reason);
            return object.transitionSiteWidgetConversationToManagerReview(
              input as Parameters<
                typeof object.transitionSiteWidgetConversationToManagerReview
              >[0]
            );
          };
        }

        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
    });
    const generateReply = vi.fn(async () => ({
      decision: "no_reply" as const,
      reason: "unsafe_model_response" as const,
      metadata: { model_provider: "fake", raw_response: "DO-NOT-STORE" }
    }));
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, replyGenerator: { generateReply } }
      })
    );
    const payload = widgetRequest("p2-policy-rejection-replay-0001");

    const first = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const replay = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });

    expect(first.json()).toMatchObject({
      automation: { status: "fallback", reason: "unsafe_model_response" }
    });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: "unsafe_model_response" }
    });
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(managerReviewReasons).toEqual(["ai_no_reply", "ai_no_reply"]);
    expect(target.listAiRuns()).toMatchObject([
      {
        status: "blocked",
        outcomeReason: "unsafe_model_response",
        sendGateResult: "not_checked"
      }
    ]);
    expect(JSON.stringify(target.listAiRuns())).not.toContain("DO-NOT-STORE");
  });

  it("records enabled-but-unconfigured direct runtime as unavailable without a model call", async () => {
    const repository = new MemoryIntakeRepository();
    const app = track(
      buildApi({ repository, widgetAi: { enabled: true, modelName: "gpt-5.5" } })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-missing-provider-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "missing_openai_config" }
    });
    expect(repository.listAiRuns()).toMatchObject([
      {
        status: "fallback_unavailable",
        outcomeReason: "missing_provider_config",
        failureCode: "provider_unavailable",
        model: {
          modelProvider: "openai",
          requestedModelName: "gpt-5.5",
          reasoningEffort: "low"
        },
        observedModelProvider: "none",
        qualityEvents: [{ eventType: "degradation", reasonCode: "missing_openai_config" }]
      }
    ]);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expectManagerReview(repository, "ai_no_reply");
  });

  it("fails closed before generation when the configured model name is invalid", async () => {
    const repository = new MemoryIntakeRepository();
    const generateReply = vi.fn();
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          modelName: "invalid model name",
          provider: {
            providerKind: "openai",
            generateReply
          }
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-invalid-model-config-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "missing_openai_config" }
    });
    expect(generateReply).not.toHaveBeenCalled();
    expect(repository.aiRunCount).toBe(0);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expectManagerReview(repository, "ai_executor_unavailable");
  });

  it("creates no run when AI is disabled or the recorder cannot start", async () => {
    const disabledRepository = new MemoryIntakeRepository();
    const disabledApp = track(buildApi({ repository: disabledRepository }));
    const disabled = await disabledApp.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-disabled-no-run-0001")
    });

    expect(disabled.json()).toMatchObject({ automation: { status: "disabled" } });
    expect(disabledRepository.aiRunCount).toBe(0);

    const unavailableRepository = new MemoryIntakeRepository({ failAiRunBegin: true });
    const generator = vi.fn();
    const unavailableApp = track(
      buildApi({
        repository: unavailableRepository,
        widgetAi: { enabled: true, replyGenerator: { generateReply: generator } }
      })
    );
    const unavailable = await unavailableApp.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-recorder-unavailable-0001")
    });

    expect(unavailable.json()).toMatchObject({
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    expect(generator).not.toHaveBeenCalled();
    expect(unavailableRepository.aiRunCount).toBe(0);
    expect(unavailableRepository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expectManagerReview(unavailableRepository, "ai_execution_failed");
  });

  it("fails closed through the AppContext capability when the recorded executor is missing", async () => {
    const target = new MemoryIntakeRepository();
    const repository = new Proxy(target, {
      get(object, property) {
        if (property === "persistRecordedSiteWidgetAiReply") {
          return undefined;
        }

        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
    });
    const generator = vi.fn();
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, replyGenerator: { generateReply: generator } }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-missing-executor-0001")
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    expect(generator).not.toHaveBeenCalled();
    expectManagerReview(target, "ai_executor_unavailable");
  });

  it("returns the retryable 503 contract when the manager-review transition cannot persist", async () => {
    const repository = new MemoryIntakeRepository({
      failAiRunBegin: true,
      failManagerReviewTransition: true
    });
    const generator = vi.fn();
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, replyGenerator: { generateReply: generator } }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("p2-manager-transition-failure-0001")
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: {
        type: "retryable_backend_failure",
        code: "persistence_unconfirmed",
        action: "retry_or_show_fallback"
      }
    });
    expect(generator).not.toHaveBeenCalled();
    expect(repository.managerReviewTransitionCalls).toBe(1);
  });

  it("closes the gate before a concurrent running replay returns retryable pending", async () => {
    const repository = new MemoryIntakeRepository();
    let signalGeneratorStarted!: () => void;
    let releaseGenerator!: () => void;
    const generatorStarted = new Promise<void>((resolve) => {
      signalGeneratorStarted = resolve;
    });
    const generatorRelease = new Promise<void>((resolve) => {
      releaseGenerator = resolve;
    });
    const generator = vi.fn(async () => {
      signalGeneratorStarted();
      await generatorRelease;
      return {
        decision: "reply_candidate" as const,
        text: "Этот ответ должен быть заблокирован конкурентным replay.",
        metadata: { model_provider: "fake" }
      };
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: { enabled: true, replyGenerator: { generateReply: generator } }
      })
    );
    const payload = widgetRequest("p2-concurrent-running-replay-0001");
    const firstPromise = app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });

    await generatorStarted;
    let replay;
    try {
      replay = await app.inject({
        method: "POST",
        url: "/public/intake/site-widget/messages",
        payload
      });
      expect(replay.statusCode).toBe(503);
      expect(replay.json()).toMatchObject({
        error: { type: "retryable_backend_failure", code: "persistence_unconfirmed" }
      });
      expect(generator).toHaveBeenCalledTimes(1);
      expect(repository.listAiRuns()).toMatchObject([
        {
          status: "running",
          model: {
            modelProvider: "fake",
            requestedModelName: "injected_generator",
            reasoningEffort: "none"
          }
        }
      ]);
      expectManagerReview(repository, "ai_run_in_progress");
    } finally {
      releaseGenerator();
    }

    const first = await firstPromise;
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({
      automation: { status: "fallback", reason: "agent_reply_blocked" }
    });
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("keeps a running replay from invoking the generator after completion storage fails", async () => {
    const repository = new MemoryIntakeRepository({ failAiRunCompletion: true });
    const generator = vi.fn(async () => ({
      decision: "reply_candidate",
      text: "Ответ не должен стать видимым без terminal run.",
      metadata: { model_provider: "fake" }
    }));
    const app = track(
      buildApi({ repository, widgetAi: { enabled: true, replyGenerator: { generateReply: generator } } })
    );
    const payload = widgetRequest("p2-running-replay-0001");

    const first = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });
    const replay = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });

    expect(first.json()).toMatchObject({ automation: { status: "fallback", reason: "ai_persistence_unconfirmed" } });
    expect(replay.statusCode).toBe(503);
    expect(replay.json()).toMatchObject({
      error: { type: "retryable_backend_failure", code: "persistence_unconfirmed" }
    });
    expect(generator).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()).toMatchObject([{ status: "running" }]);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expectManagerReview(repository, "ai_execution_failed");
  });

  it("replays a terminal persistence failure without regenerating a draft", async () => {
    const repository = new MemoryIntakeRepository({ failAiPersistence: true });
    const generator = vi.fn(async () => ({
      decision: "reply_candidate",
      text: "Этот draft не должен пережить persistence failure.",
      metadata: { model_provider: "fake", raw_error: "DO-NOT-PERSIST" }
    }));
    const app = track(
      buildApi({ repository, widgetAi: { enabled: true, replyGenerator: { generateReply: generator } } })
    );
    const payload = widgetRequest("p2-persistence-failure-replay-0001");

    const first = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });
    const replay = await app.inject({ method: "POST", url: "/public/intake/site-widget/messages", payload });

    expect(first.json()).toMatchObject({ automation: { status: "fallback", reason: "ai_persistence_unconfirmed" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    expect(generator).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()).toMatchObject([
      {
        status: "failed",
        outcomeReason: "ai_persistence_unconfirmed",
        failureCode: "persistence_failure"
      }
    ]);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(JSON.stringify(repository.listAiRuns())).not.toContain("DO-NOT-PERSIST");
    expectManagerReview(repository, "ai_reply_persistence_unconfirmed");
  });

  it("commits controlled blocked evidence when takeover closes the send gate", async () => {
    const repository = new MemoryIntakeRepository();
    const generateReply = vi.fn(async (input: AiTurnInput) => {
      const lead = repository.onlyLead();
      await repository.takeoverConversation({
        leadId: lead.leadId,
        publicConversationId: input.conversation.publicConversationId,
        changedByManagerId: "p2-manager",
        changedByManagerEmail: "owner@example.test",
        changedByManagerRole: "owner"
      });
      return {
        decision: "reply_candidate",
        text: "Этот draft не должен быть сохранён.",
        metadata: { model_provider: "fake" }
      };
    });
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          replyGenerator: { generateReply }
        }
      })
    );
    const payload = widgetRequest("p2-send-gate-block-0001");

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    const replay = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });

    expect(response.json()).toMatchObject({ automation: { status: "fallback", reason: "agent_reply_blocked" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: "agent_reply_blocked" }
    });
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "blocked",
      outcomeReason: "agent_reply_blocked",
      sendGateResult: "blocked",
      qualityEvents: [{ eventType: "blocked", reasonCode: "agent_reply_blocked" }]
    });
    const blockedRun = repository.listAiRuns()[0];
    if (!blockedRun || blockedRun.status === "running") {
      throw new Error("expected a terminal blocked run");
    }
    expect(
      blockedRun.spans.find((span) => span.name === "send_gate_check")?.usedInFinalAnswer
    ).toBe(false);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      agentAllowedToReply: false,
      aiState: "manager_active"
    });
  });
});

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}

function widgetRequest(idempotencyKey: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: idempotencyKey,
    submitted_at: "2026-07-14T20:00:00.000Z",
    source: {
      channel: "site_widget",
      page_url: "https://granit.example/catalog/widget",
      widget_instance_id: "p2-observability-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}

function expectManagerReview(
  repository: MemoryIntakeRepository,
  reason: string
): void {
  const lead = repository.onlyLead();
  expect(lead.conversations[0]).toMatchObject({
    agentAllowedToReply: false,
    aiState: "needs_manager"
  });
  expect(
    lead.timeline.filter(
      (event) => event.eventType === "conversation.ai_manager_review_required"
    )
  ).toMatchObject([{ metadata: { reason } }]);
}
