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

const AI_CONFIGURED_MODEL_PROVIDERS = ["openai", "fake", "none"] as const;
const AI_MODEL_PROVIDERS = ["openai", "fake", "policy", "none"] as const;
const AI_REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
const AI_QUALITY_SEVERITIES = ["info", "warning", "error", "critical"] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:/@+-]+$/;
const SAFE_MODEL_NAME = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const HEX_FINGERPRINT = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AI_RUN_IDEMPOTENCY_KEY =
  /^ai-turn:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_VALUE =
  /(?:^|[^a-z0-9])(?:sk-[a-z0-9_-]{8,}|bearer\s+|postgres(?:ql)?:\/\/|api[_-]?key|authorization)(?:$|[^a-z0-9])/i;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class AiObservabilitySanitizationError extends Error {
  constructor() {
    super("AI observability evidence did not match the storage allowlist");
    this.name = "AiObservabilitySanitizationError";
  }
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
  const observedModelProvider = enumValue(AI_MODEL_PROVIDERS, input.observedModelProvider);
  const observedModelName = optional(input.observedModelName, safeModelName);
  const usage = input.usage === undefined ? undefined : sanitizeUsage(input.usage);
  const sendGateCheckedAt = optional(input.sendGateCheckedAt, date);
  const failureCode = optional(input.failureCode, (candidate) =>
    enumValue(AI_RUN_FAILURE_CODES, candidate)
  );

  if ((observedModelProvider === "none") !== (observedModelName === undefined)) {
    throw new AiObservabilitySanitizationError();
  }

  if (!Array.isArray(input.spans) || !Array.isArray(input.qualityEvents)) {
    throw new AiObservabilitySanitizationError();
  }

  return {
    status: enumValue(
      AI_RUN_STATUSES.filter((status) => status !== "running"),
      input.status
    ) as AiRunTerminalCompletion["status"],
    normalizedAction: enumValue(AI_RUN_NORMALIZED_ACTIONS, input.normalizedAction),
    outcomeReason: enumValue(AI_RUN_OUTCOME_REASONS, input.outcomeReason),
    ...(failureCode === undefined ? {} : { failureCode }),
    validatorResult: enumValue(AI_RUN_VALIDATOR_RESULTS, input.validatorResult),
    observedModelProvider,
    ...(observedModelName === undefined ? {} : { observedModelName }),
    ...(usage === undefined ? {} : { usage }),
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

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new AiObservabilitySanitizationError();
  }
  return value;
}
