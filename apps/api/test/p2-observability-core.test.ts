import { describe, expect, it, vi } from "vitest";

import {
  buildSiteWidgetAiTurnExecutionContext,
  buildStageASiteWidgetAiTurnInput,
  type AiUnavailableReason
} from "../src/modules/ai/ai-turn.js";
import type {
  AiRunRepository,
  AiRunTerminalCompletion,
  AiRunVersions,
  BeginAiRunInput,
  BeginAiRunResult,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../src/modules/ai/repositories/ai-run-repository.js";
import type {
  RecordedLegacyS05PersistReplyResult,
  RecordedLegacyS05ReplyApplier
} from "../src/modules/ai/ports/recorded-legacy-s05-turn.js";
import { legacyS05ReplayDisposition } from "../src/modules/ai/services/legacy-s05-observability.js";
import {
  AiRunRecorderUnavailableError,
  RecordedLegacyS05ExecutionError,
  RecordedLegacyS05TurnService
} from "../src/modules/ai/services/recorded-legacy-s05-turn-service.js";
import {
  WidgetAiService,
  type WidgetAiProvider
} from "../src/modules/ai/services/widget-ai-service.js";

const VERSIONS: AiRunVersions = {
  policyVersion: "widget-ai-policy.v1",
  promptVersion: "widget-ai-prompt.v1",
  toolVersion: "none.v1",
  disclosureVersion: "widget-ai-disclosure.v1",
  modelProfileVersion: "direct-openai.v1"
};

describe("P2 app-owned AI observability core", () => {
  it("records one atomic answer and terminal replay performs zero duplicate generation", async () => {
    const fixture = buildFixture();
    const repository = new MemoryAiRunRepository();
    const applier = new AtomicReplyApplier(repository, "allowed");
    const { generator, providerCall } = fakeWidgetGenerator(
      "Подскажу варианты. Какой стиль вам ближе?",
      {
        modelName: "provider-observed-fake-v2",
        responseId: "DO-NOT-PERSIST-RAW-PAYLOAD",
        usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 }
      }
    );
    const service = buildService(repository);

    const first = await service.execute({
      ...fixture,
      generator,
      replyApplier: applier
    });

    expect(first.kind).toBe("executed");
    expect(first.run).toMatchObject({
      status: "persisted",
      normalizedAction: "answer",
      outcomeReason: "reply_persisted",
      model: {
        modelProvider: "fake",
        requestedModelName: "p2-observability-fake",
        reasoningEffort: "none"
      },
      observedModelProvider: "fake",
      observedModelName: "provider-observed-fake-v2",
      sendGateResult: "allowed",
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 }
    });
    expect(repository.createdCount).toBe(1);
    expect(applier.calls).toHaveLength(1);
    expect(JSON.stringify(applier.calls[0]?.completionPlan)).not.toContain(
      "DO-NOT-PERSIST-RAW-PAYLOAD"
    );

    const replay = await service.execute({
      ...fixture,
      generator,
      replyApplier: applier
    });

    expect(replay).toMatchObject({ kind: "terminal_replay", run: { status: "persisted" } });
    expect(legacyS05ReplayDisposition(replay.run)).toEqual({ kind: "reuse_outbound" });
    expect(providerCall).toHaveBeenCalledTimes(1);
    expect(applier.calls).toHaveLength(1);
    expect(repository.createdCount).toBe(1);
  });

  it("records a handoff and an actual send-gate block with controlled quality events", async () => {
    const handoffRepository = new MemoryAiRunRepository();
    const handoff = await buildService(handoffRepository).execute({
      ...buildFixture("Позовите менеджера"),
      generator: new WidgetAiService(),
      replyApplier: new AtomicReplyApplier(handoffRepository, "allowed")
    });

    expect(handoff.run).toMatchObject({
      status: "handed_off",
      normalizedAction: "handoff_to_manager",
      outcomeReason: "handoff_to_manager",
      model: { modelProvider: "fake", requestedModelName: "p2-observability-fake" },
      observedModelProvider: "policy",
      observedModelName: "deterministic",
      qualityEvents: [
        {
          eventType: "handoff",
          reasonCode: "handoff_to_manager",
          managerVisible: true
        }
      ]
    });

    const blockedRepository = new MemoryAiRunRepository();
    const blocked = await buildService(blockedRepository).execute({
      ...buildFixture(),
      generator: fakeWidgetGenerator("Подскажу подходящие варианты.").generator,
      replyApplier: new AtomicReplyApplier(blockedRepository, "agent_reply_blocked")
    });

    if (blocked.kind !== "executed") {
      throw new Error("expected an executed blocked result");
    }

    expect(blocked.run).toMatchObject({
      status: "blocked",
      outcomeReason: "agent_reply_blocked",
      failureCode: "send_gate_blocked",
      sendGateResult: "blocked",
      qualityEvents: [{ eventType: "blocked", reasonCode: "agent_reply_blocked" }]
    });
    expect(
      blocked.run.spans.find((span) => span.name === "send_gate_check")?.usedInFinalAnswer
    ).toBe(false);
  });

  it.each<{
    reason: AiUnavailableReason;
    status: TerminalAiRunRecord["status"];
    outcomeReason: TerminalAiRunRecord["outcomeReason"];
    observedModelProvider: TerminalAiRunRecord["observedModelProvider"];
    generatorStatus: string;
    validationStatus: string;
    publicReason: AiUnavailableReason;
  }>([
    {
      reason: "missing_openai_config",
      status: "fallback_unavailable",
      outcomeReason: "missing_provider_config",
      observedModelProvider: "none",
      generatorStatus: "skipped",
      validationStatus: "skipped",
      publicReason: "missing_openai_config"
    },
    {
      reason: "model_error",
      status: "fallback_unavailable",
      outcomeReason: "model_error",
      observedModelProvider: "none",
      generatorStatus: "failed",
      validationStatus: "skipped",
      publicReason: "model_error"
    },
    {
      reason: "empty_model_response",
      status: "fallback_unavailable",
      outcomeReason: "empty_model_response",
      observedModelProvider: "fake",
      generatorStatus: "succeeded",
      validationStatus: "failed",
      publicReason: "empty_model_response"
    },
    {
      reason: "unsafe_model_response",
      status: "blocked",
      outcomeReason: "unsafe_model_response",
      observedModelProvider: "fake",
      generatorStatus: "succeeded",
      validationStatus: "failed",
      publicReason: "unsafe_model_response"
    }
  ])(
    "maps $reason without copying arbitrary metadata",
    async ({
      reason,
      status,
      outcomeReason,
      observedModelProvider,
      generatorStatus,
      validationStatus,
      publicReason
    }) => {
      const repository = new MemoryAiRunRepository();
      const { generator } = noReplyWidgetGenerator(reason);

      const result = await buildService(repository).execute({
        ...buildFixture(),
        generator,
        replyApplier: new AtomicReplyApplier(repository, "allowed")
      });

      if (result.kind !== "executed") {
        throw new Error("expected an executed terminal result");
      }

      expect(result.run).toMatchObject({ status, outcomeReason, observedModelProvider });
      expect(result.run.usage).toBeUndefined();
      expect(result.run.spans.find((span) => span.name === "model_generation")?.status).toBe(
        generatorStatus
      );
      expect(result.run.spans.find((span) => span.name === "candidate_validation")?.status).toBe(
        validationStatus
      );
      expect(JSON.stringify(result.run)).not.toContain("RAW-PROVIDER-RESPONSE");
      expect(legacyS05ReplayDisposition(result.run)).toEqual({
        kind: "fallback",
        reason: publicReason,
        managerReviewRequired: true
      });
    }
  );

  it("records execution-context mismatch without invoking the generator", async () => {
    const repository = new MemoryAiRunRepository();
    const fixture = buildFixture();
    const generator = vi.fn();

    const result = await buildService(repository).execute({
      ...fixture,
      executionContext: {
        ...fixture.executionContext,
        public: {
          ...fixture.executionContext.public,
          inboundMessageId: "00000000-0000-4000-8000-000000000099"
        }
      },
      generator: { generateReply: generator },
      replyApplier: new AtomicReplyApplier(repository, "allowed")
    });

    expect(generator).not.toHaveBeenCalled();
    expect(result.run).toMatchObject({
      status: "blocked",
      outcomeReason: "execution_context_mismatch",
      failureCode: "execution_context_mismatch",
      observedModelProvider: "none"
    });
  });

  it("does not let generator metadata spoof an execution-context mismatch", async () => {
    const repository = new MemoryAiRunRepository();

    const result = await buildService(repository).execute({
      ...buildFixture(),
      generator: {
        async generateReply() {
          return {
            decision: "no_reply",
            reason: "unsafe_model_response",
            metadata: {
              model_provider: "openai",
              model_name: "spoofed-openai-model",
              input_tokens: 42,
              error_type: "execution_context_mismatch"
            }
          };
        }
      },
      replyApplier: new AtomicReplyApplier(repository, "allowed")
    });

    if (result.kind !== "executed") {
      throw new Error("expected an executed spoof-resistant result");
    }

    expect(result.run).toMatchObject({
      status: "blocked",
      outcomeReason: "unsafe_model_response",
      failureCode: "policy_violation",
      model: {
        modelProvider: "fake",
        requestedModelName: "p2-observability-fake"
      },
      observedModelProvider: "none"
    });
    expect(result.run.observedModelName).toBeUndefined();
    expect(result.run.usage).toBeUndefined();
  });

  it("does not let a fake provider adapter report itself as OpenAI", async () => {
    const repository = new MemoryAiRunRepository();
    const replyApplier = new AtomicReplyApplier(repository, "allowed");
    const provider: WidgetAiProvider = {
      providerKind: "fake",
      async generateReply() {
        return {
          text: "Подскажу подходящие варианты.",
          modelProvider: "openai",
          modelName: "spoofed-openai-model"
        };
      }
    };

    const result = await buildService(repository).execute({
      ...buildFixture(),
      generator: new WidgetAiService({ provider }),
      replyApplier
    });

    if (result.kind !== "executed") {
      throw new Error("expected an executed provider-mismatch result");
    }

    expect(result.run).toMatchObject({
      status: "fallback_unavailable",
      outcomeReason: "model_error",
      failureCode: "model_failure",
      model: { modelProvider: "fake" },
      observedModelProvider: "none"
    });
    expect(result.run.observedModelName).toBeUndefined();
    expect(replyApplier.calls).toHaveLength(0);
  });

  it("records a sanitized terminal failure when the generator throws", async () => {
    const repository = new MemoryAiRunRepository();
    const secret = "RAW-ERROR-CUSTOMER-TEXT";

    await expect(
      buildService(repository).execute({
        ...buildFixture(),
        generator: {
          async generateReply() {
            throw new Error(secret);
          }
        },
        replyApplier: new AtomicReplyApplier(repository, "allowed")
      })
    ).rejects.toBeInstanceOf(RecordedLegacyS05ExecutionError);

    const terminal = repository.onlyTerminal();
    expect(terminal).toMatchObject({
      status: "failed",
      outcomeReason: "generator_failed",
      failureCode: "runtime_failure",
      observedModelProvider: "none",
      qualityEvents: [{ eventType: "runtime_failure", reasonCode: "runtime_failed" }]
    });
    expect(JSON.stringify(terminal)).not.toContain(secret);
  });

  it("maps an atomic persistence exception to persistence failure without raw error text", async () => {
    const repository = new MemoryAiRunRepository();

    await expect(
      buildService(repository).execute({
        ...buildFixture(),
        generator: fakeWidgetGenerator("Подскажу подходящие варианты.").generator,
        replyApplier: new AtomicReplyApplier(repository, "throw")
      })
    ).rejects.toBeInstanceOf(RecordedLegacyS05ExecutionError);

    const terminal = repository.onlyTerminal();
    expect(terminal).toMatchObject({
      status: "failed",
      outcomeReason: "ai_persistence_unconfirmed",
      failureCode: "persistence_failure",
      observedModelProvider: "fake",
      observedModelName: "p2-provider-fake"
    });
    expect(JSON.stringify(terminal)).not.toContain("RAW POSTGRES ERROR");
  });

  it("returns running replay and fails closed with a sanitized recorder error", async () => {
    const repository = new MemoryAiRunRepository();
    const fixture = buildFixture();
    await repository.beginOrReplay(beginInputFor(fixture));
    const generator = vi.fn();

    const runningReplay = await buildService(repository).execute({
      ...fixture,
      generator: { generateReply: generator },
      replyApplier: new AtomicReplyApplier(repository, "allowed")
    });

    expect(runningReplay.kind).toBe("running_replay");
    expect(legacyS05ReplayDisposition(runningReplay.run)).toEqual({ kind: "pending" });
    expect(generator).not.toHaveBeenCalled();

    const unavailableRepository: AiRunRepository = {
      async beginOrReplay() {
        throw new Error("RAW DATABASE CONNECTION DETAILS");
      },
      async completeWithoutReply() {
        throw new Error("unreachable");
      }
    };

    await expect(
      buildService(unavailableRepository).execute({
        ...fixture,
        generator: { generateReply: generator },
        replyApplier: new AtomicReplyApplier(repository, "allowed")
      })
    ).rejects.toEqual(new AiRunRecorderUnavailableError());
  });
});

