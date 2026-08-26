import type {
  AiRequirementCategory,
  AiRequirementMode
} from "../../ai-dialog-contract.js";

export const LIVE_V2_DECISION_PROFILE = "live_v2" as const;
export const LIVE_V2_CANDIDATE_VERSION = "granit_live_v2_candidate.v1" as const;
export const LIVE_V2_TURN_VIEW_VERSION = "granit_live_v2_turn_view.v1" as const;

export const LIVE_V2_KNOWN_REQUIREMENTS_MAX_ITEMS = 24;

export type LiveV2Action =
  | "answer"
  | "ask_clarifying_question"
  | "handoff_to_manager"
  | "no_reply";

export type LiveV2Slot =
  | "city"
  | "preferred_contact"
  | "contact_method"
  | "memorial_type"
  | "material"
  | "decoration"
  | "installation_site";

export type LiveV2ManagerRequest = "absent" | "negated" | "explicit";

export type LiveV2EvidenceBasis =
  | "current_message"
  | "recent_context"
  | "known_slots"
  | "approved_facts";

export type LiveV2Signals = {
  managerRequest: LiveV2ManagerRequest;
  mixedIntent: boolean;
};

export type LiveV2Evidence = {
  basis: LiveV2EvidenceBasis[];
  usedFactIds: string[];
};

type LiveV2CandidateBase = {
  schemaVersion: typeof LIVE_V2_CANDIDATE_VERSION;
  decisionProfile: typeof LIVE_V2_DECISION_PROFILE;
  signals: LiveV2Signals;
  evidence: LiveV2Evidence;
};

export type LiveV2AnswerCandidate = LiveV2CandidateBase & {
  action: "answer";
  replyDraft: string;
  reason: "answer_ready";
  missingSlots: [];
};

export type LiveV2ClarifyingQuestionCandidate = LiveV2CandidateBase & {
  action: "ask_clarifying_question";
  replyDraft: string;
  reason: "missing_required_slot";
  missingSlots: [LiveV2Slot];
};

export type LiveV2HandoffCandidate = LiveV2CandidateBase & {
  action: "handoff_to_manager";
  replyDraft: string;
  reason: "explicit_manager_request" | "manager_required";
  missingSlots: [];
};

export type LiveV2NoReplyCandidate = LiveV2CandidateBase & {
  action: "no_reply";
  replyDraft: null;
  reason: "no_safe_answer" | "missing_approved_fact";
  missingSlots: [];
};

export type LiveV2Candidate =
  | LiveV2AnswerCandidate
  | LiveV2ClarifyingQuestionCandidate
  | LiveV2HandoffCandidate
  | LiveV2NoReplyCandidate;

export type LiveV2TurnViewMessage = {
  role: "visitor" | "assistant";
  text: string;
};

export type LiveV2KnownSlots = {
  customerNameProvided: boolean;
  phoneProvided: boolean;
  emailProvided: boolean;
  preferredContact?: "phone" | "whatsapp" | "telegram" | "email";
  monumentType?: string;
  material?: string;
  size?: string;
  city?: string;
  cemetery?: string;
  installation?: string;
  desiredTiming?: string;
};

export type LiveV2KnownSlotProvenance = Partial<
  Record<
    "monumentType" | "material" | "size" | "city" | "cemetery" | "installation" | "desiredTiming",
    {
      origin: "saved_field";
      source: "contact" | "visitor_message" | "ai_extraction" | "manager";
    }
  >
>;

export type LiveV2KnownRequirement = {
  category: AiRequirementCategory;
  mode: AiRequirementMode;
  value: string;
  provenance: {
    origin: "saved_requirement";
    source: "ai_extraction" | "manager";
  };
};

export type LiveV2Gate = {
  aiState:
    | "ai_collecting_info"
    | "needs_manager"
    | "manager_active"
    | "watching"
    | "closed";
  agentAllowedToReply: boolean;
};

export type LiveV2TurnView = {
  version: typeof LIVE_V2_TURN_VIEW_VERSION;
  messages: LiveV2TurnViewMessage[];
  knownSlots: LiveV2KnownSlots;
  knownSlotProvenance: LiveV2KnownSlotProvenance;
  knownRequirements: LiveV2KnownRequirement[];
  gate: LiveV2Gate;
};

export type LiveV2ValidationFailureCode =
  | "invalid_shape"
  | "unsupported_schema_version"
  | "wrong_decision_profile"
  | "unsupported_action"
  | "invalid_reply_draft"
  | "invalid_reason"
  | "invalid_missing_slots"
  | "invalid_signals"
  | "invalid_evidence"
  | "unknown_fact_id"
  | "fact_evidence_mismatch"
  | "unsafe_claim"
  | "tone_violation"
  | "action_signal_mismatch"
  | "question_limit_exceeded"
  | "known_slot_requested"
  | "repeated_reply";

export type LiveV2ValidationResult =
  | {
      ok: true;
      decision: LiveV2Candidate;
    }
  | {
      ok: false;
      code: LiveV2ValidationFailureCode;
    };
