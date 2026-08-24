import { sha256Hex } from "@granit/shared";
import { describe, expect, it } from "vitest";

import { MODEL_TURN_TERMINAL_VALIDATION_CODES } from "../src/modules/ai/profiles/live-v2/model-turn-contract.js";
import { validateModelTurnOutput } from "../src/modules/ai/profiles/live-v2/model-turn-validator.js";
import { buildLiveV2TestTurn, contextMessage } from "./fixtures/live-v2-synthetic.v1.js";

describe("CONV-2 granit_model_turn.v1 validation", () => {
  it("composes one canonical answer, hashes it and leaves it immutable", () => {
    const result = validateModelTurnOutput({
      value: output({ answerText: "  Подберём спокойный вариант.  " }),
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
    const result = validateModelTurnOutput({
      value: output({
        answerText: "Подберём вариант. Какой материал рассматриваете?",
        question: { text: "Какой материал рассматриваете?", target: "material" }
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
    const repaired = validateModelTurnOutput({
      value: output({
        question: { text: "В каком городе нужна установка?", target: "city" }
      }),
      turnInput: buildLiveV2TestTurn({ city: "Москва" })
    });

    expect(repaired).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: "Подберём подходящий вариант.",
        validationResults: ["known_slot_requested"]
      }
    });

    const unclassifiedProse = validateModelTurnOutput({
      value: output({ answerText: "Сделаем за три дня." }),
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
    const result = validateModelTurnOutput({
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
    const result = validateModelTurnOutput({
      value: output({
        statePatches: [patch, patch],
        recommendationIds: ["catalog.item.1"]
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
        droppedRecommendationIds: ["catalog.item.1"],
        validationResults: [
          "invalid_patch_evidence",
          "duplicate_patch",
          "unsupported_recommendation"
        ]
      }
    });
  });

  it("drops a patch whose value is not supported by its quote", () => {
    const result = validateModelTurnOutput({
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
    const result = validateModelTurnOutput({
      value: output({
        question: { text: "Какой материал рассматриваете?", target: "material" },
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
        validationResults: ["known_slot_requested"]
      }
    });
  });

  it("derives the bounded manager handoff action and forbids a simultaneous question", () => {
    const result = validateModelTurnOutput({
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
      validateModelTurnOutput({
        value: output({
          handoffReason: "customer_requested_manager",
          question: { text: "Какой материал рассматриваете?", target: "material" }
        }),
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "invalid_question" });
  });

  it("does not block repeated or stylistically weak prose in the live validator", () => {
    const previous = contextMessage({
      id: 91,
      role: "assistant",
      text: "Подберём подходящий вариант."
    });
    const repeated = validateModelTurnOutput({
      value: output(),
      turnInput: buildLiveV2TestTurn({ previousMessagesNewestFirst: [previous] })
    });
    const weakTone = validateModelTurnOutput({
      value: output({
        answerText: "Искренне сочувствую. Оставьте ваш телефон. Что покажем?"
      }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(repeated).toMatchObject({
      ok: true,
      plan: { finalText: "Подберём подходящий вариант.", validationResults: [] }
    });
    expect(weakTone).toMatchObject({
      ok: true,
      plan: {
        finalText: "Искренне сочувствую. Оставьте ваш телефон. Что покажем?",
        validationResults: []
      }
    });
  });

  it("keeps the current hard allowlist structural", () => {
    expect(MODEL_TURN_TERMINAL_VALIDATION_CODES).toEqual([
      "invalid_shape",
      "invalid_answer",
      "invalid_question"
    ]);

    expect(
      validateModelTurnOutput({
        value: { version: "wrong" },
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "invalid_shape" });

    expect(
      validateModelTurnOutput({
        value: output({
          answerText: "В каком городе нужна установка?",
          question: { text: "В каком городе нужна установка?", target: "city" }
        }),
        turnInput: buildLiveV2TestTurn({ city: "Москва" })
      })
    ).toEqual({ ok: false, code: "invalid_answer" });
  });

  it("drops only an optional question when canonical text would exceed the limit", () => {
    const answerText = "а".repeat(890);
    const result = validateModelTurnOutput({
      value: output({
        answerText,
        question: { text: "Какой материал рассматриваете?", target: "material" }
      }),
      turnInput: buildLiveV2TestTurn()
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "answer",
        finalText: answerText,
        validationResults: ["question_dropped_for_length"]
      }
    });
  });
});

function output(input: {
  answerText?: string;
  question?: { text: string; target: "material" | "city" } | null;
  statePatches?: unknown[];
  recommendationIds?: string[];
  handoffReason?:
    | "customer_requested_manager"
    | "customer_wants_final_quote"
    | "customer_ready_to_order";
} = {}) {
  return {
    version: "granit_model_turn.v1",
    message: {
      answerText: input.answerText ?? "Подберём подходящий вариант.",
      question: input.question ?? null
    },
    statePatches: input.statePatches ?? [],
    recommendationIds: input.recommendationIds ?? [],
    handoffIntent: input.handoffReason ? { reason: input.handoffReason } : null
  };
}
