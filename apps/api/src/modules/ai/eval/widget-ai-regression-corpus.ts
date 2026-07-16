import type { AiSlotName, AiTurnAction } from "../ai-dialog-contract.js";

export const AI_REVIEW_LABELS = [
  "wrong_intent",
  "repeated_question",
  "missed_handoff",
  "early_handoff",
  "unsupported_fact",
  "unsafe_commercial_promise",
  "bad_tone",
  "poor_lead_summary"
] as const;

export type AiReviewLabel = (typeof AI_REVIEW_LABELS)[number];

export type WidgetAiEvalCase = {
  caseId: string;
  source: "baseline" | "manager_review";
  label: AiReviewLabel;
  sanitizedInput: {
    messages: string[];
    knownSlots: Partial<Record<AiSlotName, string>>;
  };
  expected: {
    action: AiTurnAction;
    requestedSlot?: AiSlotName;
    forbiddenPatterns: string[];
  };
};

export type WidgetAiEvalOutput = {
  action: AiTurnAction;
  replyText: string;
  requestedSlots: AiSlotName[];
};

export const WIDGET_AI_REGRESSION_CORPUS: WidgetAiEvalCase[] = [
  baseline("multi_turn_selection", "wrong_intent", "clarify", "size", ["анкета"]),
  baseline("no_repeated_material", "repeated_question", "clarify", "size", ["какой материал"]),
  baseline("consult_first_price", "early_handoff", "clarify", "material", ["\\d+[ \\d]*(₽|руб)"]),
  baseline("final_quote_handoff", "missed_handoff", "handoff", undefined, ["точная цена"]),
  baseline("explicit_manager_handoff", "missed_handoff", "handoff", undefined, []),
  baseline("legal_boundary", "unsupported_fact", "handoff", undefined, ["по закону"]),
  baseline("provider_degradation", "missed_handoff", "fallback", undefined, []),
  baseline("takeover_stale_draft", "missed_handoff", "block", undefined, []),
  baseline("source_mismatch", "unsupported_fact", "fallback", undefined, []),
  baseline("lead_summary", "poor_lead_summary", "handoff", undefined, ["неизвестно всё"])
];

export function promoteAiReviewToEvalCase(input: {
  caseId: string;
  label: AiReviewLabel;
  messages: string[];
  knownSlots?: Partial<Record<AiSlotName, string>>;
  expected: WidgetAiEvalCase["expected"];
}): WidgetAiEvalCase {
  return {
    caseId: input.caseId,
    source: "manager_review",
    label: input.label,
    sanitizedInput: {
      messages: input.messages.slice(-12).map(sanitizeAiEvalText),
      knownSlots: Object.fromEntries(
        Object.entries(input.knownSlots ?? {}).map(([name, value]) => [
          name,
          sanitizeAiEvalText(value)
        ])
      )
    },
    expected: input.expected
  };
}

export function runWidgetAiEvalCase(
  evalCase: WidgetAiEvalCase,
  output: WidgetAiEvalOutput
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (output.action !== evalCase.expected.action) {
    failures.push(`expected_action:${evalCase.expected.action}`);
  }

  if (
    evalCase.expected.requestedSlot &&
    output.requestedSlots[0] !== evalCase.expected.requestedSlot
  ) {
    failures.push(`expected_requested_slot:${evalCase.expected.requestedSlot}`);
  }

  if (output.requestedSlots.length > 1) {
    failures.push("too_many_requested_slots");
  }

  for (const knownSlot of output.requestedSlots) {
    if (evalCase.sanitizedInput.knownSlots[knownSlot]) {
      failures.push(`repeated_known_slot:${knownSlot}`);
    }
  }

  for (const pattern of evalCase.expected.forbiddenPatterns) {
    if (new RegExp(pattern, "iu").test(output.replyText)) {
      failures.push(`forbidden_pattern:${pattern}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

export function sanitizeAiEvalText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replace(/(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, "[phone]")
    .trim()
    .slice(0, 4000);
}

function baseline(
  caseId: string,
  label: AiReviewLabel,
  action: AiTurnAction,
  requestedSlot: AiSlotName | undefined,
  forbiddenPatterns: string[]
): WidgetAiEvalCase {
  return {
    caseId,
    source: "baseline",
    label,
    sanitizedInput: {
      messages: [],
      knownSlots: caseId === "no_repeated_material" ? { material: "гранит" } : {}
    },
    expected: {
      action,
      requestedSlot,
      forbiddenPatterns
    }
  };
}
