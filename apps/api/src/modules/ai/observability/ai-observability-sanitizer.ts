import {
  AI_QUALITY_EVENT_TYPES,
  AI_QUALITY_REASON_CODES,
  AI_RUN_DECISION_PROFILES,
  AI_RUN_FAILURE_CODES,
  AI_RUN_NORMALIZED_ACTIONS,
  AI_RUN_OUTCOME_REASONS,
  AI_RUN_RUNTIME_MODES,
  AI_RUN_SEND_GATE_RESULTS,
  AI_RUN_SPAN_ERROR_CODES,
  AI_RUN_SPAN_KINDS,
  AI_RUN_SPAN_NAMES,
  AI_RUN_SPAN_STATUSES,
  AI_RUN_STATUSES,
  AI_RUN_VALIDATOR_RESULTS,
  type AiQualityEventWrite,
  type AiRunSpanWrite,
  type AiRunTerminalCompletion,
  type AiRunVersions,
  type BeginAiRunInput
} from "../repositories/ai-run-repository.js";
import { AI_VALIDATOR_FAILURE_CODES } from "./ai-validator-failure-code.js";

const AI_CONFIGURED_MODEL_PROVIDERS = ["openai", "fake", "none"] as const;
const AI_MODEL_PROVIDERS = ["openai", "fake", "policy", "none"] as const;
const AI_REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
const AI_QUALITY_SEVERITIES = ["info", "warning", "error", "critical"] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:/@+-]+$/;
const SAFE_MODEL_NAME = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const HEX_FINGERPRINT = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_RUN_IDEMPOTENCY_KEY =
  /^(?:ai-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::attempt:[1-9][0-9]{0,9})?|ai-window:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:0|[1-9][0-9]{0,15}):[1-9][0-9]{0,15}:(?:direct_openai|mastra_openai_api)(?::attempt:[1-9][0-9]{0,9})?)$/i;
const SENSITIVE_VALUE =
  /(?:^|[^a-z0-9])(?:sk-[a-z0-9_-]{8,}|bearer\s+|postgres(?:ql)?:\/\/|api[_-]?key|authorization)(?:$|[^a-z0-9])/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const LEGACY_ALLOWED_AI_METADATA_KEYS = new Set([
  "ai_decision_version",
  "ai_disclosure_shown",
  "ai_disclosure_version",
  "ai_input_fingerprint",
  "applied_patch_count",
  "catalog_content_hash",
  "catalog_references",
  "catalog_schema_version",
  "catalog_version",
  "channel",
  "claim_coverage_complete",
  "claim_verdict_count",
  "error_type",
  "fallback_mode",
  "generator_usage",
  "grounding_verified",
  "handoff_reason",
  "deterministic_policy_version",
  "fallback_reason",
  "final_text_hash",
  "inbound_public_message_id",
  "knowledge_version",
  "latency_ms",
  "model_name",
  "model_provider",
  "openai_response_id",
  "policy_version",
  "plan_normalization_reason",
  "plan_normalized",
  "plan_original_action",
  "plan_original_intent",
  "plan_original_requested_slots",
  "planner_source",
  "policy_reason",
  "prompt_version",
  "public_session_id",
  "queue_wait_ms",
  "repair_applied",
  "response_window_epoch",
  "responds_through_sequence",
  "dropped_patch_count",
  "dropped_recommendation_count",
  "requirement_verdict_count",
  "render_reason",
  "reply_renderer",
  "safe_handoff_reply",
  "slot_verdict_count",
  "turn_contract",
  "verifier_contract_issues",
  "verifier_model_name",
  "verifier_response_id",
  "verifier_usage",
  "verifier_verdict",
  "verifier_version",
  "verifier_violations"
]);
const BOUNDED_OPERATIONAL_INTEGER_METADATA = new Map([
  ["applied_patch_count", 0],
  ["dropped_patch_count", 0],
  ["dropped_recommendation_count", 0],
  ["queue_wait_ms", 0],
  ["response_window_epoch", 0],
  ["responds_through_sequence", 1]
] as const);

export class AiObservabilitySanitizationError extends Error {
  constructor() {
    super("AI observability evidence did not match the storage allowlist");
    this.name = "AiObservabilitySanitizationError";
  }
}

export function sanitizeAiObservabilityMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!LEGACY_ALLOWED_AI_METADATA_KEYS.has(key)) {
      continue;
    }

    const minimumInteger = BOUNDED_OPERATIONAL_INTEGER_METADATA.get(
      key as
        | "applied_patch_count"
        | "dropped_patch_count"
        | "dropped_recommendation_count"
        | "queue_wait_ms"
        | "response_window_epoch"
        | "responds_through_sequence"
    );
    if (minimumInteger !== undefined) {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= minimumInteger &&
        value <= POSTGRES_INTEGER_MAX
      ) {
        sanitized[key] = value;
      }
      continue;
    }

    const safeValue = sanitizeLegacyMetadataValue(value, 0);

    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }

  return sanitized;
}

/**
 * Rebuilds a run-start record from the storage allowlist. Unknown properties are deliberately
 * omitted, dates and nested objects are copied, and invalid controlled values fail closed.
 */
export function sanitizeAiRunStart(value: unknown): BeginAiRunInput {
  const input = record(value);
  const versions = sanitizeVersions(input.versions);
  const model = record(input.model);

  return {
    traceId: uuid(input.traceId),
    leadId: uuid(input.leadId),
    conversationId: uuid(input.conversationId),
    inboundMessageId: uuid(input.inboundMessageId),
    channel: literal(input.channel, "site_widget"),
    runtimeMode: enumValue(AI_RUN_RUNTIME_MODES, input.runtimeMode),
    decisionProfile: enumValue(AI_RUN_DECISION_PROFILES, input.decisionProfile),
    idempotencyKey: aiRunIdempotencyKey(input.idempotencyKey),
    attemptIdempotencyKey: aiRunIdempotencyKey(input.attemptIdempotencyKey),
    attemptNumber: positiveCount(input.attemptNumber),
    ...(input.jobId === undefined ? {} : { jobId: uuid(input.jobId) }),
    jobAttemptCount: positiveCount(input.jobAttemptCount),
    ...(input.maxAttempts === undefined ? {} : { maxAttempts: positiveCount(input.maxAttempts) }),
    inputFingerprint: fingerprint(input.inputFingerprint),
    versions,
    model: {
      modelProvider: enumValue(AI_CONFIGURED_MODEL_PROVIDERS, model.modelProvider),
      requestedModelName: safeModelName(model.requestedModelName),
      reasoningEffort: enumValue(AI_REASONING_EFFORTS, model.reasoningEffort)
    },
    startedAt: date(input.startedAt)
  };
}

/** Rebuilds terminal run evidence, spans and quality events from one centralized allowlist. */
export function sanitizeAiRunCompletion(value: unknown): AiRunTerminalCompletion {
  const input = record(value);
  const status = enumValue(
    AI_RUN_STATUSES.filter((candidate) => candidate !== "running"),
    input.status
  ) as AiRunTerminalCompletion["status"];
  const normalizedAction = enumValue(AI_RUN_NORMALIZED_ACTIONS, input.normalizedAction);
  const outcomeReason = enumValue(AI_RUN_OUTCOME_REASONS, input.outcomeReason);
  const validatorResult = enumValue(AI_RUN_VALIDATOR_RESULTS, input.validatorResult);
  const runtimeRunId = optional(input.runtimeRunId, runtimeRunIdentifier);
  const observedModelProvider = enumValue(AI_MODEL_PROVIDERS, input.observedModelProvider);
  const observedModelName = optional(input.observedModelName, safeModelName);
  const usage = input.usage === undefined ? undefined : sanitizeUsage(input.usage);
  const costEstimateMicrounits = optional(input.costEstimateMicrounits, count);
  const costRateVersion = optional(input.costRateVersion, costRateIdentifier);
  const sendGateCheckedAt = optional(input.sendGateCheckedAt, date);
  const failureCode = optional(input.failureCode, (candidate) =>
    enumValue(AI_RUN_FAILURE_CODES, candidate)
  );
  const validatorFailureCode = optional(input.validatorFailureCode, (candidate) =>
    enumValue(AI_VALIDATOR_FAILURE_CODES, candidate)
  );

  if ((observedModelProvider === "none") !== (observedModelName === undefined)) {
    throw new AiObservabilitySanitizationError();
  }

  if ((costEstimateMicrounits === undefined) !== (costRateVersion === undefined)) {
    throw new AiObservabilitySanitizationError();
  }

  if (
    validatorFailureCode !== undefined &&
    (status !== "blocked" ||
      normalizedAction !== "no_reply" ||
      outcomeReason !== "candidate_invalid" ||
      failureCode !== "invalid_candidate" ||
      validatorResult !== "rejected")
  ) {
    throw new AiObservabilitySanitizationError();
  }

  if (!Array.isArray(input.spans) || !Array.isArray(input.qualityEvents)) {
    throw new AiObservabilitySanitizationError();
  }

  return {
    status,
    normalizedAction,
    outcomeReason,
    ...(failureCode === undefined ? {} : { failureCode }),
    validatorResult,
    ...(validatorFailureCode === undefined ? {} : { validatorFailureCode }),
    ...(runtimeRunId === undefined ? {} : { runtimeRunId }),
    observedModelProvider,
    ...(observedModelName === undefined ? {} : { observedModelName }),
    ...(usage === undefined ? {} : { usage }),
    ...(costEstimateMicrounits === undefined || costRateVersion === undefined
      ? {}
      : { costEstimateMicrounits, costRateVersion }),
    sendGateResult: enumValue(AI_RUN_SEND_GATE_RESULTS, input.sendGateResult),
    ...(sendGateCheckedAt === undefined ? {} : { sendGateCheckedAt }),
    completedAt: date(input.completedAt),
    latencyMs: count(input.latencyMs),
    spans: input.spans.map(sanitizeSpan),
    qualityEvents: input.qualityEvents.map(sanitizeQualityEvent)
  };
}

