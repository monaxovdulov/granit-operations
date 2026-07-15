import { describe, expect, it } from "vitest";

import {
  AiObservabilitySanitizationError,
  sanitizeAiRunCompletion,
  sanitizeAiRunEvidenceForExport,
  sanitizeAiRunStart
} from "../src/modules/ai/observability/ai-observability-sanitizer.js";
import { MemoryAiRunRepository } from "../src/modules/ai/repositories/memory-ai-run-repository.js";
import type {
  AiRunTerminalCompletion,
  BeginAiRunInput,
  RunningAiRunRecord
} from "../src/modules/ai/repositories/ai-run-repository.js";

const RAW_CANARY = "raw-customer@example.test sk-proj-1234567890";

describe("P3 centralized AI observability sanitizer", () => {
  it("drops unknown raw fields and preserves configured and observed provider truth", () => {
    const start = {
      ...beginInput(),
      raw_prompt: RAW_CANARY,
      versions: { ...beginInput().versions, raw_asset_body: RAW_CANARY },
      model: { ...beginInput().model, provider_payload: RAW_CANARY }
    };
    const completion = {
      ...terminalCompletion(),
      raw_error: RAW_CANARY,
      usage: { inputTokens: 10, raw_response: RAW_CANARY },
      spans: [{ ...terminalCompletion().spans[0], raw_input: RAW_CANARY }],
      qualityEvents: [
        { ...terminalCompletion().qualityEvents[0], customer_message: RAW_CANARY }
      ]
    };

    const sanitized = sanitizeAiRunEvidenceForExport({
      start,
      completion,
      unrestricted_metadata: RAW_CANARY
    });

    expect(sanitized.start.model).toEqual({
      modelProvider: "fake",
      requestedModelName: "p3-configured-fake",
      reasoningEffort: "none"
    });
    expect(sanitized.completion).toMatchObject({
      observedModelProvider: "fake",
      observedModelName: "p3-observed-fake",
      usage: { inputTokens: 10 }
    });
    expect(JSON.stringify(sanitized)).not.toContain(RAW_CANARY);
    expect(sanitized.start.startedAt).not.toBe(start.startedAt);
    expect(sanitized.completion?.completedAt).not.toBe(completion.completedAt);
  });

  it("fails closed when a secret is placed in an allowlisted version or model field", () => {
    expect(() =>
      sanitizeAiRunStart({
        ...beginInput(),
        versions: {
          ...beginInput().versions,
          policyVersion: "sk-proj-1234567890.v1"
        }
      })
    ).toThrow(AiObservabilitySanitizationError);
    expect(() =>
      sanitizeAiRunCompletion({
        ...terminalCompletion(),
        observedModelName: "sk-proj-1234567890"
      })
    ).toThrow(AiObservabilitySanitizationError);
  });

  it("fails closed on secret or PII-shaped run and span identifiers", () => {
    for (const idempotencyKey of [
      "sk-proj-1234567890",
      "ai-turn:raw-customer@example.test"
    ]) {
      expect(() => sanitizeAiRunStart({ ...beginInput(), idempotencyKey })).toThrow(
        AiObservabilitySanitizationError
      );
    }

    for (const span of [
      { spanId: "sk-proj-1234567890" },
      { spanId: "raw-customer@example.test" },
      { spanId: "p3-span-1", parentSpanId: "+15551234567" }
    ]) {
      expect(() =>
        sanitizeAiRunCompletion({
          ...terminalCompletion(),
          spans: [{ ...terminalCompletion().spans[0], ...span }]
        })
      ).toThrow(AiObservabilitySanitizationError);
    }
  });

  it("applies the same projection before the memory repository stores evidence", async () => {
    const repository = new MemoryAiRunRepository();
    const pollutedStart = { ...beginInput(), raw_prompt: RAW_CANARY } as BeginAiRunInput;
    const started = await repository.beginOrReplay(pollutedStart);
    if (started.kind !== "started") throw new Error("expected started run");

    const pollutedCompletion = {
      ...terminalCompletion(started.run),
      raw_provider_payload: RAW_CANARY
    } as AiRunTerminalCompletion;
    await repository.completeWithoutReply({
      run: started.run,
      completion: pollutedCompletion
    });

    expect(JSON.stringify(repository.listRuns())).not.toContain(RAW_CANARY);
  });
});

function beginInput(): BeginAiRunInput {
  return {
    traceId: "00000000-0000-4000-8000-000000000101",
    leadId: "00000000-0000-4000-8000-000000000102",
    conversationId: "00000000-0000-4000-8000-000000000103",
    inboundMessageId: "00000000-0000-4000-8000-000000000104",
    channel: "site_widget",
    runtimeMode: "direct_openai",
    decisionProfile: "legacy_s05",
    idempotencyKey: "ai-turn:00000000-0000-4000-8000-000000000104",
    inputFingerprint: "b".repeat(64),
    versions: {
      policyVersion: "p3_policy.v1",
      promptVersion: "p3_prompt.v1",
      toolVersion: "p3_tools.none.v1",
      assetVersion: "p3_assets.v1",
      disclosureVersion: "p3_disclosure.v1",
      modelProfileVersion: "p3_model_profile.v1",
      runtimeVersion: "node.v22.17.0"
    },
    model: {
      modelProvider: "fake",
      requestedModelName: "p3-configured-fake",
      reasoningEffort: "none"
    },
    startedAt: new Date("2026-07-15T00:00:00.000Z")
  };
}

function terminalCompletion(
  run: RunningAiRunRecord = { ...beginInput(), id: "run-p3", status: "running" }
): AiRunTerminalCompletion {
  return {
    status: "fallback_unavailable",
    normalizedAction: "no_reply",
    outcomeReason: "model_error",
    failureCode: "model_failure",
    validatorResult: "not_run",
    observedModelProvider: "fake",
    observedModelName: "p3-observed-fake",
    usage: { inputTokens: 10 },
    sendGateResult: "not_checked",
    completedAt: new Date(run.startedAt.getTime() + 10),
    latencyMs: 10,
    spans: [
      {
        spanId: "p3-span-1",
        kind: "model",
        name: "model_generation",
        status: "failed",
        latencyMs: 10,
        errorCode: "model_error"
      }
    ],
    qualityEvents: [
      {
        eventType: "model_failure",
        reasonCode: "model_error",
        severity: "critical",
        managerVisible: true
      }
    ]
  };
}
