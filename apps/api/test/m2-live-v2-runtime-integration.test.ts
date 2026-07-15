import {
  SITE_WIDGET_CONTRACT_VERSION,
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import type { MastraLiveV2AgentPort } from "../src/modules/ai/adapters/mastra-live-v2-decision-generator.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  clarifyingCandidate,
  handoffCandidate,
  noReplyCandidate
} from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const LOCAL_MODEL = "mastra-local-fixture-v1";
const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
});

describe("M2 app-owned live_v2 local/fake runtime", () => {
  it("records honest fake truth, trusted runtime evidence and terminal replay", async () => {
    const repository = new MemoryIntakeRepository();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const candidate = answerCandidate();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => ({
      candidate,
      modelProvider: "fake",
      providerModelName: LOCAL_MODEL,
      runtimeRunId: "mastra-local-runtime-001",
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        raw: "RAW_M2_USAGE_CANARY"
      }
    }));
    const app = track(buildLocalFakeApi(repository, { generate }));
    const payload = widgetRequest("m2-live-answer-replay-0001");

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

    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ automation: { status: "replied" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: {
        status: "replied",
        reply: { public_message_id: first.json().automation.reply.public_message_id }
      }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(repository.aiRunCount).toBe(1);
    const [run] = repository.listAiRuns();
    if (!run) {
      throw new Error("expected one M2 local/fake run");
    }
    expect(run).toMatchObject({
      status: "persisted",
      runtimeMode: "mastra_openai_api",
      decisionProfile: "live_v2",
      model: {
        modelProvider: "fake",
        requestedModelName: LOCAL_MODEL,
        reasoningEffort: "none"
      },
      observedModelProvider: "fake",
      observedModelName: LOCAL_MODEL,
      runtimeRunId: "mastra-local-runtime-001",
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      sendGateResult: "allowed"
    });
    expect(run).not.toHaveProperty("costEstimateMicrounits");
    expect(run).not.toHaveProperty("costRateVersion");
    expect(run.versions).toMatchObject({
      policyVersion: "granit_live_v2_policy.v1",
      promptVersion: "granit_live_v2_prompt.v1",
      factsVersion: "granit_live_v2_facts.v1",
      toneVersion: "granit_live_v2_tone.v1"
    });
    expect(run.status === "running" ? [] : run.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "model", name: "model_generation", status: "succeeded" }),
        expect.objectContaining({ kind: "validation", name: "candidate_validation", status: "succeeded" }),
        expect.objectContaining({ kind: "send_gate", name: "send_gate_check", status: "succeeded" }),
        expect.objectContaining({ name: "reply_persistence", status: "succeeded" })
      ])
    );
    expect(JSON.stringify(run)).not.toContain("RAW_M2");
    expect(JSON.stringify(repository.onlyLead().timeline)).not.toContain("RAW_M2");
    expect(JSON.stringify(first.json())).not.toContain("runtime");
    expect(JSON.stringify(first.json())).not.toContain("trace");
  });

  it.each([
    {
      name: "clarification",
      candidate: clarifyingCandidate({
        slot: "material",
        replyDraft: "Какой материал вы рассматриваете?"
      }),
      expectedStatus: "persisted",
      expectedAction: "ask_clarifying_question",
      expectedConversation: { aiState: "ai_collecting_info", agentAllowedToReply: true }
    },
    {
      name: "handoff",
      candidate: handoffCandidate(),
      expectedStatus: "handed_off",
      expectedAction: "handoff_to_manager",
      expectedConversation: { aiState: "needs_manager", agentAllowedToReply: false }
    }
  ])("persists a validated $name through the common atomic path", async (fixture) => {
    const repository = new MemoryIntakeRepository();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () =>
      fakeResult(fixture.candidate, `runtime-${fixture.name}`)
    );
    const app = track(buildLocalFakeApi(repository, { generate }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest(`m2-live-${fixture.name}-0001`)
    });

    expect(response.json()).toMatchObject({ automation: { status: "replied" } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: fixture.expectedStatus,
      normalizedAction: fixture.expectedAction,
      observedModelProvider: "fake"
    });
    expect(repository.onlyLead().conversations[0]).toMatchObject(
      fixture.expectedConversation
    );
  });

  it.each([
    {
      name: "valid-no-reply",
      candidate: noReplyCandidate("missing_approved_fact"),
      expectedOutcome: "missing_approved_fact",
      expectedValidator: "passed",
      expectedPublicReason: "unsafe_model_response",
      expectedFailureCode: undefined
    },
    {
      name: "invalid-candidate",
      candidate: {
        ...answerCandidate({ replyDraft: "Цена составит 120 000 руб.", factIds: [] }),
        rawProviderPayload: "RAW_M2_INVALID_CANDIDATE_CANARY"
      },
      expectedOutcome: "candidate_invalid",
      expectedValidator: "rejected",
      expectedPublicReason: "unsafe_model_response",
      expectedFailureCode: "invalid_candidate"
    }
  ])("fails closed for $name and terminal replay never regenerates", async (fixture) => {
    const repository = new MemoryIntakeRepository();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () =>
      fakeResult(fixture.candidate, `runtime-${fixture.name}`)
    );
    const app = track(buildLocalFakeApi(repository, { generate }));
    const payload = widgetRequest(`m2-live-${fixture.name}-0001`);

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
      automation: { status: "fallback", reason: fixture.expectedPublicReason }
    });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: fixture.expectedPublicReason }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    const [run] = repository.listAiRuns();
    if (!run || run.status === "running") throw new Error("expected terminal M2 run");
    expect(run).toMatchObject({
      status: fixture.name === "valid-no-reply" ? "fallback_unavailable" : "blocked",
      outcomeReason: fixture.expectedOutcome,
      validatorResult: fixture.expectedValidator,
      sendGateResult: "not_checked"
    });
    expect(run.failureCode).toBe(fixture.expectedFailureCode);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(JSON.stringify(repository.listAiRuns())).not.toContain("RAW_M2_INVALID");
    expect(JSON.stringify(repository.onlyLead().timeline)).not.toContain("RAW_M2_INVALID");
  });

  it("normalizes a fake runtime failure and replays it without another call", async () => {
    const repository = new MemoryIntakeRepository();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => {
      throw new Error("RAW_M2_RUNTIME_SECRET");
    });
    const app = track(buildLocalFakeApi(repository, { generate }));
    const payload = widgetRequest("m2-live-runtime-failure-0001");

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

    expect(first.json()).toMatchObject({ automation: { status: "fallback", reason: "model_error" } });
    expect(replay.json()).toMatchObject({
      status: "replayed",
      automation: { status: "fallback", reason: "model_error" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "fallback_unavailable",
      outcomeReason: "generator_failed",
      observedModelProvider: "none"
    });
    expect(JSON.stringify(repository.listAiRuns())).not.toContain("RAW_M2_RUNTIME_SECRET");
  });

  it("records sanitized returned identity when the trusted adapter rejects a model mismatch", async () => {
    const repository = new MemoryIntakeRepository();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => ({
      candidate: answerCandidate(),
      modelProvider: "fake",
      providerModelName: "unexpected-safe-local-model",
      runtimeRunId: "runtime-model-mismatch",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }
    }));
    const app = track(buildLocalFakeApi(repository, { generate }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-live-model-mismatch-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "model_error" }
    });
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "fallback_unavailable",
      outcomeReason: "generator_failed",
      observedModelProvider: "fake",
      observedModelName: "unexpected-safe-local-model",
      runtimeRunId: "runtime-model-mismatch",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }
    });
  });

  it("blocks a manager takeover after generation and persists no outbound", async () => {
    const repository = new MemoryIntakeRepository();
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => {
      const lead = repository.onlyLead();
      const conversation = lead.conversations[0]!;
      await repository.takeoverConversation({
        leadId: lead.leadId,
        publicConversationId: conversation.publicConversationId,
        changedByManagerId: "m2-manager",
        changedByManagerEmail: "owner@example.test",
        changedByManagerRole: "owner"
      });
      return fakeResult(answerCandidate(), "runtime-takeover");
    });
    const app = track(buildLocalFakeApi(repository, { generate }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-live-takeover-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "agent_reply_blocked" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      status: "blocked",
      outcomeReason: "gate_closed",
      sendGateResult: "blocked"
    });
    expect(repository.aiSaveCalls).toBe(0);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(repository.onlyLead().conversations[0]).toMatchObject({
      aiState: "manager_active",
      agentAllowedToReply: false
    });
  });

  it("blocks a takeover in the race after fresh gate read and before atomic persistence", async () => {
    const target = new MemoryIntakeRepository();
    let freshGateRead = false;
    const repository = new Proxy(target, {
      get(object, property) {
        if (property === "readRecordedSiteWidgetAiGate") {
          return async (input: { leadId: string; conversationId: string }) => {
            freshGateRead = true;
            return object.readRecordedSiteWidgetAiGate(input);
          };
        }

        if (property === "persistRecordedSiteWidgetAiReply") {
          return async (
            input: Parameters<MemoryIntakeRepository["persistRecordedSiteWidgetAiReply"]>[0]
          ) => {
            if (!freshGateRead) throw new Error("expected fresh gate before persistence");
            const lead = object.onlyLead();
            const conversation = lead.conversations[0]!;
            await object.takeoverConversation({
              leadId: lead.leadId,
              publicConversationId: conversation.publicConversationId,
              changedByManagerId: "m2-race-manager",
              changedByManagerEmail: "owner@example.test",
              changedByManagerRole: "owner"
            });
            return object.persistRecordedSiteWidgetAiReply(input);
          };
        }

        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
    });
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () =>
      fakeResult(answerCandidate(), "runtime-post-read-race")
    );
    const app = track(buildLocalFakeApi(repository, { generate }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-live-post-read-race-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "agent_reply_blocked" }
    });
    expect(freshGateRead).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(target.listAiRuns()[0]).toMatchObject({
      status: "blocked",
      outcomeReason: "agent_reply_blocked",
      sendGateResult: "blocked"
    });
    expect(target.aiSaveCalls).toBe(1);
    expect(target.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("fails closed when the app-owned fresh gate cannot be read", async () => {
    const target = new MemoryIntakeRepository();
    const repository = new Proxy(target, {
      get(object, property) {
        if (property === "readRecordedSiteWidgetAiGate") {
          return async () => {
            throw new Error("RAW_M2_GATE_READER_CANARY");
          };
        }

        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
    });
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () =>
      fakeResult(answerCandidate(), "runtime-gate-failure")
    );
    const app = track(buildLocalFakeApi(repository, { generate }));

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-live-gate-failure-0001")
    });

    expect(response.json()).toMatchObject({
      automation: { status: "fallback", reason: "ai_persistence_unconfirmed" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(target.listAiRuns()[0]).toMatchObject({
      status: "failed",
      outcomeReason: "recorder_failure",
      sendGateResult: "not_checked",
      observedModelProvider: "fake"
    });
    expect(target.onlyLead().conversations[0]?.messages).toHaveLength(1);
    expect(JSON.stringify(target.listAiRuns())).not.toContain("RAW_M2_GATE_READER_CANARY");
  });

  it("allows one concurrent run only and never duplicates an outbound", async () => {
    const repository = new MemoryIntakeRepository();
    let releaseGeneration!: () => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => {
      markGenerationStarted();
      await release;
      return fakeResult(answerCandidate(), "runtime-concurrent");
    });
    const app = track(buildLocalFakeApi(repository, { generate }));
    const payload = widgetRequest("m2-live-concurrent-0001");

    const firstPromise = app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    await generationStarted;
    const concurrent = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload
    });
    releaseGeneration();
    const first = await firstPromise;

    expect(concurrent.statusCode).toBe(503);
    expect(first.json()).toMatchObject({
      automation: { status: "fallback", reason: "agent_reply_blocked" }
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(repository.aiRunCount).toBe(1);
    expect(repository.aiSaveCalls).toBe(0);
    expect(repository.onlyLead().conversations[0]?.messages).toHaveLength(1);
  });

  it("keeps direct rollback on frozen legacy_s05 with no live_v2 fallback", async () => {
    const repository = new MemoryIntakeRepository();
    const generateReply = vi.fn(async () => ({
      decision: "reply_candidate" as const,
      text: "Legacy rollback reply",
      metadata: { model_provider: "fake" }
    }));
    const app = track(
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          runtimeMode: "direct_openai",
          modelName: "direct-local-fixture-v1",
          replyGenerator: { generateReply }
        }
      })
    );

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: widgetRequest("m2-direct-rollback-0001")
    });

    expect(response.json()).toMatchObject({ automation: { status: "replied" } });
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(repository.listAiRuns()[0]).toMatchObject({
      runtimeMode: "direct_openai",
      decisionProfile: "legacy_s05"
    });
  });

  it("has no implicit direct fallback for a malformed Mastra selection", async () => {
    const repository = new MemoryIntakeRepository();
    const directGenerate = vi.fn();
    expect(() =>
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          runtimeMode: "mastra_openai_api",
          provider: { providerKind: "openai", generateReply: directGenerate }
        } as never
      })
    ).toThrow("requires an explicit local fake boundary");

    expect(directGenerate).not.toHaveBeenCalled();
    expect(repository.aiRunCount).toBe(0);
  });

  it("throws on an unknown runtime selector instead of falling back to direct", () => {
    const repository = new MemoryIntakeRepository();
    const directGenerate = vi.fn();

    expect(() =>
      buildApi({
        repository,
        widgetAi: {
          enabled: true,
          runtimeMode: "unknown_runtime",
          provider: { providerKind: "openai", generateReply: directGenerate }
        } as never
      })
    ).toThrow("Unsupported AI runtime mode");
    expect(directGenerate).not.toHaveBeenCalled();
    expect(repository.aiRunCount).toBe(0);
  });
});

function buildLocalFakeApi(
  repository: MemoryIntakeRepository,
  agent: MastraLiveV2AgentPort
) {
  return buildApi({
    repository,
    widgetAi: {
      enabled: true,
      runtimeMode: "mastra_openai_api",
      localFake: {
        agent,
        modelName: LOCAL_MODEL,
        approvedFacts: TEST_LIVE_V2_FACTS
      }
    }
  });
}

function fakeResult(candidate: unknown, runtimeRunId: string) {
  return {
    candidate,
    modelProvider: "fake",
    providerModelName: LOCAL_MODEL,
    runtimeRunId,
    usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
  };
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
      widget_instance_id: "m2-local-fake-test"
    },
    message: { role: "visitor", text: "Помогите выбрать памятник" },
    consent: { privacy_policy: true }
  };
}

function track<T extends ReturnType<typeof buildApi>>(app: T): T {
  openApps.push(app);
  return app;
}
