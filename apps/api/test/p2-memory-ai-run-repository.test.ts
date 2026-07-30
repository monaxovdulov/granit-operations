import { describe, expect, it } from "vitest";

import type {
  AiQualityEventWrite,
  AiRunSpanWrite,
  AiRunTerminalCompletion,
  BeginAiRunInput,
  RunningAiRunRecord
} from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  MemoryAiRunCompletionConflictError,
  MemoryAiRunInputInvariantError,
  MemoryAiRunReplayConflictError,
  MemoryAiRunRepository
} from "../src/modules/ai/repositories/memory-ai-run-repository.js";

const STARTED_AT = new Date("2026-07-14T12:00:00.000Z");
const OUTBOUND_MESSAGE_ID = "00000000-0000-4000-8000-000000000005";

describe("P2 memory AI run repository invariants", () => {
  it("accepts only the two approved runtime/profile pairs", async () => {
    for (const pair of [
      { runtimeMode: "direct_openai", decisionProfile: "legacy_s05" },
      { runtimeMode: "mastra_openai_api", decisionProfile: "live_v2" }
    ] as const) {
      const repository = new MemoryAiRunRepository();
      await expect(repository.beginOrReplay(beginInput(pair))).resolves.toMatchObject({
        kind: "started",
        run: pair
      });
    }

    for (const pair of [
      { runtimeMode: "direct_openai", decisionProfile: "live_v2" },
      { runtimeMode: "mastra_openai_api", decisionProfile: "legacy_s05" }
    ] as const) {
      const repository = new MemoryAiRunRepository();
      await expect(repository.beginOrReplay(beginInput(pair))).rejects.toBeInstanceOf(
        MemoryAiRunInputInvariantError
      );
      expect(repository.runCount).toBe(0);
    }

    for (const input of [
      beginInput({
        model: {
          modelProvider: "policy" as BeginAiRunInput["model"]["modelProvider"],
          requestedModelName: "deterministic",
          reasoningEffort: "none"
        }
      }),
      beginInput({
        model: {
          modelProvider: "fake",
          requestedModelName: "unsafe model name",
          reasoningEffort: "none"
        }
      })
    ]) {
      const repository = new MemoryAiRunRepository();
      await expect(repository.beginOrReplay(input)).rejects.toBeInstanceOf(
        MemoryAiRunInputInvariantError
      );
      expect(repository.runCount).toBe(0);
    }
  });

  it("replays only the same accepted linkage and input fingerprint", async () => {
    const repository = new MemoryAiRunRepository();
    const accepted = beginInput();
    const run = await start(repository, accepted);
    const replay = await repository.beginOrReplay({
      ...accepted,
      traceId: "00000000-0000-4000-8000-000000000099",
      startedAt: new Date("2026-07-14T12:01:00.000Z")
    });

    expect(replay).toMatchObject({ kind: "running_replay", run: { traceId: run.traceId } });

    const mismatches: BeginAiRunInput[] = [
      { ...accepted, leadId: "00000000-0000-4000-8000-000000000091" },
      { ...accepted, conversationId: "00000000-0000-4000-8000-000000000092" },
      { ...accepted, inboundMessageId: "00000000-0000-4000-8000-000000000093" },
      { ...accepted, channel: "telegram" as BeginAiRunInput["channel"] },
      {
        ...accepted,
        runtimeMode: "mastra_openai_api",
        decisionProfile: "live_v2"
      },
      { ...accepted, inputFingerprint: "b".repeat(64) }
    ];

    for (const mismatch of mismatches) {
      await expect(repository.beginOrReplay(mismatch)).rejects.toBeInstanceOf(
        MemoryAiRunReplayConflictError
      );
    }
    expect(repository.runCount).toBe(1);
  });

  it("stores a valid no-reply terminal and returns it on replay", async () => {
    const repository = new MemoryAiRunRepository();
    const input = beginInput();
    const run = await start(repository, input);
    const terminal = await repository.completeWithoutReply({
      run,
      completion: noReplyCompletion(run)
    });

    expect(terminal).toMatchObject({
      status: "fallback_unavailable",
      normalizedAction: "no_reply",
      failureCode: "provider_unavailable",
      sendGateResult: "not_checked",
      model: {
        modelProvider: "fake",
        requestedModelName: "p2-memory-fake",
        reasoningEffort: "none"
      },
      observedModelProvider: "none"
    });
    await expect(repository.beginOrReplay(input)).resolves.toMatchObject({
      kind: "terminal_replay",
      run: { id: run.id, status: "fallback_unavailable" }
    });
  });

  it("requires outbound linkage only for reply-bearing terminal statuses", async () => {
    const repository = new MemoryAiRunRepository();
    const run = await start(repository);
    const reply = replyCompletion(run);

    await expect(
      repository.completeWithoutReply({ run, completion: reply })
    ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);
    expect(() => repository.completeWithReply(run, reply)).toThrow(
      MemoryAiRunCompletionConflictError
    );

    const terminal = repository.completeWithReply(run, reply, OUTBOUND_MESSAGE_ID);
    expect(terminal).toMatchObject({
      status: "persisted",
      normalizedAction: "answer",
      outboundMessageId: OUTBOUND_MESSAGE_ID,
      sendGateResult: "allowed"
    });

    const noReplyRepository = new MemoryAiRunRepository();
    const noReplyRun = await start(noReplyRepository);
    expect(() =>
      noReplyRepository.completeWithReply(
        noReplyRun,
        noReplyCompletion(noReplyRun),
        OUTBOUND_MESSAGE_ID
      )
    ).toThrow(MemoryAiRunCompletionConflictError);
  });

  it("enforces terminal evidence, action, gate and timing shape", async () => {
    const attempts: Array<(run: RunningAiRunRecord) => AiRunTerminalCompletion> = [
      (run) => ({ ...replyCompletion(run), normalizedAction: "no_reply" }),
      (run) => ({ ...noReplyCompletion(run), normalizedAction: "answer" }),
      (run) => {
        const { failureCode: _failureCode, ...withoutFailure } = noReplyCompletion(run);
        return withoutFailure;
      },
      (run) => ({ ...replyCompletion(run), failureCode: "runtime_failure" }),
      (run) => ({
        ...noReplyCompletion(run),
        status: "blocked",
        normalizedAction: "answer",
        outcomeReason: "agent_reply_blocked",
        failureCode: "send_gate_blocked",
        sendGateResult: "blocked"
      }),
      (run) => ({ ...noReplyCompletion(run), sendGateCheckedAt: completedAt(run) }),
      (run) => ({
        ...noReplyCompletion(run),
        completedAt: new Date(run.startedAt.getTime() - 1)
      })
    ];

    for (const completionFor of attempts) {
      const repository = new MemoryAiRunRepository();
      const run = await start(repository);
      const completion = completionFor(run);
      const outbound =
        completion.status === "persisted" || completion.status === "handed_off"
          ? OUTBOUND_MESSAGE_ID
          : undefined;

      expect(() => repository.completeWithReply(run, completion, outbound)).toThrow(
        MemoryAiRunCompletionConflictError
      );
      expect(repository.listRuns()).toMatchObject([{ status: "running" }]);
    }
  });

  it("rejects unsafe observed model names, counts and latencies", async () => {
    const attempts: Array<(run: RunningAiRunRecord) => AiRunTerminalCompletion> = [
      (run) => ({
        ...noReplyCompletion(run),
        observedModelProvider: "fake",
        observedModelName: "provider model with spaces"
      }),
      (run) => ({ ...noReplyCompletion(run), observedModelProvider: "fake" }),
      (run) => ({ ...noReplyCompletion(run), observedModelName: "p2-memory-fake" }),
      (run) => ({ ...noReplyCompletion(run), usage: { inputTokens: -1 } }),
      (run) => ({ ...noReplyCompletion(run), usage: { totalTokens: 1.5 } }),
      (run) => ({ ...noReplyCompletion(run), usage: { outputTokens: 2_147_483_648 } }),
      (run) => ({ ...noReplyCompletion(run), latencyMs: -1 })
    ];

    for (const completionFor of attempts) {
      const repository = new MemoryAiRunRepository();
      const run = await start(repository);
      await expect(
        repository.completeWithoutReply({ run, completion: completionFor(run) })
      ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);
    }
  });

  it("rejects running, duplicate or unsafe terminal spans", async () => {
    const baseSpan: AiRunSpanWrite = {
      spanId: "span-1",
      kind: "model",
      name: "model_generation",
      status: "skipped",
      latencyMs: 0,
      errorCode: "provider_unavailable"
    };
    const spanSets: AiRunSpanWrite[][] = [
      [baseSpan, { ...baseSpan }],
      [{ ...baseSpan, status: "running" }],
      [{ ...baseSpan, spanId: "unsafe span" }],
      [{ ...baseSpan, latencyMs: -1 }]
    ];

    for (const spans of spanSets) {
      const repository = new MemoryAiRunRepository();
      const run = await start(repository);
      await expect(
        repository.completeWithoutReply({
          run,
          completion: { ...noReplyCompletion(run), spans }
        })
      ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);
    }
  });

  it("rejects uncontrolled events, forged linkage and repeated prepared commits", async () => {
    const eventRepository = new MemoryAiRunRepository();
    const eventRun = await start(eventRepository);
    const uncontrolledEvents = [
      {
        eventType: "degradation",
        reasonCode: "missing_openai_config",
        severity: "warning",
        managerVisible: false
      }
    ] as unknown as AiQualityEventWrite[];

    await expect(
      eventRepository.completeWithoutReply({
        run: eventRun,
        completion: { ...noReplyCompletion(eventRun), qualityEvents: uncontrolledEvents }
      })
    ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);

    const linkageRepository = new MemoryAiRunRepository();
    const linkageRun = await start(linkageRepository);
    await expect(
      linkageRepository.completeWithoutReply({
        run: { ...linkageRun, inputFingerprint: "f".repeat(64) },
        completion: noReplyCompletion(linkageRun)
      })
    ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);

    const commit = linkageRepository.prepareCompletion(
      linkageRun,
      noReplyCompletion(linkageRun)
    );
    expect(commit()).toMatchObject({ status: "fallback_unavailable" });
    expect(commit).toThrow(MemoryAiRunCompletionConflictError);
  });
});

