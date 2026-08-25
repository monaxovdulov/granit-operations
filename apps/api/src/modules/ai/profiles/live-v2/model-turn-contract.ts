import type {
  AiHandoffReason,
  AiRequirementCategory,
  AiRequirementMode,
  AiRequirementUpdate,
  AiRiskFlag,
  AiSlotName,
  AiSlotUpdate
} from "../../ai-dialog-contract.js";
import type { AiValidatorFailureCode } from "../../observability/ai-validator-failure-code.js";

export const MODEL_TURN_OUTPUT_VERSION = "granit_model_turn.v1" as const;
export const MODEL_TURN_PROMPT_VERSION = "granit_model_turn_prompt.v3" as const;
export const MODEL_TURN_MODEL_PROFILE_VERSION =
  "granit_model_turn_openai_luna.v1" as const;

export const MODEL_TURN_TERMINAL_VALIDATION_CODES = [
  "invalid_shape",
  "invalid_answer",
  "invalid_question"
] as const;

export type ModelTurnTerminalValidationCode =
  (typeof MODEL_TURN_TERMINAL_VALIDATION_CODES)[number];

export const MODEL_TURN_HANDOFF_REASONS = [
  "customer_requested_manager",
  "customer_wants_final_quote",
  "customer_ready_to_order"
] as const;

export type ModelTurnHandoffReason = (typeof MODEL_TURN_HANDOFF_REASONS)[number];

export type ModelTurnQuoteEvidence = {
  quote: string;
};

export type ModelTurnSetSlotPatch = {
  operation: "set_slot";
  name: AiSlotName;
  value: string;
  confidence: number;
  evidence: ModelTurnQuoteEvidence;
};

export type ModelTurnUpsertRequirementPatch = {
  operation: "upsert_requirement";
  category: AiRequirementCategory;
  mode: AiRequirementMode;
  value: string;
  confidence: number;
  evidence: ModelTurnQuoteEvidence;
};

export type ProposedStatePatch =
  | ModelTurnSetSlotPatch
  | ModelTurnUpsertRequirementPatch;

export type ModelTurnOutput = {
  version: typeof MODEL_TURN_OUTPUT_VERSION;
  message: {
    answerText: string;
    question: {
      text: string;
      target: AiSlotName;
    } | null;
  };
  statePatches: ProposedStatePatch[];
  recommendationIds: string[];
  handoffIntent: {
    reason: ModelTurnHandoffReason;
  } | null;
};

export type ModelTurnValidationIssue =
  | AiValidatorFailureCode
  | "unsupported_recommendation"
  | "invalid_patch_evidence"
  | "duplicate_patch"
  | "question_dropped_for_length";

export type RejectedStatePatch = {
  patch: ProposedStatePatch;
  reason: "invalid_patch_evidence" | "duplicate_patch";
};

export type ModelTurnRiskAssessment = {
  flags: AiRiskFlag[];
  requiresSemanticVerifier: false;
};

export type ValidatedTurnPlan = {
  action: "answer" | "ask_clarifying_question" | "handoff_to_manager";
  reason: "answer_ready" | "question_ready" | ModelTurnHandoffReason;
  finalText: string;
  finalTextHash: string;
  appliedPatches: Array<AiSlotUpdate | AiRequirementUpdate>;
  droppedPatches: RejectedStatePatch[];
  recommendationIds: string[];
  droppedRecommendationIds: string[];
  riskAssessment: ModelTurnRiskAssessment;
  validationResults: ModelTurnValidationIssue[];
  handoffAction?: {
    reason: AiHandoffReason;
    sourceReason: ModelTurnHandoffReason;
  };
};

export type CommittedTurn = {
  runId: string;
  outboundMessageId: string;
  outboundPublicMessageId: string;
  finalText: string;
  finalTextHash: string;
};

export type ModelTurnValidationResult =
  | { ok: true; output: ModelTurnOutput; plan: ValidatedTurnPlan }
  | { ok: false; code: ModelTurnTerminalValidationCode };