class MemoryAiRunRepository implements AiRunRepository {
  readonly runs = new Map<string, RunningAiRunRecord | TerminalAiRunRecord>();
  createdCount = 0;

  async beginOrReplay(input: BeginAiRunInput): Promise<BeginAiRunResult> {
    const existing = this.runs.get(input.idempotencyKey);
    if (existing) {
      if (existing.inputFingerprint !== input.inputFingerprint) {
        throw new Error("idempotency fingerprint mismatch");
      }
      return existing.status === "running"
        ? { kind: "running_replay", run: existing }
        : { kind: "terminal_replay", run: existing };
    }

    const run: RunningAiRunRecord = {
      ...input,
      id: `00000000-0000-4000-8000-${String(900_000 + ++this.createdCount).padStart(12, "0")}`,
      status: "running"
    };
    this.runs.set(input.idempotencyKey, run);
    return { kind: "started", run };
  }

  async completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord> {
    return this.complete(input.run, input.completion);
  }

  complete(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    outboundMessageId?: string
  ): TerminalAiRunRecord {
    const current = this.runs.get(run.idempotencyKey);
    if (!current || current.status !== "running" || current.id !== run.id) {
      throw new Error("run is not active");
    }

    const terminal: TerminalAiRunRecord = {
      ...run,
      ...completion,
      ...(outboundMessageId ? { outboundMessageId } : {})
    };
    this.runs.set(run.idempotencyKey, terminal);
    return terminal;
  }

