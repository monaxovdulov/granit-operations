import { describe, expect, it } from "vitest";

import {
  LEGACY_S05_DECISION_PROFILE,
  mapLegacyS05Decision
} from "../src/modules/ai/profiles/legacy-s05/legacy-s05-decision.js";

describe("legacy_s05 structural decision mapping", () => {
  const answerMetadata = { model_provider: "fake", model_name: "compatibility-test" };
  const answerEvidence = {
    businessFacts: [{ kind: "business_fact" as const, approvedSourceId: "fact-1" }]
  };
  const handoffMetadata = {
    model_provider: "policy",
    handoff_reason: "manager_requested"
  };
  const unavailableMetadata = {
    model_provider: "openai",
    error_type: "model_error"
  };

  it.each([
    {
      name: "reply with shouldStopAi=false even when text mentions a manager",
      candidate: {
        decision: "reply_candidate" as const,
        text: "Менеджер позже уточнит детали?",
        metadata: answerMetadata,
        evidence: answerEvidence
      },
      expected: {
        decisionProfile: LEGACY_S05_DECISION_PROFILE,
        action: "answer",
        replyDraft: "Менеджер позже уточнит детали?",
        reason: null,
        metadata: {
          ...answerMetadata,
          decision_profile: LEGACY_S05_DECISION_PROFILE
        },
        evidence: answerEvidence
      }
    },
    {
      name: "reply with shouldStopAi=true",
      candidate: {
        decision: "reply_candidate" as const,
        text: "Передаю диалог менеджеру.",
        agentAllowedToReplyAfterSend: false,
        metadata: handoffMetadata
      },
      expected: {
        decisionProfile: LEGACY_S05_DECISION_PROFILE,
        action: "handoff_to_manager",
        replyDraft: "Передаю диалог менеджеру.",
        reason: null,
        metadata: {
          ...handoffMetadata,
          decision_profile: LEGACY_S05_DECISION_PROFILE
        }
      }
    },
    {
      name: "no_reply",
      candidate: {
        decision: "no_reply" as const,
        reason: "model_error" as const,
        metadata: unavailableMetadata
      },
      expected: {
        decisionProfile: LEGACY_S05_DECISION_PROFILE,
        action: "no_reply",
        replyDraft: null,
        reason: "model_error",
        metadata: {
          ...unavailableMetadata,
          decision_profile: LEGACY_S05_DECISION_PROFILE
        }
      }
    }
  ])("maps $name structurally", ({ candidate, expected }) => {
    expect(mapLegacyS05Decision(candidate)).toEqual(expected);
  });
});