export type SanitizedAiRunEvidenceExport = {
  start: BeginAiRunInput;
  completion?: AiRunTerminalCompletion;
};

/** Future export adapters must use the same storage projection instead of serializing run input. */
export function sanitizeAiRunEvidenceForExport(value: unknown): SanitizedAiRunEvidenceExport {
  const input = record(value);
  const completion =
    input.completion === undefined ? undefined : sanitizeAiRunCompletion(input.completion);

  return {
    start: sanitizeAiRunStart(input.start),
    ...(completion === undefined ? {} : { completion })
  };
}

function sanitizeVersions(value: unknown): AiRunVersions {
  const input = record(value);
  const assetVersion = optional(input.assetVersion, version);
  const toneVersion = optional(input.toneVersion, version);
  const factsVersion = optional(input.factsVersion, version);
  const runtimeVersion = optional(input.runtimeVersion, version);

  return {
    policyVersion: version(input.policyVersion),
    promptVersion: version(input.promptVersion),
    toolVersion: version(input.toolVersion),
    ...(assetVersion === undefined ? {} : { assetVersion }),
    ...(toneVersion === undefined ? {} : { toneVersion }),
    ...(factsVersion === undefined ? {} : { factsVersion }),
    disclosureVersion: version(input.disclosureVersion),
    modelProfileVersion: version(input.modelProfileVersion),
    ...(runtimeVersion === undefined ? {} : { runtimeVersion })
  };
}

function sanitizeUsage(value: unknown) {
  const input = record(value);
  const inputTokens = optional(input.inputTokens, count);
  const outputTokens = optional(input.outputTokens, count);
  const totalTokens = optional(input.totalTokens, count);

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens })
  };
}

function sanitizeSpan(value: unknown): AiRunSpanWrite {
  const input = record(value);
  const parentSpanId = optional(input.parentSpanId, evidenceIdentifier);
  const errorCode = optional(input.errorCode, (candidate) =>
    enumValue(AI_RUN_SPAN_ERROR_CODES, candidate)
  );
  const usedInFinalAnswer = optional(input.usedInFinalAnswer, boolean);
  const toolVersion = optional(input.toolVersion, version);

  return {
    spanId: evidenceIdentifier(input.spanId),
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    kind: enumValue(AI_RUN_SPAN_KINDS, input.kind),
    name: enumValue(AI_RUN_SPAN_NAMES, input.name),
    status: enumValue(AI_RUN_SPAN_STATUSES, input.status),
    latencyMs: count(input.latencyMs),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(usedInFinalAnswer === undefined ? {} : { usedInFinalAnswer }),
    ...(toolVersion === undefined ? {} : { toolVersion })
  };
}

