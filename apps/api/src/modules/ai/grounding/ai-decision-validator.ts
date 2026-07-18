import {
  GroundedAiTurnCandidateDecisionSchema,
  type AiSlotName,
  type GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";
import {
  isRequirementValueSupportedByEvidence,
  validateSlotEvidence,
  validateTextEvidence
} from "./ai-slot-evidence-service.js";

export const AI_DECISION_VALIDATION_ISSUES = [
  "invalid_schema",
  "missing_reply",
  "invalid_requested_slot",
  "repeated_known_slot",
  "duplicate_extracted_slot",
  "duplicate_extracted_requirement",
  "invalid_slot_evidence",
  "invalid_requirement_evidence",
  "invalid_handoff"
] as const;

export type AiDecisionValidationIssue =
  (typeof AI_DECISION_VALIDATION_ISSUES)[number];

export type AiDecisionValidationResult =
  | { valid: true; decision: GroundedAiTurnCandidateDecision }
  | { valid: false; issues: AiDecisionValidationIssue[] };

export function validateGroundedAiDecision(
  value: unknown,
  input: AiTurnInput
): AiDecisionValidationResult {
  const parsed = GroundedAiTurnCandidateDecisionSchema.safeParse(value);

  if (!parsed.success) {
    return { valid: false, issues: ["invalid_schema"] };
  }

  const decision = parsed.data;
  const issues = new Set<AiDecisionValidationIssue>();

  if (!decision.replyText.trim()) {
    issues.add("missing_reply");
  }

  if (
    (decision.action === "clarify" && decision.requestedSlots.length !== 1) ||
    (decision.action !== "clarify" && decision.requestedSlots.length > 0)
  ) {
    issues.add("invalid_requested_slot");
  }

  if (decision.action === "handoff" && !decision.handoffReason) {
    issues.add("invalid_handoff");
  }

  if (decision.action !== "handoff" && decision.handoffReason) {
    issues.add("invalid_handoff");
  }

  const extractedNames = new Set<AiSlotName>();

  for (const slot of decision.extractedSlots) {
    if (extractedNames.has(slot.name)) {
      issues.add("duplicate_extracted_slot");
    }

    extractedNames.add(slot.name);

    if (validateSlotEvidence(slot.name, slot.value, slot.evidence, input)) {
      issues.add("invalid_slot_evidence");
    }
  }

  const extractedRequirements = new Set<string>();

  for (const requirement of decision.extractedRequirements) {
    const key = `${requirement.category}:${requirement.mode}:${requirement.value
      .trim()
      .toLocaleLowerCase("ru-RU")}`;

    if (extractedRequirements.has(key)) {
      issues.add("duplicate_extracted_requirement");
    }

    extractedRequirements.add(key);

    if (
      validateTextEvidence(requirement.evidence, input) ||
      !isRequirementValueSupportedByEvidence(requirement.value, requirement.evidence.quote)
    ) {
      issues.add("invalid_requirement_evidence");
    }
  }

  const requestedSlot = decision.requestedSlots[0];

  if (
    requestedSlot &&
    (input.knownSlots.values[requestedSlot] || extractedNames.has(requestedSlot))
  ) {
    issues.add("repeated_known_slot");
  }

  return issues.size > 0
    ? { valid: false, issues: [...issues] }
    : { valid: true, decision };
}
