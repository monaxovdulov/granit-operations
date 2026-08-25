import { sha256Hex } from "@granit/shared";
import { describe, expect, it } from "vitest";

import { MODEL_TURN_TERMINAL_VALIDATION_CODES } from "../src/modules/ai/profiles/live-v2/model-turn-contract.js";
import { validateFinalTurnResult } from "../src/modules/ai/profiles/live-v2/model-turn-validator.js";
import { buildLiveV2TestTurn, contextMessage } from "./fixtures/live-v2-synthetic.v1.js";

describe("granit_model_turn.v2 final validation", () => {
  it("composes one canonical answer, hashes it and leaves it immutable", () => {
    const result = validateFinalTurnResult({
      value: output({ message: "  Подберём спокойный вариант.  " }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        reason: "answer_ready",
        finalText: "Подберём спокойный вариант."
      }
    });
    if (!result.ok) throw new Error("expected valid output");
    expect(result.plan.finalTextHash).toBe(sha256Hex(result.plan.finalText));
    expect(Object.isFrozen(result.plan)).toBe(true);
  });

  it("composes the separate question exactly once and performs one structural suffix repair", () => {
    const result = validateFinalTurnResult({
      value: output({
        message: "Подберём вариант. Какой материал рассматриваете?",
        clarifyingQuestion: { text: "Какой материал рассматриваете?", target: "material" }
      }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "ask_clarifying_question",
        finalText: "Подберём вариант.\n\nКакой материал рассматриваете?",
        validationResults: ["duplicate_question"]
      }
    });
  });

  it("drops a known-slot question and does not infer claim safety from prose", () => {
    const repaired = validateFinalTurnResult({
      value: output({
        clarifyingQuestion: { text: "В каком городе нужна установка?", target: "city" }
      }),
      turnInput: buildLiveV2TestTurn({ city: "Москва" })
    });

    expect(repaired).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: "Подберём подходящий вариант.",
        validationResults: ["known_slot_requested", "action_repaired"]
      }
    });

    const unclassifiedProse = validateFinalTurnResult({
      value: output({ message: "Сделаем за три дня." }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(unclassifiedProse).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: "Сделаем за три дня.",
        validationResults: []
      }
    });
  });

  it("derives current-message slot and requirement updates from unique quote evidence", () => {
    const turnInput = buildLiveV2TestTurn({
      inbound: "Нужен чёрный гранит, без золотого оформления"
    });
    const result = validateFinalTurnResult({
      value: output({
        statePatches: [
          {
            operation: "set_slot",
            name: "material",
            value: "чёрный гранит",
            confidence: 0.95,
            evidence: { quote: "чёрный гранит" }
          },
          {
            operation: "upsert_requirement",
            category: "decoration",
            mode: "avoidance",
            value: "золотое оформление",
            confidence: 0.9,
            evidence: { quote: "без золотого оформления" }
          }
        ]
      }),
      turnInput
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        appliedPatches: [
          {
            name: "material",
            sourceMessageId: turnInput.inboundMessage.publicMessageId,
            evidence: { quote: "чёрный гранит", start: 6, end: 19 }
          },
          {
            category: "decoration",
            mode: "avoidance",
            sourceMessageId: turnInput.inboundMessage.publicMessageId
          }
        ],
        droppedPatches: []
      }
    });
  });

  it("drops ambiguous/duplicate patches and unavailable recommendations without changing text", () => {
    const turnInput = buildLiveV2TestTurn({ inbound: "гранит и снова гранит" });
    const patch = {
      operation: "set_slot" as const,
      name: "material" as const,
      value: "гранит",
      confidence: 0.8,
      evidence: { quote: "гранит" }
    };
    const result = validateFinalTurnResult({
      value: output({
        statePatches: [patch, patch],
        recommendationIds: ["ent_9999999999999999"]
      }),
      turnInput
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        finalText: "Подберём подходящий вариант.",
        appliedPatches: [],
        droppedPatches: [
          { reason: "invalid_patch_evidence" },
          { reason: "duplicate_patch" }
        ],
        recommendationIds: [],
        droppedRecommendationIds: ["ent_9999999999999999"],
        validationResults: [
          "invalid_patch_evidence",
          "duplicate_patch",
          "unsupported_recommendation",
          "action_repaired"
        ]
      }
    });
  });

  it("drops a patch whose value is not supported by its quote", () => {
    const result = validateFinalTurnResult({
      value: output({
        statePatches: [
          {
            operation: "set_slot",
            name: "material",
            value: "белый мрамор",
            confidence: 0.99,
            evidence: { quote: "чёрный гранит" }
          }
        ]
      }),
      turnInput: buildLiveV2TestTurn({ inbound: "Нужен чёрный гранит" })
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        appliedPatches: [],
        droppedPatches: [{ reason: "invalid_patch_evidence" }]
      }
    });
  });

  it("keeps a same-turn patch while dropping its redundant question", () => {
    const result = validateFinalTurnResult({
      value: output({
        clarifyingQuestion: { text: "Какой материал рассматриваете?", target: "material" },
        statePatches: [
          {
            operation: "set_slot",
            name: "material",
            value: "чёрный гранит",
            confidence: 0.95,
            evidence: { quote: "чёрный гранит" }
          }
        ]
      }),
      turnInput: buildLiveV2TestTurn({ inbound: "Нужен чёрный гранит" })
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: "Подберём подходящий вариант.",
        appliedPatches: [{ name: "material", value: "чёрный гранит" }],
        validationResults: ["known_slot_requested", "action_repaired"]
      }
    });
  });

  it("derives the bounded manager handoff action and forbids a simultaneous question", () => {
    const result = validateFinalTurnResult({
      value: output({ handoffReason: "customer_wants_final_quote" }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "handoff_to_manager",
        handoffAction: {
          reason: "final_quote_pressure",
          sourceReason: "customer_wants_final_quote"
        },
        riskAssessment: {
          flags: ["exact_price_requested", "final_quote_pressure"],
          requiresSemanticVerifier: false
        }
      }
    });

    expect(
      validateFinalTurnResult({
        value: output({
          handoffReason: "customer_requested_manager",
          clarifyingQuestion: { text: "Какой материал рассматриваете?", target: "material" }
        }),
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "invalid_question" });
  });

  it("does not block repeated prose but keeps questions out of message", () => {
    const previous = contextMessage({
      id: 91,
      role: "assistant",
      text: "Подберём подходящий вариант."
    });
    const repeated = validateFinalTurnResult({
      value: output(),
      turnInput: buildLiveV2TestTurn({ previousMessagesNewestFirst: [previous] })
    });
    const weakTone = validateFinalTurnResult({
      value: output({
        message: "Искренне сочувствую. Оставьте ваш телефон. Что покажем?"
      }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(repeated).toMatchObject({
      ok: true,
      plan: { finalText: "Подберём подходящий вариант.", validationResults: [] }
    });
    expect(weakTone).toEqual({ ok: false, code: "invalid_question" });
  });

  it("allows at most one question in clarifyingQuestion text", () => {
    expect(
      validateFinalTurnResult({
        value: output({
          clarifyingQuestion: {
            text: "Какой материал? Какой размер？",
            target: "material"
          }
        }),
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "invalid_question" });
  });

  it("keeps the current hard allowlist structural", () => {
    expect(MODEL_TURN_TERMINAL_VALIDATION_CODES).toEqual([
      "invalid_shape",
      "invalid_answer",
      "invalid_question",
      "invalid_action"
    ]);

    expect(
      validateFinalTurnResult({
        value: { version: "wrong" },
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "invalid_shape" });

    expect(
      validateFinalTurnResult({
        value: output({
          message: "В каком городе нужна установка?",
          clarifyingQuestion: { text: "В каком городе нужна установка?", target: "city" }
        }),
        turnInput: buildLiveV2TestTurn({ city: "Москва" })
      })
    ).toEqual({ ok: false, code: "invalid_answer" });
  });

  it("drops only an optional question when canonical text would exceed the limit", () => {
    const message = "а".repeat(890);
    const result = validateFinalTurnResult({
      value: output({
        message,
        clarifyingQuestion: { text: "Какой материал рассматриваете?", target: "material" }
      }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: message,
        validationResults: ["question_dropped_for_length", "action_repaired"]
      }
    });
  });
});

function output(input: {
  message?: string;
  clarifyingQuestion?: { text: string; target: "material" | "city" } | null;
  statePatches?: unknown[];
  recommendationIds?: string[];
  handoffReason?:
    | "customer_requested_manager"
    | "customer_wants_final_quote"
    | "customer_ready_to_order";
} = {}) {
  const clarifyingQuestion = input.clarifyingQuestion ?? null;
  const recommendationIds = input.recommendationIds ?? [];
  const action = recommendationIds.length > 0
    ? clarifyingQuestion
      ? "recommend_and_clarify"
      : "recommend"
    : clarifyingQuestion
      ? "clarify"
      : "answer";
  return {
    version: "granit_model_turn.v2",
    action,
    message: input.message ?? "Подберём подходящий вариант.",
    clarifyingQuestion,
    statePatches: input.statePatches ?? [],
    recommendationIds,
    handoffIntent: input.handoffReason ? { reason: input.handoffReason } : null
  };
}
