import { z } from "zod";

export const AI_TURN_DECISION_VERSION = "granit_ai_turn_decision.stage_b.v1" as const;

export const AI_SLOT_NAMES = [
  "monumentType",
  "material",
  "size",
  "city",
  "cemetery",
  "engraving",
  "installation",
  "budgetContext",
  "desiredTiming",
  "customerName",
  "phone",
  "preferredContact",
  "questionSummary"
] as const;

export type AiSlotName = (typeof AI_SLOT_NAMES)[number];

export const AI_TURN_ACTIONS = ["answer", "clarify", "handoff", "block", "fallback"] as const;
export type AiTurnAction = (typeof AI_TURN_ACTIONS)[number];

export const AI_TURN_INTENTS = [
  "general_question",
  "product_selection",
  "price_intake",
  "deadline_intake",
  "contact_request",
  "manager_request",
  "binding_terms",
  "out_of_scope"
] as const;
export type AiTurnIntent = (typeof AI_TURN_INTENTS)[number];

export const AI_RISK_FLAGS = [
  "exact_price_requested",
  "final_quote_pressure",
  "binding_terms_requested",
  "legal_funeral_topic",
  "manager_requested",
  "low_confidence",
  "missing_approved_source"
] as const;
export type AiRiskFlag = (typeof AI_RISK_FLAGS)[number];

export const AI_HANDOFF_REASONS = [
  "manager_requested",
  "final_quote_pressure",
  "binding_terms",
  "out_of_scope",
  "lead_ready",
  "low_confidence",
  "model_degradation"
] as const;
export type AiHandoffReason = (typeof AI_HANDOFF_REASONS)[number];

const AiExtractedSlotCandidateSchema = z
  .object({
    name: z.enum(AI_SLOT_NAMES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1)
  })
  .strict();

const ApprovedSourceEvidenceSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(120),
    kind: z.enum(["business_fact", "price"])
  })
  .strict();

export const AiTurnCandidateDecisionSchema = z
  .object({
    version: z.literal(AI_TURN_DECISION_VERSION),
    action: z.enum(AI_TURN_ACTIONS),
    intent: z.enum(AI_TURN_INTENTS),
    replyText: z.string().trim().min(1).max(900).nullable(),
    extractedSlots: z.array(AiExtractedSlotCandidateSchema).max(AI_SLOT_NAMES.length),
    requestedSlots: z.array(z.enum(AI_SLOT_NAMES)).max(1),
    riskFlags: z.array(z.enum(AI_RISK_FLAGS)).max(AI_RISK_FLAGS.length),
    handoffReason: z.enum(AI_HANDOFF_REASONS).nullable(),
    sourceEvidence: z.array(ApprovedSourceEvidenceSchema).max(16),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export type AiExtractedSlotCandidate = z.infer<typeof AiExtractedSlotCandidateSchema>;
export type ApprovedSourceEvidence = z.infer<typeof ApprovedSourceEvidenceSchema>;
export type AiTurnCandidateDecision = z.infer<typeof AiTurnCandidateDecisionSchema>;

export type AiKnownSlot = {
  value: string;
  source: "contact" | "visitor_message" | "ai_extraction" | "manager";
  sourceMessageId?: string;
  evidence?: AiTextEvidence;
  confidence: number;
  updatedAt: string;
};

export type AiKnownSlots = Partial<Record<AiSlotName, AiKnownSlot>>;

export type AiSlotUpdate = AiExtractedSlotCandidate & {
  source: "ai_extraction";
  sourceMessageId: string;
  evidence?: AiTextEvidence;
};

export const GROUNDED_AI_TURN_DECISION_VERSION =
  "granit_ai_turn_decision.grounded.v3" as const;

export const GROUNDED_AI_TURN_ACTIONS = ["answer", "clarify", "handoff"] as const;
export type GroundedAiTurnAction = (typeof GROUNDED_AI_TURN_ACTIONS)[number];

export const AI_CLAIM_GROUNDING_KINDS = [
  "catalog",
  "visitor_message",
  "system_policy",
  "conversation_only"
] as const;
export type AiClaimGroundingKind = (typeof AI_CLAIM_GROUNDING_KINDS)[number];

export const AI_REQUIREMENT_CATEGORIES = [
  "style",
  "color",
  "shape",
  "accessory",
  "decoration",
  "site_constraint",
  "other"
] as const;
export type AiRequirementCategory = (typeof AI_REQUIREMENT_CATEGORIES)[number];

export const AI_REQUIREMENT_MODES = ["preference", "requirement", "avoidance"] as const;
export type AiRequirementMode = (typeof AI_REQUIREMENT_MODES)[number];

export const AiTextEvidenceSchema = z
  .object({
    messageId: z.string().uuid(),
    quote: z.string().min(1).max(900),
    start: z.number().int().min(0).max(12000),
    end: z.number().int().min(1).max(12000)
  })
  .strict();

export const CatalogReferenceSchema = z
  .object({
    recordId: z.string().trim().min(1).max(160),
    revision: z.number().int().min(1),
    path: z.string().max(300),
    catalogVersion: z.string().trim().min(1).max(160)
  })
  .strict();

const AiGroundedSlotCandidateSchema = z
  .object({
    name: z.enum(AI_SLOT_NAMES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: AiTextEvidenceSchema
  })
  .strict();

const AiGroundedRequirementCandidateSchema = z
  .object({
    category: z.enum(AI_REQUIREMENT_CATEGORIES),
    mode: z.enum(AI_REQUIREMENT_MODES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: AiTextEvidenceSchema
  })
  .strict();

export const GroundedAiTurnCandidateDecisionSchema = z
  .object({
    version: z.literal(GROUNDED_AI_TURN_DECISION_VERSION),
    action: z.enum(GROUNDED_AI_TURN_ACTIONS),
    intent: z.enum(AI_TURN_INTENTS),
    replyText: z.string().trim().min(1).max(900),
    extractedSlots: z.array(AiGroundedSlotCandidateSchema).max(AI_SLOT_NAMES.length),
    extractedRequirements: z.array(AiGroundedRequirementCandidateSchema).max(24),
    requestedSlots: z.array(z.enum(AI_SLOT_NAMES)).max(1),
    riskFlags: z.array(z.enum(AI_RISK_FLAGS)).max(AI_RISK_FLAGS.length),
    handoffReason: z.enum(AI_HANDOFF_REASONS).nullable(),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export type AiTextEvidence = z.infer<typeof AiTextEvidenceSchema>;
export type CatalogReference = z.infer<typeof CatalogReferenceSchema>;
export type AiGroundedSlotCandidate = z.infer<typeof AiGroundedSlotCandidateSchema>;
export type AiGroundedRequirementCandidate = z.infer<
  typeof AiGroundedRequirementCandidateSchema
>;
export type AiRequirementUpdate = AiGroundedRequirementCandidate & {
  source: "ai_extraction";
  sourceMessageId: string;
};
export type GroundedAiTurnCandidateDecision = z.infer<
  typeof GroundedAiTurnCandidateDecisionSchema
>;

const stringEnumSchema = (values: readonly string[]) => ({
  type: "string",
  enum: [...values]
});

export const AI_TURN_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: AI_TURN_DECISION_VERSION },
    action: stringEnumSchema(AI_TURN_ACTIONS),
    intent: stringEnumSchema(AI_TURN_INTENTS),
    replyText: { type: ["string", "null"], maxLength: 900 },
    extractedSlots: {
      type: "array",
      maxItems: AI_SLOT_NAMES.length,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: stringEnumSchema(AI_SLOT_NAMES),
          value: { type: "string", minLength: 1, maxLength: 240 },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        },
        required: ["name", "value", "confidence"]
      }
    },
    requestedSlots: {
      type: "array",
      maxItems: 1,
      items: stringEnumSchema(AI_SLOT_NAMES)
    },
    riskFlags: {
      type: "array",
      maxItems: AI_RISK_FLAGS.length,
      items: stringEnumSchema(AI_RISK_FLAGS)
    },
    handoffReason: {
      anyOf: [stringEnumSchema(AI_HANDOFF_REASONS), { type: "null" }]
    },
    sourceEvidence: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceId: { type: "string", minLength: 1, maxLength: 120 },
          version: { type: "string", minLength: 1, maxLength: 120 },
          kind: stringEnumSchema(["business_fact", "price"])
        },
        required: ["sourceId", "version", "kind"]
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "version",
    "action",
    "intent",
    "replyText",
    "extractedSlots",
    "requestedSlots",
    "riskFlags",
    "handoffReason",
    "sourceEvidence",
    "confidence"
  ]
} as const;