  onlyTerminal(): TerminalAiRunRecord {
    const runs = [...this.runs.values()];
    const run = runs[0];
    if (runs.length !== 1 || !run || run.status === "running") {
      throw new Error("expected exactly one terminal run");
    }
    return run;
  }
}

class AtomicReplyApplier implements RecordedLegacyS05ReplyApplier {
  readonly calls: Parameters<RecordedLegacyS05ReplyApplier["persistReplyAndCompleteRun"]>[0][] = [];

  constructor(
    private readonly repository: MemoryAiRunRepository,
    private readonly result:
      | "allowed"
      | "agent_reply_blocked"
      | "ai_persistence_unconfirmed"
      | "throw"
  ) {}

  async persistReplyAndCompleteRun(
    input: Parameters<RecordedLegacyS05ReplyApplier["persistReplyAndCompleteRun"]>[0]
  ): Promise<RecordedLegacyS05PersistReplyResult> {
    this.calls.push(input);

    if (this.result === "throw") {
      throw new Error("RAW POSTGRES ERROR");
    }

    if (this.result === "allowed") {
      const outboundMessageId = "00000000-0000-4000-8000-000000000020";
      const completedRun = this.repository.complete(
        input.run,
        withSendGateSpan(input.completionPlan.allowed, "succeeded"),
        outboundMessageId
      );
      return {
        status: "persisted",
        internalMessageId: outboundMessageId,
        publicMessageId: "00000000-0000-4000-8000-000000000021",
        body: input.reply.replyDraft,
        completedRun
      };
    }

    if (this.result === "agent_reply_blocked") {
      const completedRun = this.repository.complete(
        input.run,
        withSendGateSpan(input.completionPlan.agentReplyBlocked, "blocked")
      );
      return { status: "blocked", reason: "agent_reply_blocked", completedRun };
    }

    const completedRun = this.repository.complete(
      input.run,
      withSendGateSpan(input.completionPlan.persistenceUnconfirmed, "failed")
    );
    return { status: "blocked", reason: "ai_persistence_unconfirmed", completedRun };
  }
}

