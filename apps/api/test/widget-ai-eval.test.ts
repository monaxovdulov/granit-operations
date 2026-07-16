import { describe, expect, it } from "vitest";

import {
  WIDGET_AI_REGRESSION_CORPUS,
  promoteAiReviewToEvalCase,
  runWidgetAiEvalCase
} from "../src/modules/ai/eval/widget-ai-regression-corpus.js";

describe("widget AI review and regression loop", () => {
  it("keeps a baseline corpus for every hard dialog boundary", () => {
    expect(WIDGET_AI_REGRESSION_CORPUS).toHaveLength(10);
    expect(new Set(WIDGET_AI_REGRESSION_CORPUS.map((entry) => entry.caseId)).size).toBe(10);
    expect(WIDGET_AI_REGRESSION_CORPUS.map((entry) => entry.caseId)).toEqual(
      expect.arrayContaining([
        "multi_turn_selection",
        "no_repeated_material",
        "consult_first_price",
        "final_quote_handoff",
        "explicit_manager_handoff",
        "legal_boundary",
        "provider_degradation",
        "takeover_stale_draft",
        "source_mismatch",
        "lead_summary"
      ])
    );
  });

  it("promotes a labeled bad dialog into a sanitized case and verifies the fix", () => {
    const evalCase = promoteAiReviewToEvalCase({
      caseId: "review-repeated-material-001",
      label: "repeated_question",
      messages: [
        "Меня зовут Анна, телефон +7 (900) 123-45-67, anna@example.ru",
        "Нужен памятник из чёрного гранита"
      ],
      knownSlots: { material: "чёрный гранит" },
      expected: {
        action: "clarify",
        requestedSlot: "size",
        forbiddenPatterns: ["какой материал"]
      }
    });

    expect(JSON.stringify(evalCase)).not.toContain("123-45-67");
    expect(JSON.stringify(evalCase)).not.toContain("anna@example.ru");

    const regression = runWidgetAiEvalCase(evalCase, {
      action: "clarify",
      replyText: "Какой материал вы рассматриваете?",
      requestedSlots: ["material"]
    });
    expect(regression).toMatchObject({ passed: false });
    expect(regression.failures).toEqual(
      expect.arrayContaining(["expected_requested_slot:size", "repeated_known_slot:material"])
    );

    const verifiedFix = runWidgetAiEvalCase(evalCase, {
      action: "clarify",
      replyText: "Чёрный гранит записал. Какой размер нужен?",
      requestedSlots: ["size"]
    });
    expect(verifiedFix).toEqual({ passed: true, failures: [] });
  });
});
