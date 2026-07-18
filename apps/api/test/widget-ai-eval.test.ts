import { describe, expect, it } from "vitest";

import {
  WIDGET_AI_REGRESSION_CORPUS,
  promoteAiReviewToEvalCase,
  runWidgetAiEvalCase
} from "../src/modules/ai/eval/widget-ai-regression-corpus.js";
import { validateWidgetAiEvalCorpus } from "../src/modules/ai/eval/widget-ai-eval-runner.js";

describe("widget AI review and regression loop", () => {
  it("keeps a baseline corpus for every hard dialog boundary", () => {
    expect(WIDGET_AI_REGRESSION_CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(WIDGET_AI_REGRESSION_CORPUS.length).toBeLessThanOrEqual(50);
    expect(new Set(WIDGET_AI_REGRESSION_CORPUS.map((entry) => entry.caseId)).size).toBe(
      WIDGET_AI_REGRESSION_CORPUS.length
    );
    expect(WIDGET_AI_REGRESSION_CORPUS.every((entry) => entry.sanitizedInput.messages.length)).toBe(
      true
    );
    expect(WIDGET_AI_REGRESSION_CORPUS.map((entry) => entry.caseId)).toEqual(
      expect.arrayContaining([
        "multi_turn_selection",
        "no_repeated_material",
        "price_orientation_collect_context",
        "final_quote_handoff",
        "explicit_manager_handoff",
        "legal_boundary",
        "provider_degradation",
        "document_word_not_handoff",
        "connection_word_not_handoff",
        "empty_catalog_honest_answer"
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
        forbiddenPhrases: ["какой материал"]
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

  it("validates every offline case without invoking a model", () => {
    expect(validateWidgetAiEvalCorpus(WIDGET_AI_REGRESSION_CORPUS)).toEqual({
      valid: true,
      failures: []
    });
  });

  it("checks extracted values, message evidence, grounding coverage and latency", () => {
    const evalCase = WIDGET_AI_REGRESSION_CORPUS.find(
      (entry) => entry.caseId === "extract_monument_type"
    )!;
    const result = runWidgetAiEvalCase(evalCase, {
      action: "clarify",
      replyText: "Понял. Какой материал рассматриваете?",
      requestedSlots: ["material"],
      slotUpdates: [
        {
          name: "monumentType",
          value: "одинарный",
          evidence: {
            messageId: "11111111-1111-4111-8111-111111111111",
            quote: "двойной памятник",
            start: 6,
            end: 22
          }
        }
      ],
      groundingVerified: false,
      claimCoverageComplete: false,
      verifierViolations: ["unnatural_tone"],
      latencyMs: 25_000
    });

    expect(result.failures).toEqual(
      expect.arrayContaining([
        "wrong_extracted_value:monumentType",
        "grounding_not_verified",
        "claim_coverage_incomplete",
        "latency_exceeded:20000",
        "semantic_quality_violation"
      ])
    );
  });
});
