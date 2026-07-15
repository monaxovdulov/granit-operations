export const AI_RUN_STATUSES = [
  "running",
  "persisted",
  "handed_off",
  "blocked",
  "fallback_unavailable",
  "failed"
] as const;

export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];
export type AiRunTerminalStatus = Exclude<AiRunStatus, "running">;

export const AI_RUN_RUNTIME_MODES = ["direct_openai", "mastra_openai_api"] as const;
export type AiRunRuntimeMode = (typeof AI_RUN_RUNTIME_MODES)[number];

export const AI_RUN_DECISION_PROFILES = ["legacy_s05", "live_v2"] as const;
export type AiRunDecisionProfile = (typeof AI_RUN_DECISION_PROFILES)[number];

export const AI_RUN_NORMALIZED_ACTIONS = [
  "answer",
  "ask_clarifying_question",
  "handoff_to_manager",
  "no_reply"
] as const;
export type AiRunNormalizedAction = (typeof AI_RUN_NORMALIZED_ACTIONS)[number];

export const AI_RUN_SEND_GATE_RESULTS = ["not_checked", "allowed", "blocked"] as const;
export type AiRunSendGateResult = (typeof AI_RUN_SEND_GATE_RESULTS)[number];

export const AI_RUN_OUTCOME_REASONS = [
  "reply_persisted",
  "handoff_to_manager",
  "missing_provider_config",
  "model_error",
  "empty_model_response",
  "unsafe_model_response",
  "agent_reply_blocked",
  "ai_persistence_unconfirmed",
  "execution_context_mismatch",
  "generator_failed",
  "candidate_invalid",
  "gate_closed",
  "recorder_failure"
] as const;
export type AiRunOutcomeReason = (typeof AI_RUN_OUTCOME_REASONS)[number];

export const AI_RUN_FAILURE_CODES = [
  "provider_unavailable",
  "model_failure",
  "policy_violation",
  "send_gate_blocked",
  "persistence_failure",
  "runtime_failure",
  "recorder_failure",
  "invalid_candidate",
  "execution_context_mismatch"
] as const;
export type AiRunFailureCode = (typeof AI_RUN_FAILURE_CODES)[number];

export const AI_RUN_VALIDATOR_RESULTS = ["not_run", "passed", "rejected", "failed"] as const;
export type AiRunValidatorResult = (typeof AI_RUN_VALIDATOR_RESULTS)[number];

export const AI_RUN_SPAN_KINDS = ["runtime", "model", "tool", "validation", "send_gate"] as const;
export type AiRunSpanKind = (typeof AI_RUN_SPAN_KINDS)[number];

export const AI_RUN_SPAN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped"
] as const;
export type AiRunSpanStatus = (typeof AI_RUN_SPAN_STATUSES)[number];

export const AI_RUN_SPAN_NAMES = [
  "turn_execution",
  "decision_generation",
  "candidate_validation",
  "reply_persistence",
  "send_gate_check",
  "runtime_execution",
  "model_generation",
  "tool_execution"
] as const;
export type AiRunSpanName = (typeof AI_RUN_SPAN_NAMES)[number];

export const AI_RUN_SPAN_ERROR_CODES = [
  "provider_unavailable",
  "model_error",
  "empty_model_response",
  "unsafe_model_response",
  "validation_failed",
  "send_gate_blocked",
  "persistence_failed",
  "tool_failed",
  "runtime_failed",
  "recorder_failed"
] as const;
export type AiRunSpanErrorCode = (typeof AI_RUN_SPAN_ERROR_CODES)[number];

export const AI_QUALITY_EVENT_TYPES = [
  "handoff",
  "degradation",
  "blocked",
  "policy_violation",
  "model_failure",
  "tool_failure",
  "runtime_failure"
] as const;
export type AiQualityEventType = (typeof AI_QUALITY_EVENT_TYPES)[number];

