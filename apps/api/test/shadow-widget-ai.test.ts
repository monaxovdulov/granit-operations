import { describe, expect, it } from "vitest";

import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import {
  ShadowWidgetAiReplyGenerator,
  type WidgetAiShadowObservation
} from "../src/modules/ai/services/shadow-widget-ai-reply-generator.js";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("shadow widget AI", () => {
  it("returns legacy immediately and records the full grounded comparison later", async () => {
    const grounded = deferred<unknown>();
    const recorded = deferred<void>();
    const observations: WidgetAiShadowObservation[] = [];
    const generator = new ShadowWidgetAiReplyGenerator(
      {
        async generateReply() {
          return {
            decision: "reply_candidate",
            text: "Legacy ответ",
            action: "answer",
            intent: "general_question",
            requestedSlots: [],
            metadata: { model_name: "legacy-model", latency_ms: 12 }
          };
        }
      },
      {
        generateReply() {
          return grounded.promise;
        }
      },
      {
        async record(observation) {
          observations.push(observation);
          recorded.resolve();
        }
      }
    );

    const result = await generator.generateReply(turn());

    expect(result).toMatchObject({ text: "Legacy ответ" });
    expect(observations).toEqual([]);

    grounded.resolve({
      decision: "reply_candidate",
      text: "Более полезный grounded ответ",
      action: "clarify",
      intent: "product_selection",
      requestedSlots: ["size"],
      slotUpdates: [
        {
          name: "material",
          value: "чёрный гранит",
          confidence: 0.98,
          source: "ai_extraction",
          sourceMessageId: MESSAGE_ID,
          evidence: {
            messageId: MESSAGE_ID,
            quote: "чёрный гранит",
            start: 6,
            end: 20
          }
        }
      ],
      metadata: {
        model_name: "grounded-model",
        verifier_model_name: "verifier-model",
        verifier_verdict: "pass",
        verifier_violations: [],
        grounding_verified: true,
        claim_coverage_complete: true,
        latency_ms: 45
      }
    });
    await recorded.promise;

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      publicConversationId: CONVERSATION_ID,
      inboundPublicMessageId: MESSAGE_ID,
      legacyResult: {
        reply_text: "Legacy ответ",
        model_name: "legacy-model"
      },
      groundedResult: {
        reply_text: "Более полезный grounded ответ",
        requested_slots: ["size"],
        grounding_verified: true,
        claim_coverage_complete: true,
        slot_updates: [{ name: "material", value: "чёрный гранит" }]
      }
    });
  });

  it("keeps a grounded failure out of the visitor latency path", async () => {
    const recorded = deferred<void>();
    let observation: WidgetAiShadowObservation | undefined;
    const generator = new ShadowWidgetAiReplyGenerator(
      {
        async generateReply() {
          return {
            decision: "reply_candidate",
            text: "Legacy ответ",
            metadata: {}
          };
        }
      },
      {
        async generateReply() {
          throw new TypeError("grounded failed");
        }
      },
      {
        async record(value) {
          observation = value;
          recorded.resolve();
        }
      }
    );

    await expect(generator.generateReply(turn())).resolves.toMatchObject({
      text: "Legacy ответ"
    });
    await recorded.promise;
    expect(observation).toMatchObject({
      groundedErrorCode: "TypeError",
      groundedResult: undefined
    });
  });
});

function turn() {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: CONVERSATION_ID,
    publicMessageId: MESSAGE_ID,
    requestFingerprint: "a".repeat(64),
    submittedAt: "2026-07-17T10:00:00.000Z",
    text: "Нужен чёрный гранит",
    page: { url: "https://example.test/", widgetInstanceId: "main" },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: {},
    gate: { aiState: "ai_collecting_info", agentAllowedToReply: true }
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}