function beginInput(overrides: Partial<BeginAiRunInput> = {}): BeginAiRunInput {
  return {
    traceId: "00000000-0000-4000-8000-000000000001",
    leadId: "00000000-0000-4000-8000-000000000002",
    conversationId: "00000000-0000-4000-8000-000000000003",
    inboundMessageId: "00000000-0000-4000-8000-000000000004",
    channel: "site_widget",
    runtimeMode: "direct_openai",
    decisionProfile: "legacy_s05",
    idempotencyKey: "ai-turn:00000000-0000-4000-8000-000000000004",
    inputFingerprint: "a".repeat(64),
    versions: {
      policyVersion: "widget-ai-policy.v1",
      promptVersion: "widget-ai-prompt.v1",
      toolVersion: "none.v1",
      disclosureVersion: "widget-ai-disclosure.v1",
      modelProfileVersion: "direct-openai.v1"
    },
    model: {
      modelProvider: "fake",
      requestedModelName: "p2-memory-fake",
      reasoningEffort: "none"
    },
    startedAt: new Date(STARTED_AT),
    ...overrides
  };
}

async function start(
  repository: MemoryAiRunRepository,
  input: BeginAiRunInput = beginInput()
): Promise<RunningAiRunRecord> {
  const result = await repository.beginOrReplay(input);
  if (result.kind !== "started") {
    throw new Error("expected a newly started memory AI run");
  }
  return result.run;
}