export const AI_QUALITY_REASON_CODES = [
  "handoff_to_manager",
  "missing_openai_config",
  "model_error",
  "empty_model_response",
  "unsafe_model_response",
  "agent_reply_blocked",
  "ai_persistence_unconfirmed",
  "execution_context_mismatch",
  "candidate_invalid",
  "gate_closed",
  "send_gate_blocked",
  "tool_failed",
  "runtime_failed",
  "recorder_failed"
] as const;
export type AiQualityReasonCode = (typeof AI_QUALITY_REASON_CODES)[number];

export type AiQualitySeverity = "info" | "warning" | "error" | "critical";
export type AiModelProvider = "openai" | "fake" | "policy" | "none";
export type AiConfiguredModelProvider = Exclude<AiModelProvider, "policy">;
export type AiReasoningEffort = "none" | "low" | "medium" | "high";

/**
 * Values in this object come only from app configuration/constants. They are never copied from
 * a model response, prompt, provider payload or arbitrary message metadata.
 */
export type AiRunVersions = {
  policyVersion: string;
  promptVersion: string;
  toolVersion: string;
  assetVersion?: string;
  toneVersion?: string;
  factsVersion?: string;
  disclosureVersion: string;
  modelProfileVersion: string;
  runtimeVersion?: string;
};

export type AiRunModelConfig = {
  /** Immutable app configuration/request truth captured before generation starts. */
  modelProvider: AiConfiguredModelProvider;
  requestedModelName: string;
  reasoningEffort: AiReasoningEffort;
};

export type AiRunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AiRunSpanWrite = {
  spanId: string;
  parentSpanId?: string;
  kind: AiRunSpanKind;
  name: AiRunSpanName;
  status: AiRunSpanStatus;
  latencyMs: number;
  errorCode?: AiRunSpanErrorCode;
  usedInFinalAnswer?: boolean;
  toolVersion?: string;
};

export type AiQualityEventWrite = {
  eventType: AiQualityEventType;
  reasonCode: AiQualityReasonCode;
  severity: AiQualitySeverity;
  managerVisible: true;
};

export type BeginAiRunInput = {
  traceId: string;
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
  channel: "site_widget";
  runtimeMode: AiRunRuntimeMode;
  decisionProfile: AiRunDecisionProfile;
  idempotencyKey: string;
  inputFingerprint: string;
  versions: AiRunVersions;
  model: AiRunModelConfig;
  startedAt: Date;
};

export type RunningAiRunRecord = BeginAiRunInput & {
  id: string;
  status: "running";
};

export type AiRunTerminalCompletion = {
  status: AiRunTerminalStatus;
  normalizedAction: AiRunNormalizedAction;
  outcomeReason: AiRunOutcomeReason;
  failureCode?: AiRunFailureCode;
  validatorResult: AiRunValidatorResult;
  /**
   * Terminal provider truth captured by an app-owned adapter boundary. This is deliberately
   * separate from `run.model`, which remains the immutable configured/requested model truth.
   */
  observedModelProvider: AiModelProvider;
  observedModelName?: string;
  usage?: AiRunUsage;
  sendGateResult: AiRunSendGateResult;
  sendGateCheckedAt?: Date;
  completedAt: Date;
  latencyMs: number;
  spans: AiRunSpanWrite[];
  qualityEvents: AiQualityEventWrite[];
};

export type TerminalAiRunRecord = Omit<RunningAiRunRecord, "status"> &
  AiRunTerminalCompletion & {
    outboundMessageId?: string;
  };

export type BeginAiRunResult =
  | { kind: "started"; run: RunningAiRunRecord }
  | { kind: "running_replay"; run: RunningAiRunRecord }
  | { kind: "terminal_replay"; run: TerminalAiRunRecord };

/**
 * The repository is intentionally narrow. Reply-bearing completion is owned by the conversation
 * repository transaction so outbound persistence and terminal run linkage cannot diverge.
 */
export interface AiRunRepository {
  beginOrReplay(input: BeginAiRunInput): Promise<BeginAiRunResult>;

  completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord>;
}