function withSendGateSpan(
  completion: AiRunTerminalCompletion,
  status: "succeeded" | "blocked" | "failed"
): AiRunTerminalCompletion {
  return {
    ...completion,
    spans: [
      ...completion.spans,
      {
        spanId: `send-gate-${completion.completedAt.getTime()}`,
        kind: "send_gate",
        name: "send_gate_check",
        status,
        latencyMs: 1,
        ...(status === "blocked" ? { errorCode: "send_gate_blocked" as const } : {}),
        ...(status === "failed" ? { errorCode: "persistence_failed" as const } : {}),
        usedInFinalAnswer: status === "succeeded"
      }
    ]
  };
}

function buildService(repository: AiRunRepository) {
  let clockMs = Date.parse("2026-07-14T12:00:00.000Z");
  let id = 0;
  return new RecordedLegacyS05TurnService({
    repository,
    versions: VERSIONS,
    model: {
      modelProvider: "fake",
      requestedModelName: "p2-observability-fake",
      reasoningEffort: "none"
    },
    clock: () => {
      const value = new Date(clockMs);
      clockMs += 5;
      return value;
    },
    idGenerator: () =>
      `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`
  });
}

function buildFixture(text = "Расскажите про варианты") {
  const publicConversationId = "00000000-0000-4000-8000-000000000010";
  const publicInboundMessageId = "00000000-0000-4000-8000-000000000011";
  const requestFingerprint = "request-fingerprint-p2";
  const inputFingerprint = "input-fingerprint-p2";
  const turnInput = buildStageASiteWidgetAiTurnInput({
    publicConversationId,
    publicMessageId: publicInboundMessageId,
    requestFingerprint,
    submittedAt: "2026-07-14T12:00:00.000Z",
    text,
    page: { url: "https://granit.example/catalog", widgetInstanceId: "landing-main" },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: "ru-RU" },
    gate: { aiState: "ai_collecting_info", agentAllowedToReply: true }
  });
  turnInput.turn.inputFingerprint = inputFingerprint;

  return {
    executionContext: buildSiteWidgetAiTurnExecutionContext({
      leadId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      inboundMessageId: "00000000-0000-4000-8000-000000000003",
      publicConversationId,
      publicInboundMessageId,
      requestFingerprint,
      inputFingerprint
    }),
    turnInput
  };
}

