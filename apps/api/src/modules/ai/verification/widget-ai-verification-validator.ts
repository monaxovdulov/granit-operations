import type { CatalogRecord, CatalogSnapshot } from "../catalog/catalog-knowledge-port.js";
import type {
  AiTextEvidence,
  GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";
import {
  isValidCatalogReference,
  WIDGET_AI_SYSTEM_POLICY_IDS
} from "../grounding/ai-catalog-reference-validator.js";
import { validateTextEvidence } from "../grounding/ai-slot-evidence-service.js";
import type { WidgetAiVerification } from "./widget-ai-semantic-verifier.js";

export const WIDGET_AI_VERIFICATION_CONTRACT_ISSUES = [
  "invalid_violation_span",
  "incoherent_claim_presence",
  "incomplete_claim_coverage",
  "invalid_claim_span",
  "duplicate_claim_verdict",
  "overlapping_claim_verdict",
  "unsupported_claim",
  "invalid_claim_grounding",
  "invalid_catalog_reference",
  "slot_verdict_count_mismatch",
  "duplicate_slot_verdict",
  "unexpected_slot_verdict",
  "slot_verdict_candidate_mismatch",
  "unsupported_slot_value",
  "requirement_verdict_count_mismatch",
  "duplicate_requirement_verdict",
  "unexpected_requirement_verdict",
  "requirement_verdict_candidate_mismatch",
  "unsupported_requirement_value",
  "required_action_mismatch"
] as const;

export type WidgetAiVerificationContractIssue =
  (typeof WIDGET_AI_VERIFICATION_CONTRACT_ISSUES)[number];

export function validateWidgetAiVerification(input: {
  turn: AiTurnInput;
  decision: GroundedAiTurnCandidateDecision;
  verification: WidgetAiVerification;
  snapshot: CatalogSnapshot;
  selectedRecords: readonly CatalogRecord[];
}): WidgetAiVerificationContractIssue[] {
  const issues = new Set<WidgetAiVerificationContractIssue>();
  const { decision, verification } = input;

  for (const violation of verification.violations) {
    const bothNull = violation.claimStart === null && violation.claimEnd === null;
    const validSpan =
      violation.claimStart !== null &&
      violation.claimEnd !== null &&
      violation.claimStart >= 0 &&
      violation.claimEnd > violation.claimStart &&
      violation.claimEnd <= decision.replyText.length;

    if (!bothNull && !validSpan) {
      issues.add("invalid_violation_span");
    }
  }

  if (verification.factualClaimsPresent !== (verification.claimVerdicts.length > 0)) {
    issues.add("incoherent_claim_presence");
  }

  if (!verification.claimCoverageComplete) {
    issues.add("incomplete_claim_coverage");
  }

  const claimKeys = new Set<string>();
  const validClaimSpans: Array<{ start: number; end: number }> = [];

  for (const claim of verification.claimVerdicts) {
    const spanIsValid =
      claim.start >= 0 &&
      claim.end > claim.start &&
      claim.end <= decision.replyText.length &&
      decision.replyText.slice(claim.start, claim.end) === claim.text;

    if (!spanIsValid) {
      issues.add("invalid_claim_span");
    } else {
      validClaimSpans.push({ start: claim.start, end: claim.end });
    }

    const claimKey = `${claim.start}:${claim.end}`;

    if (claimKeys.has(claimKey)) {
      issues.add("duplicate_claim_verdict");
    }

    claimKeys.add(claimKey);

    if (!claim.supported) {
      issues.add("unsupported_claim");
    }

    if (claim.kind === "catalog") {
      if (
        !claim.supported ||
        !claim.catalogReference ||
        claim.messageEvidence ||
        claim.systemPolicyId
      ) {
        issues.add("invalid_claim_grounding");
      } else if (
        !isValidCatalogReference(
          claim.catalogReference,
          input.snapshot,
          input.selectedRecords,
          input.turn.inboundMessage.submittedAt
        )
      ) {
        issues.add("invalid_catalog_reference");
      }
    } else if (claim.kind === "visitor_message") {
      if (
        !claim.supported ||
        claim.catalogReference ||
        !claim.messageEvidence ||
        claim.systemPolicyId ||
        (claim.messageEvidence && validateTextEvidence(claim.messageEvidence, input.turn))
      ) {
        issues.add("invalid_claim_grounding");
      }
    } else if (claim.kind === "system_policy") {
      if (
        !claim.supported ||
        claim.catalogReference ||
        claim.messageEvidence ||
        !claim.systemPolicyId ||
        (claim.systemPolicyId && !WIDGET_AI_SYSTEM_POLICY_IDS.has(claim.systemPolicyId))
      ) {
        issues.add("invalid_claim_grounding");
      }
    } else if (
      claim.supported ||
      claim.catalogReference ||
      claim.messageEvidence ||
      claim.systemPolicyId
    ) {
      issues.add("invalid_claim_grounding");
    }
  }

  validClaimSpans
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .forEach((span, index, spans) => {
      const previous = spans[index - 1];

      if (previous && span.start < previous.end) {
        issues.add("overlapping_claim_verdict");
      }
    });

  if (verification.slotVerdicts.length !== decision.extractedSlots.length) {
    issues.add("slot_verdict_count_mismatch");
  }

  const slotNames = new Set<string>();

  for (const verdict of verification.slotVerdicts) {
    if (slotNames.has(verdict.name)) {
      issues.add("duplicate_slot_verdict");
    }

    slotNames.add(verdict.name);
    const candidate = decision.extractedSlots.find((slot) => slot.name === verdict.name);

    if (!candidate) {
      issues.add("unexpected_slot_verdict");
      continue;
    }

    if (candidate.value !== verdict.value || !sameEvidence(candidate.evidence, verdict.evidence)) {
      issues.add("slot_verdict_candidate_mismatch");
    }

    if (!verdict.valid || !verdict.valueSupportedByEvidence) {
      issues.add("unsupported_slot_value");
    }
  }

  if (verification.requirementVerdicts.length !== decision.extractedRequirements.length) {
    issues.add("requirement_verdict_count_mismatch");
  }

  const requirementKeys = new Set<string>();

  for (const verdict of verification.requirementVerdicts) {
    const key = requirementKey(verdict);

    if (requirementKeys.has(key)) {
      issues.add("duplicate_requirement_verdict");
    }

    requirementKeys.add(key);
    const candidate = decision.extractedRequirements.find(
      (requirement) => requirementKey(requirement) === key
    );

    if (!candidate) {
      issues.add("unexpected_requirement_verdict");
      continue;
    }

    if (!sameEvidence(candidate.evidence, verdict.evidence)) {
      issues.add("requirement_verdict_candidate_mismatch");
    }

    if (!verdict.valid || !verdict.valueSupportedByEvidence) {
      issues.add("unsupported_requirement_value");
    }
  }

  if (
    verification.requiredAction !== null &&
    verification.requiredAction !== decision.action
  ) {
    issues.add("required_action_mismatch");
  }

  return [...issues];
}

function sameEvidence(left: AiTextEvidence, right: AiTextEvidence): boolean {
  return (
    left.messageId === right.messageId &&
    left.quote === right.quote &&
    left.start === right.start &&
    left.end === right.end
  );
}

function requirementKey(requirement: {
  category: string;
  mode: string;
  value: string;
}): string {
  return `${requirement.category}:${requirement.mode}:${requirement.value}`;
}