function sanitizeQualityEvent(value: unknown): AiQualityEventWrite {
  const input = record(value);

  return {
    eventType: enumValue(AI_QUALITY_EVENT_TYPES, input.eventType),
    reasonCode: enumValue(AI_QUALITY_REASON_CODES, input.reasonCode),
    severity: enumValue(AI_QUALITY_SEVERITIES, input.severity),
    managerVisible: literal(input.managerVisible, true)
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AiObservabilitySanitizationError();
  }

  return value as Record<string, unknown>;
}

function optional<T>(value: unknown, parse: (candidate: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: unknown
): Values[number] {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new AiObservabilitySanitizationError();
  }

  return value as Values[number];
}

function literal<const Value extends string | boolean>(value: unknown, expected: Value): Value {
  if (value !== expected) {
    throw new AiObservabilitySanitizationError();
  }

  return expected;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new AiObservabilitySanitizationError();
  }

  return value;
}

function fingerprint(value: unknown): string {
  if (typeof value !== "string" || !HEX_FINGERPRINT.test(value)) {
    throw new AiObservabilitySanitizationError();
  }

  return value;
}

function aiRunIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !AI_RUN_IDEMPOTENCY_KEY.test(value)) {
    throw new AiObservabilitySanitizationError();
  }
  return value;
}

function evidenceIdentifier(value: unknown): string {
  const parsed = safeIdentifier(value, 160);
  // Production span IDs are UUIDs. Short deterministic test/local IDs remain supported, but
  // secret-, email- and phone-shaped data must never pass an allowlisted identifier boundary.
  if (!UUID.test(parsed) && sensitive(parsed)) {
    throw new AiObservabilitySanitizationError();
  }
  return parsed;
}

function runtimeRunIdentifier(value: unknown): string {
  const parsed = safeIdentifier(value, 200);
  if (!UUID.test(parsed) && sensitive(parsed)) {
    throw new AiObservabilitySanitizationError();
  }
  return parsed;
}

function costRateIdentifier(value: unknown): string {
  const parsed = safeIdentifier(value, 160);
  if (sensitive(parsed)) {
    throw new AiObservabilitySanitizationError();
  }
  return parsed;
}

function safeIdentifier(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    !SAFE_IDENTIFIER.test(value)
  ) {
    throw new AiObservabilitySanitizationError();
  }

  return value;
}

function version(value: unknown): string {
  const parsed = safeIdentifier(value, 160);
  if (!parsed.includes(".") || sensitive(parsed)) {
    throw new AiObservabilitySanitizationError();
  }
  return parsed;
}

function safeModelName(value: unknown): string {
  if (typeof value !== "string" || !SAFE_MODEL_NAME.test(value) || sensitive(value)) {
    throw new AiObservabilitySanitizationError();
  }
  return value;
}

function sensitive(value: string): boolean {
  return (
    SENSITIVE_VALUE.test(value) ||
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ||
    /\d{7,}/.test(value) ||
    /[\r\n\t]/.test(value)
  );
}

function date(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AiObservabilitySanitizationError();
  }
  return new Date(value.getTime());
}

function count(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > POSTGRES_INTEGER_MAX
  ) {
    throw new AiObservabilitySanitizationError();
  }
  return value;
}

function positiveCount(value: unknown): number {
  const sanitized = count(value);
  if (sanitized < 1) {
    throw new AiObservabilitySanitizationError();
  }
  return sanitized;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AiObservabilitySanitizationError();
  }
  return value;
}

function sanitizeLegacyMetadataValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return isSafeLegacyMetadataString(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    if (depth >= 3) {
      return undefined;
    }

    return value
      .slice(0, 50)
      .map((item) => sanitizeLegacyMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object" && value) {
    if (depth >= 3) {
      return undefined;
    }

    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key) || sensitive(key)) {
        continue;
      }

      const safeValue = sanitizeLegacyMetadataValue(nestedValue, depth + 1);

      if (safeValue !== undefined) {
        sanitized[key] = safeValue;
      }
    }

    return sanitized;
  }

  return undefined;
}

function isSafeLegacyMetadataString(value: string): boolean {
  return UUID.test(value) || (value.length <= 500 && !sensitive(value));
}
