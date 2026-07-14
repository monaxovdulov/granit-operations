import { describe, expect, it, vi } from "vitest";

import {
  buildSiteWidgetAiTurnExecutionContext,
  buildStageASiteWidgetAiTurnInput
} from "../src/modules/ai/ai-turn.js";
import { executeLegacyS05Turn } from "../src/modules/ai/profiles/legacy-s05/legacy-s05-orchestrator.js";

describe("legacy_s05 app-owned orchestration", () => {
  it("generates, validates, maps and applies an answer with app-only execution identity", async () => {
    const fixture = buildFixture();
    const persistReply = vi.fn(async () => ({
      status: "persisted" as const,
      internalMessageId: "00000000-0000-4000-8000-000000000020",
      publicMessageId: "00000000-0000-4000-8000-000000000021",
      body: "Подскажу варианты. Какой стиль вам ближе?"
    }));

    const outcome = await executeLegacyS05Turn({
      ...fixture,
      generator: {
        async generateReply() {
          return {
            decision: "reply_candidate",
            text: "  Подскажу варианты. Какой стиль вам ближе?  ",
            metadata: {
              model_provider: "fake",
              model_name: "orchestrator-test"
            }
          };
        }
      },
      applier: { persistReply }
    });

    expect(persistReply).toHaveBeenCalledWith({
      executionContext: fixture.executionContext,
      action: "answer",
      replyDraft: "Подскажу варианты. Какой стиль вам ближе?",
      metadata: {
        model_provider: "fake",
        model_name: "orchestrator-test",
        decision_profile: "legacy_s05",
        normalized_action: "answer"
      }
    });
    expect(outcome).toMatchObject({
      decision: {
        decisionProfile: "legacy_s05",
        action: "answer"
      },
      result: {
        status: "persisted",
        publicMessageId: "00000000-0000-4000-8000-000000000021"
      },
      persistedReply: {
        internalMessageId: "00000000-0000-4000-8000-000000000020",
        publicMessageId: "00000000-0000-4000-8000-000000000021"
      }
    });
  });

  it("maps a stop-AI reply to a persisted handoff result", async () => {
    const fixture = buildFixture();
    const persistReply = vi.fn(async () => ({
      status: "persisted" as const,
      internalMessageId: "00000000-0000-4000-8000-000000000022",
      publicMessageId: "00000000-0000-4000-8000-000000000023",
      body: "Передам менеджеру."
    }));

    const outcome = await executeLegacyS05Turn({
      ...fixture,
      generator: {
        async generateReply() {
          return {
            decision: "reply_candidate",
            text: "Передам менеджеру.",
            agentAllowedToReplyAfterSend: false,
            metadata: { handoff_reason: "manager_requested" }
          };
        }
      },
      applier: { persistReply }
    });

    expect(persistReply).toHaveBeenCalledWith(
      expect.objectContaining({ action: "handoff_to_manager" })
    );
    expect(outcome.result).toMatchObject({
      status: "handed_off",
      reason: "legacy_s05_handoff_to_manager"
    });
    expect(outcome.persistedReply?.publicMessageId).toBe(
      "00000000-0000-4000-8000-000000000023"
    );
  });

  it("does not call the apply port for no_reply or an execution-context mismatch", async () => {
    const fixture = buildFixture();
    const persistReply = vi.fn();
    const noReplyGenerator = vi.fn(async () => ({
      decision: "no_reply",
      reason: "model_error",
      metadata: { error_type: "model_error" }
    }));

    const unavailable = await executeLegacyS05Turn({
      ...fixture,
      generator: { generateReply: noReplyGenerator },
      applier: { persistReply }
    });

    expect(unavailable.result).toMatchObject({
      status: "fallback_unavailable",
      reason: "model_error"
    });
    expect(persistReply).not.toHaveBeenCalled();

    const mismatched = await executeLegacyS05Turn({
      ...fixture,
      executionContext: {
        ...fixture.executionContext,
        public: {
          ...fixture.executionContext.public,
          inboundMessageId: "00000000-0000-4000-8000-000000000099"
        }
      },
      generator: { generateReply: noReplyGenerator },
      applier: { persistReply }
    });

    expect(mismatched.result).toMatchObject({
      status: "fallback_unavailable",
      reason: "unsafe_model_response"
    });
    expect(noReplyGenerator).toHaveBeenCalledTimes(1);
    expect(persistReply).not.toHaveBeenCalled();
  });
});

function buildFixture() {
  const publicConversationId = "00000000-0000-4000-8000-000000000010";
  const publicInboundMessageId = "00000000-0000-4000-8000-000000000011";
  const requestFingerprint = "request-fingerprint-orchestrator";

  return {
    executionContext: buildSiteWidgetAiTurnExecutionContext({
      leadId: "00000000-0000-4000-8000-000000000001",
      conversationId: "00000000-0000-4000-8000-000000000002",
      inboundMessageId: "00000000-0000-4000-8000-000000000003",
      publicConversationId,
      publicInboundMessageId,
      requestFingerprint
    }),
    turnInput: buildStageASiteWidgetAiTurnInput({
      publicConversationId,
      publicMessageId: publicInboundMessageId,
      requestFingerprint,
      submittedAt: "2026-07-14T12:00:00.000Z",
      text: "Расскажите про варианты",
      page: {
        url: "https://granit.example/catalog",
        widgetInstanceId: "landing-main"
      },
      customer: {
        phoneProvided: false,
        emailProvided: false
      },
      visitor: {
        locale: "ru-RU"
      },
      gate: {
        aiState: "ai_collecting_info",
        agentAllowedToReply: true
      }
    })
  };
}
