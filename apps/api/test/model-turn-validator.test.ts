import { sha256Hex } from "@granit/shared";
import { describe, expect, it } from "vitest";

import type { AiSlotName } from "../src/modules/ai/ai-dialog-contract.js";
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
        finalText: "Подберём вариант.\n\nКакой материал рассматриваете?"
      }
    });
  });

  it("repairs a duplicated question suffix despite sentence-case differences", () => {
    const result = validateModelTurnOutput({
      value: output({
        answerText:
          "В каталоге представлены вертикальные памятники. Запрос на форму арфы зафиксировал; какой материал рассматривать?",
        question: { text: "Какой материал рассматривать?", target: "material" }
      }),
      turnInput: buildLiveV2TestTurn({ inbound: "покажи памятник арфа" })
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        action: "ask_clarifying_question",
        finalText:
          "В каталоге представлены вертикальные памятники. Запрос на форму арфы зафиксировал.\n\nКакой материал рассматривать?"
      }
    });
  });

  it("does not hide a second question inside answerText", () => {
    expect(
      validateModelTurnOutput({
        value: output({
          answerText: "Вы спрашиваете о заказе? Помогу разобраться.",
          question: { text: "Что именно нужно уточнить?", target: "questionSummary" }
        }),
        turnInput: buildLiveV2TestTurn({
          inbound: "Здравствуйте, у меня есть вопрос по заказу"
        })
      })
    ).toEqual({ ok: false, code: "duplicate_question" });

    expect(
      validateModelTurnOutput({
        value: output({
          answerText: "Нужно уточнить предматериал?",
          question: { text: "Материал?", target: "material" }
        }),
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "duplicate_question" });
  });

  it("rejects a question for a known slot and unsafe commercial text", () => {
    expect(
      validateModelTurnOutput({
        value: output({
          question: { text: "В каком городе нужна установка?", target: "city" }
        }),
        turnInput: buildLiveV2TestTurn({ city: "Москва" })
      })
    ).toEqual({ ok: false, code: "known_slot_requested" });

    expect(
      validateModelTurnOutput({
        value: output({ answerText: "Сделаем за три дня." }),
        turnInput: buildLiveV2TestTurn()
      })
    ).toEqual({ ok: false, code: "unsafe_claim" });
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

  it("rejects a question for a slot extracted from the same inbound", () => {
    expect(
      validateModelTurnOutput({
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
      })
    ).toEqual({ ok: false, code: "known_slot_requested" });
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

  it("rejects a byte-equivalent repeated assistant reply", () => {
    const previous = contextMessage({
      id: 91,
      role: "assistant",
      text: "Подберём подходящий вариант."
    });
    expect(
      validateModelTurnOutput({
        value: output(),
        turnInput: buildLiveV2TestTurn({ previousMessagesNewestFirst: [previous] })
      })
    ).toEqual({ ok: false, code: "repeated_reply" });
  });
});

function output(input: {
  answerText?: string;
  question?: { text: string; target: AiSlotName } | null;
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
