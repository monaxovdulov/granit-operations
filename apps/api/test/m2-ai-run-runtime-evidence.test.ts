import { describe, expect, it } from "vitest";

import {
  AiObservabilitySanitizationError,
  sanitizeAiRunCompletion
} from "../src/modules/ai/observability/ai-observability-sanitizer.js";
import type {
  AiRunTerminalCompletion,
  BeginAiRunInput,
  RunningAiRunRecord
} from "../src/modules/ai/repositories/ai-run-repository.js";
import {
  MemoryAiRunCompletionConflictError,
  MemoryAiRunRepository
} from "../src/modules/ai/repositories/memory-ai-run-repository.js";
const RAW_CANARY = "raw-customer@example.test sk-proj-1234567890";
const TEST_PRECOMPUTED_COST_RATE_VERSION = "unit_test_precomputed_cost.v1";

describe("M2 AI run runtime evidence", () => {
  it("round-trips trusted Mastra run and cost evidence without changing model truths", async () => {
    const repository = new MemoryAiRunRepository();
    const input = beginInput();
    const run = await start(repository, input);
    const completion = terminalCompletion(run);

    const terminal = await repository.completeWithoutReply({ run, completion });

    expect(terminal).toMatchObject({
      runtimeMode: "mastra_openai_api",
      decisionProfile: "live_v2",
      runtimeRunId: "mastra-openai-run-001",
      model: {
        modelProvider: "openai",
        requestedModelName: "gpt-5.6-sol",
        reasoningEffort: "medium"
      },
      observedModelProvider: "openai",
      observedModelName: "gpt-5.6-sol",
      costEstimateMicrounits: 150,
      costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION
    });

    await expect(repository.beginOrReplay(input)).resolves.toEqual({
      kind: "terminal_replay",
      run: terminal
    });
  });

  it("drops arbitrary raw metadata while preserving only allowlisted runtime evidence", () => {
    const completion = terminalCompletion(runningRecord());
    const sanitized = sanitizeAiRunCompletion({
      ...completion,
      raw_provider_payload: RAW_CANARY,
      provider_metadata: { response: RAW_CANARY },
      usage: { ...completion.usage, raw_response: RAW_CANARY }
    });

    expect(sanitized).toMatchObject({
      runtimeRunId: "mastra-openai-run-001",
      costEstimateMicrounits: 150,
      costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION
    });
    expect(JSON.stringify(sanitized)).not.toContain(RAW_CANARY);
  });

  it("rejects runtime linkage on a direct legacy run", async () => {
    const repository = new MemoryAiRunRepository();
    const run = await start(repository, directBeginInput());

    await expect(
      repository.completeWithoutReply({
        run,
        completion: terminalCompletion(run)
      })
    ).rejects.toBeInstanceOf(MemoryAiRunCompletionConflictError);
    expect(repository.listRuns()).toMatchObject([{ status: "running" }]);
  });

  it("rejects half-present cost evidence and out-of-range estimates", () => {
    const completion = terminalCompletion(runningRecord());

    for (const candidate of [
      { ...completion, costRateVersion: undefined },
      { ...completion, costEstimateMicrounits: undefined },
      { ...completion, costEstimateMicrounits: -1 },
      { ...completion, costEstimateMicrounits: 2_147_483_648 }
    ]) {
      expect(() => sanitizeAiRunCompletion(candidate)).toThrow(
        AiObservabilitySanitizationError
      );
    }
  });

  it("rejects unsafe or raw-shaped values in allowlisted runtime evidence fields", () => {
    const completion = terminalCompletion(runningRecord());

    for (const candidate of [
      { ...completion, runtimeRunId: RAW_CANARY },
      { ...completion, runtimeRunId: "r".repeat(201) },
      { ...completion, costRateVersion: "authorization.v1" },
      { ...completion, costRateVersion: "r".repeat(161) }
    ]) {
      expect(() => sanitizeAiRunCompletion(candidate)).toThrow(
        AiObservabilitySanitizationError
      );
    }
  });
});

function beginInput(): BeginAiRunInput {
  return {
    traceId: "00000000-0000-4000-8000-000000000201",
    leadId: "00000000-0000-4000-8000-000000000202",
    conversationId: "00000000-0000-4000-8000-000000000203",
    inboundMessageId: "00000000-0000-4000-8000-000000000204",
    channel: "site_widget",
    runtimeMode: "mastra_openai_api",
    decisionProfile: "live_v2",
    idempotencyKey: "ai-turn:00000000-0000-4000-8000-000000000204",
    inputFingerprint: "c".repeat(64),
    versions: {
      policyVersion: "m2_policy.v1",
      promptVersion: "m2_prompt.v1",
      toolVersion: "m2_tools.none.v1",
      disclosureVersion: "m2_disclosure.v1",
      modelProfileVersion: "m2_model_profile.v1",
      runtimeVersion: "mastra-core.v1.51.0"
    },
    model: {
      modelProvider: "openai",
      requestedModelName: "gpt-5.6-sol",
      reasoningEffort: "medium"
    },
    startedAt: new Date("2026-07-15T04:00:00.000Z")
  };
}

function directBeginInput(): BeginAiRunInput {
  return {
    ...beginInput(),
    runtimeMode: "direct_openai",
    decisionProfile: "legacy_s05",
    model: {
      modelProvider: "fake",
      requestedModelName: "legacy-local-fake",
      reasoningEffort: "none"
    }
  };
}

function runningRecord(): RunningAiRunRecord {
  return { ...beginInput(), id: "m2-run", status: "running" };
}

async function start(
  repository: MemoryAiRunRepository,
  input: BeginAiRunInput
): Promise<RunningAiRunRecord> {
  const result = await repository.beginOrReplay(input);
  if (result.kind !== "started") throw new Error("expected a new M2 AI run");
  return result.run;
}

function terminalCompletion(run: RunningAiRunRecord): AiRunTerminalCompletion {
  return {
    status: "failed",
    normalizedAction: "no_reply",
    outcomeReason: "generator_failed",
    failureCode: "runtime_failure",
    validatorResult: "failed",
    runtimeRunId: "mastra-openai-run-001",
    observedModelProvider: "openai",
    observedModelName: "gpt-5.6-sol",
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    costEstimateMicrounits: 150,
    costRateVersion: TEST_PRECOMPUTED_COST_RATE_VERSION,
    sendGateResult: "not_checked",
    completedAt: new Date(run.startedAt.getTime() + 10),
    latencyMs: 10,
    spans: [],
    qualityEvents: []
  };
}