function noReplyCompletion(run: RunningAiRunRecord): AiRunTerminalCompletion {
  return {
    status: "fallback_unavailable",
    normalizedAction: "no_reply",
    outcomeReason: "missing_provider_config",
    failureCode: "provider_unavailable",
    validatorResult: "not_run",
    observedModelProvider: "none",
    sendGateResult: "not_checked",
    completedAt: completedAt(run),
    latencyMs: 10,
    spans: [
      {
        spanId: "span-1",
        kind: "model",
        name: "model_generation",
        status: "skipped",
        latencyMs: 0,
        errorCode: "provider_unavailable"
      }
    ],
    qualityEvents: [
      {
        eventType: "degradation",
        reasonCode: "missing_openai_config",
        severity: "warning",
        managerVisible: true
      }
    ]
  };
}

function replyCompletion(run: RunningAiRunRecord): AiRunTerminalCompletion {
  const completionTime = completedAt(run);
  return {
    status: "persisted",
    normalizedAction: "answer",
    outcomeReason: "reply_persisted",
    validatorResult: "passed",
    observedModelProvider: "fake",
    observedModelName: "p2-memory-provider-observed",
    usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 },
    sendGateResult: "allowed",
    sendGateCheckedAt: completionTime,
    completedAt: completionTime,
    latencyMs: 10,
    spans: [
      {
        spanId: "span-1",
        kind: "model",
        name: "model_generation",
        status: "succeeded",
        latencyMs: 5,
        usedInFinalAnswer: true
      }
    ],
    qualityEvents: []
  };
}

function completedAt(run: RunningAiRunRecord): Date {
  return new Date(run.startedAt.getTime() + 10);
}
