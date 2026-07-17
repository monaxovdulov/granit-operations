import type { CatalogRecord, CatalogSnapshot } from "../catalog/catalog-knowledge-port.js";
import {
  GroundedAiTurnCandidateDecisionSchema,
  type AiSlotName,
  type GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";
import { validateSlotEvidence } from "./ai-slot-evidence-service.js";

export const AI_DECISION_VALIDATION_ISSUES = [
  "invalid_schema",
  "missing_reply",
  "invalid_requested_slot",
  "repeated_known_slot",
  "duplicate_extracted_slot",
  "invalid_slot_evidence",
  "invalid_claim_span",
  "invalid_claim_grounding",
  "invalid_catalog_reference",
  "invalid_handoff"
] as const;

export type AiDecisionValidationIssue =
  (typeof AI_DECISION_VALIDATION_ISSUES)[number];

export type AiDecisionValidationResult =
  | { valid: true; decision: GroundedAiTurnCandidateDecision }
  | { valid: false; issues: AiDecisionValidationIssue[] };

const SYSTEM_POLICY_IDS = new Set([
  "widget.disclosure",
  "widget.commercial_boundary",
  "widget.missing_knowledge",
  "widget.handoff"
]);

export function validateGroundedAiDecision(
  value: unknown,
  input: AiTurnInput,
  snapshot: CatalogSnapshot,
  selectedRecords: readonly CatalogRecord[]
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

    if (validateSlotEvidence(slot.name, slot.evidence, input)) {
      issues.add("invalid_slot_evidence");
    }
  }

  const requestedSlot = decision.requestedSlots[0];

  if (
    requestedSlot &&
    (input.knownSlots.values[requestedSlot] || extractedNames.has(requestedSlot))
  ) {
    issues.add("repeated_known_slot");
  }

  for (const claim of decision.claims) {
    if (
      claim.start < 0 ||
      claim.end <= claim.start ||
      claim.end > decision.replyText.length ||
      decision.replyText.slice(claim.start, claim.end) !== claim.text
    ) {
      issues.add("invalid_claim_span");
    }

    const grounding = claim.grounding;

    if (grounding.kind === "catalog") {
      if (
        !grounding.catalogReference ||
        grounding.messageEvidence ||
        grounding.systemPolicyId
      ) {
        issues.add("invalid_claim_grounding");
      } else if (
        !isValidCatalogReference(
          grounding.catalogReference,
          snapshot,
          selectedRecords,
          input.inboundMessage.submittedAt
        )
      ) {
        issues.add("invalid_catalog_reference");
      }
    } else if (grounding.kind === "visitor_message") {
      if (
        grounding.catalogReference ||
        !grounding.messageEvidence ||
        grounding.systemPolicyId ||
        validateTextEvidence(grounding.messageEvidence, input)
      ) {
        issues.add("invalid_claim_grounding");
      }
    } else if (grounding.kind === "system_policy") {
      if (
        grounding.catalogReference ||
        grounding.messageEvidence ||
        !grounding.systemPolicyId ||
        !SYSTEM_POLICY_IDS.has(grounding.systemPolicyId)
      ) {
        issues.add("invalid_claim_grounding");
      }
    } else if (
      grounding.catalogReference ||
      grounding.messageEvidence ||
      grounding.systemPolicyId
    ) {
      issues.add("invalid_claim_grounding");
    }
  }

  return issues.size > 0
    ? { valid: false, issues: [...issues] }
    : { valid: true, decision };
}

function validateTextEvidence(
  evidence: { messageId: string; quote: string; start: number; end: number },
  input: AiTurnInput
): boolean {
  return Boolean(validateSlotEvidence("questionSummary", evidence, input));
}

function isValidCatalogReference(
  reference: {
    recordId: string;
    revision: number;
    path: string;
    catalogVersion: string;
  },
  snapshot: CatalogSnapshot,
  selectedRecords: readonly CatalogRecord[],
  at: string
): boolean {
  if (reference.catalogVersion !== snapshot.catalogVersion) {
    return false;
  }

  const record = selectedRecords.find(
    (candidate) =>
      candidate.id === reference.recordId &&
      candidate.revision === reference.revision &&
      candidate.status === "published"
  );

  return Boolean(
    record &&
      isCatalogRecordActive(record, at) &&
      resolveJsonPointer(record.data, reference.path).found
  );
}

function isCatalogRecordActive(record: CatalogRecord, at: string) {
  const timestamp = Date.parse(at);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (record.validFrom) {
    const validFrom = Date.parse(record.validFrom);

    if (!Number.isFinite(validFrom) || validFrom > timestamp) {
      return false;
    }
  }

  if (record.validUntil) {
    const validUntil = Date.parse(record.validUntil);

    if (!Number.isFinite(validUntil) || validUntil < timestamp) {
      return false;
    }
  }

  return true;
}

function resolveJsonPointer(
  value: unknown,
  path: string
): { found: boolean; value?: unknown } {
  if (path === "") {
    return { found: true, value };
  }

  if (!path.startsWith("/")) {
    return { found: false };
  }

  let current = value;

  for (const encodedSegment of path.slice(1).split("/")) {
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");

    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        return { found: false };
      }

      const index = Number(segment);

      if (index >= current.length) {
        return { found: false };
      }

      current = current[index];
      continue;
    }

    if (
      !current ||
      typeof current !== "object" ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return { found: false };
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return { found: true, value: current };
}