const AI_TEXT_EVIDENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    messageId: { type: "string", minLength: 36, maxLength: 36 },
    quote: { type: "string", minLength: 1, maxLength: 900 },
    start: { type: "integer", minimum: 0, maximum: 12000 },
    end: { type: "integer", minimum: 1, maximum: 12000 }
  },
  required: ["messageId", "quote", "start", "end"]
} as const;

export const GROUNDED_AI_TURN_DECISION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: GROUNDED_AI_TURN_DECISION_VERSION },
    action: stringEnumSchema(GROUNDED_AI_TURN_ACTIONS),
    intent: stringEnumSchema(AI_TURN_INTENTS),
    replyText: { type: "string", minLength: 1, maxLength: 900 },
    extractedSlots: {
      type: "array",
      maxItems: AI_SLOT_NAMES.length,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: stringEnumSchema(AI_SLOT_NAMES),
          value: { type: "string", minLength: 1, maxLength: 240 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: AI_TEXT_EVIDENCE_JSON_SCHEMA
        },
        required: ["name", "value", "confidence", "evidence"]
      }
    },
    extractedRequirements: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: stringEnumSchema(AI_REQUIREMENT_CATEGORIES),
          mode: stringEnumSchema(AI_REQUIREMENT_MODES),
          value: { type: "string", minLength: 1, maxLength: 240 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: AI_TEXT_EVIDENCE_JSON_SCHEMA
        },
        required: ["category", "mode", "value", "confidence", "evidence"]
      }
    },
    requestedSlots: {
      type: "array",
      maxItems: 1,
      items: stringEnumSchema(AI_SLOT_NAMES)
    },
    riskFlags: {
      type: "array",
      maxItems: AI_RISK_FLAGS.length,
      items: stringEnumSchema(AI_RISK_FLAGS)
    },
    handoffReason: {
      anyOf: [stringEnumSchema(AI_HANDOFF_REASONS), { type: "null" }]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "version",
    "action",
    "intent",
    "replyText",
    "extractedSlots",
    "extractedRequirements",
    "requestedSlots",
    "riskFlags",
    "handoffReason",
    "confidence"
  ]
} as const;
