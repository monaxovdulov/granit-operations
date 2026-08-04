import { describe, expect, it } from "vitest";

import {
  isSuccessfulM3Smoke,
  m3SmokeExitCode,
  summarizeM3PublicResult,
  type M3SmokeEvidenceInput
} from "../src/scripts/m3-smoke-evidence.js";

describe("M3 sanitized smoke evidence", () => {
  it("accepts only a fresh, persisted, validated and fully linked widget reply", () => {
    expect(isSuccessfulM3Smoke(successEvidence())).toBe(true);
    expect(m3SmokeExitCode(true)).toBe(0);
  });

  it.each([
    ["replay", { publicFresh: false, publicReplayed: true }],
    ["fallback", { automationReplied: false, replyPresent: false }],
    ["failed run", { runStatus: "failed" }],
    ["handoff for ordinary input", { runStatus: "handed_off", decisionAction: "handoff_to_manager" }],
    ["invalid candidate", { validatorResult: "failed" }],
    ["blocked send gate", { sendGateResult: "blocked", outboundLinked: false }],
    ["runtime not linked", { runtimeLinked: false }],
    ["failed span", { failedSpanCount: 1 }],
    ["quality event", { qualityEventCount: 1 }],
    ["manager review", { managerReviewRequired: true }],
    ["wrong provider", { observedProvider: "fake" }]
  ])("rejects %s and requires a nonzero process result", (_label, override) => {
    const ok = isSuccessfulM3Smoke({ ...successEvidence(), ...override });

    expect(ok).toBe(false);
    expect(m3SmokeExitCode(ok)).toBe(1);
  });

  it("treats usage as optional provider evidence", () => {
    expect(isSuccessfulM3Smoke({ ...successEvidence(), usageLinked: false })).toBe(true);
  });

  it("counts a persisted reply only from inline automation or v2 history", () => {
    expect(
      summarizeM3PublicResult({
        ok: true,
        status: "accepted",
        automation: { status: "replied", reply: { text: "not returned by summary" } },
        persisted_reply: { text: "wrong legacy-looking root" }
      })
    ).toEqual({
      ok: true,
      fresh: true,
      replayed: false,
      automationReplied: true,
      replyPresent: true
    });

    expect(
      summarizeM3PublicResult({
        ok: true,
        status: "accepted",
        automation: { status: "replied" },
        persisted_reply: { text: "wrong root must not count" }
      }).replyPresent
    ).toBe(false);

    expect(
      summarizeM3PublicResult(
        {
          ok: true,
          status: "accepted",
          automation: { status: "processing", next_step: "poll_history" }
        },
        {
          messages: [
            { sender_role: "visitor", automation: { status: "replied" } },
            { sender_role: "ai_assistant", text: "Готовый ответ" }
          ]
        }
      )
    ).toEqual({
      ok: true,
      fresh: true,
      replayed: false,
      automationReplied: true,
      replyPresent: true
    });
  });
});

function successEvidence(): M3SmokeEvidenceInput {
  return {
    httpStatus: 202,
    publicOk: true,
    publicFresh: true,
    publicReplayed: false,
    automationReplied: true,
    replyPresent: true,
    runtimeMode: "mastra_openai_api",
    decisionProfile: "live_v2",
    runStatus: "persisted",
    decisionAction: "answer",
    outcomeReason: "reply_persisted",
    failureCode: null,
    validatorResult: "passed",
    sendGateResult: "allowed",
    outboundLinked: true,
    runtimeLinked: true,
    usageLinked: true,
    spanCount: 3,
    failedSpanCount: 0,
    qualityEventCount: 0,
    openManagerQualityEventCount: 0,
    managerReviewRequired: false,
    configuredProvider: "openai",
    configuredModel: "gpt-5.6-sol",
    observedProvider: "openai",
    observedModel: "gpt-5.6-sol"
  };
}