function fakeWidgetGenerator(
  text: string,
  overrides: {
    modelName?: string;
    responseId?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  } = {}
) {
  const providerCall = vi.fn(async () => ({
    text,
    modelProvider: "fake" as const,
    modelName: overrides.modelName ?? "p2-provider-fake",
    responseId: overrides.responseId,
    usage: overrides.usage
  }));
  const provider: WidgetAiProvider = {
    providerKind: "fake",
    generateReply: providerCall
  };

  return {
    generator: new WidgetAiService({ provider, modelName: "p2-observability-fake" }),
    providerCall
  };
}

function noReplyWidgetGenerator(reason: AiUnavailableReason) {
  if (reason === "missing_openai_config") {
    return { generator: new WidgetAiService() };
  }

  if (reason === "model_error") {
    const provider: WidgetAiProvider = {
      providerKind: "fake",
      async generateReply() {
        throw new Error("RAW-PROVIDER-RESPONSE");
      }
    };
    return { generator: new WidgetAiService({ provider }) };
  }

  return fakeWidgetGenerator(
    reason === "empty_model_response" ? "" : "Стоимость составит 1000 руб.",
    {
      responseId: "RAW-PROVIDER-RESPONSE",
      usage: { inputTokens: 2_147_483_648 }
    }
  );
}

function beginInputFor(fixture: ReturnType<typeof buildFixture>): BeginAiRunInput {
  return {
    traceId: "00000000-0000-4000-8000-000000000030",
    leadId: fixture.executionContext.internal.leadId,
    conversationId: fixture.executionContext.internal.conversationId,
    inboundMessageId: fixture.executionContext.internal.inboundMessageId,
    channel: "site_widget",
    runtimeMode: "direct_openai",
    decisionProfile: "legacy_s05",
    idempotencyKey: fixture.executionContext.turn.idempotencyKey,
    inputFingerprint: fixture.executionContext.turn.inputFingerprint ?? "missing",
    versions: VERSIONS,
    model: {
      modelProvider: "fake",
      requestedModelName: "p2-observability-fake",
      reasoningEffort: "none"
    },
    startedAt: new Date("2026-07-14T12:00:00.000Z")
  };
}
