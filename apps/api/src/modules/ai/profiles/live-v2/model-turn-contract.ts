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
import type { CatalogSearchInput } from "../../catalog/catalog-search-tool.js";

export const MODEL_TURN_OUTPUT_VERSION = "granit_model_turn.v2" as const;
export const MODEL_TURN_PROMPT_VERSION = "granit_model_turn_prompt.v4" as const;
export const MODEL_TURN_MODEL_PROFILE_VERSION =
  "granit_model_turn_openai_luna.v1" as const;

export const MODEL_TURN_TERMINAL_VALIDATION_CODES = [
  "invalid_shape",
  "invalid_answer",
  "invalid_question",
  "invalid_action"
] as const;

export const FINAL_TURN_ACTIONS = [
  "answer",
  "clarify",
  "recommend",
  "recommend_and_clarify"
] as const;

export type FinalTurnAction = (typeof FINAL_TURN_ACTIONS)[number];

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

export type FinalTurnResult = {
  version: typeof MODEL_TURN_OUTPUT_VERSION;
  action: FinalTurnAction;
  message: string;
  clarifyingQuestion: {
    text: string;
    target: AiSlotName;
  } | null;
  statePatches: ProposedStatePatch[];
  recommendationIds: string[];
  handoffIntent: {
    reason: ModelTurnHandoffReason;
  } | null;
};

export type ModelTurnAction =
  | {
      version: typeof MODEL_TURN_OUTPUT_VERSION;
      type: "final";
      result: FinalTurnResult;
    }
  | {
      version: typeof MODEL_TURN_OUTPUT_VERSION;
      type: "search_catalog";
      input: CatalogSearchInput;
    };

export type ModelTurnValidationIssue =
  | AiValidatorFailureCode
  | "unsupported_recommendation"
  | "invalid_patch_evidence"
  | "duplicate_patch"
  | "question_dropped_for_length"
  | "action_repaired"
  | "tool_arguments_invalid"
  | "tool_loop_blocked"
  | "final_output_invalid";

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
  responseAction: FinalTurnAction;
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
  | { ok: true; output: FinalTurnResult; plan: ValidatedTurnPlan }
  | { ok: false; code: ModelTurnTerminalValidationCode };
