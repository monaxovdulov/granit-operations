import type { AiUnavailableReason } from "../ai-turn.js";
import type { LegacyS05MappedDecision } from "../profiles/legacy-s05/legacy-s05-decision.js";
import type {
  AiModelProvider,
  AiQualityEventWrite,
  AiRunOutcomeReason,
  AiRunSpanErrorCode,
  AiRunSpanKind,
  AiRunSpanName,
  AiRunTerminalCompletion,
  AiRunTerminalStatus,
  AiRunValidatorResult,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";

type LegacyS05Provider = AiModelProvider;
type LegacyS05ReplyAction = "answer" | "handoff_to_manager";

export type LegacyS05TerminalState = Pick<
  AiRunTerminalCompletion,
  | "status"
  | "normalizedAction"
  | "outcomeReason"
  | "failureCode"
  | "validatorResult"
  | "observedModelProvider"
  | "sendGateResult"
  | "qualityEvents"
>;

export function legacyS05GeneratorSpanDescriptor(
  provider: LegacyS05Provider
): { kind: AiRunSpanKind; name: AiRunSpanName } {
  switch (provider) {
    case "openai":
      return { kind: "model", name: "model_generation" };
    case "fake":
      return { kind: "model", name: "model_generation" };
    case "policy":
      return { kind: "runtime", name: "decision_generation" };
    default:
      return { kind: "runtime", name: "decision_generation" };
  }
}

export function legacyS05NoReplyGeneratorSpan(
  decision: Extract<LegacyS05MappedDecision, { action: "no_reply" }>,
  observedProvider: AiModelProvider = "none"
): {
  kind: AiRunSpanKind;
  name: AiRunSpanName;
  status: "succeeded" | "failed" | "skipped";
  errorCode?: AiRunSpanErrorCode;
} {
  if (decision.reason === "missing_openai_config") {
    return {
      kind: "model",
      name: "model_generation",
      status: "skipped",
      errorCode: "provider_unavailable"
    };
  }

  if (decision.reason === "model_error") {
    return {
      kind: "model",
      name: "model_generation",
      status: "failed",
      errorCode: "model_error"
    };
  }

  return {
    ...legacyS05GeneratorSpanDescriptor(observedProvider),
    status: "succeeded"
  };
}

export function legacyS05NoReplyState(
  decision: Extract<LegacyS05MappedDecision, { action: "no_reply" }>,
  observation: {
    observedProvider: AiModelProvider;
    executionContextMismatch: boolean;
  } = { observedProvider: "none", executionContextMismatch: false }
): LegacyS05TerminalState {
  if (observation.executionContextMismatch) {
    return terminalState({
      status: "blocked",
      outcomeReason: "execution_context_mismatch",
      failureCode: "execution_context_mismatch",
      validatorResult: "failed",
      observedModelProvider: "none",
      qualityEvent: event("policy_violation", "execution_context_mismatch", "critical")
    });
  }

  switch (decision.reason) {
    case "missing_openai_config":
      return terminalState({
        status: "fallback_unavailable",
        outcomeReason: "missing_provider_config",
        failureCode: "provider_unavailable",
        validatorResult: "not_run",
        observedModelProvider: "none",
        qualityEvent: event("degradation", "missing_openai_config", "warning")
      });
    case "model_error":
      return terminalState({
        status: "fallback_unavailable",
        outcomeReason: "model_error",
        failureCode: "model_failure",
        validatorResult: "not_run",
        observedModelProvider: observation.observedProvider,
        qualityEvent: event("model_failure", "model_error", "critical")
      });
    case "empty_model_response":
      return terminalState({
        status: "fallback_unavailable",
        outcomeReason: "empty_model_response",
        failureCode: "invalid_candidate",
        validatorResult: "rejected",
        observedModelProvider: observation.observedProvider,
        qualityEvent: event("degradation", "empty_model_response", "warning")
      });
    case "unsafe_model_response":
      return terminalState({
        status: "blocked",
        outcomeReason: "unsafe_model_response",
        failureCode: "policy_violation",
        validatorResult: "rejected",
        observedModelProvider: observation.observedProvider,
        qualityEvent: event("policy_violation", "unsafe_model_response", "critical")
      });
  }
}

export function legacyS05AllowedReplyState(
  action: LegacyS05ReplyAction,
  observedModelProvider: AiModelProvider
): LegacyS05TerminalState {
  if (action === "handoff_to_manager") {
    return {
      status: "handed_off",
      normalizedAction: action,
      outcomeReason: "handoff_to_manager",
      validatorResult: "passed",
      observedModelProvider,
      sendGateResult: "allowed",
      qualityEvents: [event("handoff", "handoff_to_manager", "info")]
    };
  }

  return {
    status: "persisted",
    normalizedAction: action,
    outcomeReason: "reply_persisted",
    validatorResult: "passed",
    observedModelProvider,
    sendGateResult: "allowed",
    qualityEvents: []
  };
}

export function legacyS05AgentReplyBlockedState(
  action: LegacyS05ReplyAction,
  observedModelProvider: AiModelProvider
): LegacyS05TerminalState {
  return {
    status: "blocked",
    normalizedAction: action,
    outcomeReason: "agent_reply_blocked",
    failureCode: "send_gate_blocked",
    validatorResult: "passed",
    observedModelProvider,
    sendGateResult: "blocked",
    qualityEvents: [event("blocked", "agent_reply_blocked", "warning")]
  };
}

export function legacyS05PersistenceUnconfirmedState(
  action: LegacyS05ReplyAction,
  observedModelProvider: AiModelProvider
): LegacyS05TerminalState {
  return {
    status: "failed",
    normalizedAction: action,
    outcomeReason: "ai_persistence_unconfirmed",
    failureCode: "persistence_failure",
    validatorResult: "passed",
    observedModelProvider,
    sendGateResult: "not_checked",
    qualityEvents: [event("runtime_failure", "ai_persistence_unconfirmed", "critical")]
  };
}

export function legacyS05ExecutionFailedState(): LegacyS05TerminalState {
  return {
    status: "failed",
    normalizedAction: "no_reply",
    outcomeReason: "generator_failed",
    failureCode: "runtime_failure",
    validatorResult: "not_run",
    observedModelProvider: "none",
    sendGateResult: "not_checked",
    qualityEvents: [event("runtime_failure", "runtime_failed", "critical")]
  };
}

export function legacyS05ValidationSpanError(
  state: LegacyS05TerminalState
): AiRunSpanErrorCode | undefined {
  if (state.outcomeReason === "empty_model_response") return "empty_model_response";
  if (state.outcomeReason === "unsafe_model_response") return "unsafe_model_response";
  if (state.validatorResult === "rejected" || state.validatorResult === "failed") {
    return "validation_failed";
  }
  return undefined;
}

export type LegacyS05ReplayDisposition =
  | { kind: "pending" }
  | { kind: "reuse_outbound" }
  | {
      kind: "fallback";
      reason: AiUnavailableReason | "agent_reply_blocked" | "ai_persistence_unconfirmed";
      managerReviewRequired: true;
    };

/** Maps a replay using controlled run columns only; no prompt, transcript or provider payload. */
export function legacyS05ReplayDisposition(
  run: RunningAiRunRecord | TerminalAiRunRecord
): LegacyS05ReplayDisposition {
  if (run.status === "running") {
    return { kind: "pending" };
  }

  if (run.status === "persisted" || run.status === "handed_off") {
    return { kind: "reuse_outbound" };
  }

  const reason =
    run.outcomeReason === "missing_provider_config"
      ? ("missing_openai_config" as const)
      : run.outcomeReason === "model_error"
        ? ("model_error" as const)
        : run.outcomeReason === "empty_model_response"
          ? ("empty_model_response" as const)
          : run.outcomeReason === "agent_reply_blocked" || run.outcomeReason === "gate_closed"
            ? ("agent_reply_blocked" as const)
            : run.status === "failed" || run.outcomeReason === "ai_persistence_unconfirmed"
              ? ("ai_persistence_unconfirmed" as const)
              : ("unsafe_model_response" as const);

  return { kind: "fallback", reason, managerReviewRequired: true };
}

function terminalState(input: {
  status: AiRunTerminalStatus;
  outcomeReason: AiRunOutcomeReason;
  failureCode?: LegacyS05TerminalState["failureCode"];
  validatorResult: AiRunValidatorResult;
  observedModelProvider: AiModelProvider;
  qualityEvent: AiQualityEventWrite;
}): LegacyS05TerminalState {
  return {
    status: input.status,
    normalizedAction: "no_reply",
    outcomeReason: input.outcomeReason,
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    validatorResult: input.validatorResult,
    observedModelProvider: input.observedModelProvider,
    sendGateResult: "not_checked",
    qualityEvents: [input.qualityEvent]
  };
}

function event(
  eventType: AiQualityEventWrite["eventType"],
  reasonCode: AiQualityEventWrite["reasonCode"],
  severity: AiQualityEventWrite["severity"]
): AiQualityEventWrite {
  return { eventType, reasonCode, severity, managerVisible: true };
}
