import { randomUUID } from "node:crypto";

import {
  sanitizeAiRunCompletion,
  sanitizeAiRunStart
} from "../observability/ai-observability-sanitizer.js";
import type {
  AiQualityEventWrite,
  AiRunRepository,
  AiRunSpanWrite,
  AiRunTerminalCompletion,
  BeginAiRunInput,
  BeginAiRunResult,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "./ai-run-repository.js";
import {
  AI_QUALITY_EVENT_TYPES,
  AI_QUALITY_REASON_CODES,
  AI_RUN_FAILURE_CODES,
  AI_RUN_NORMALIZED_ACTIONS,
  AI_RUN_OUTCOME_REASONS,
  AI_RUN_SEND_GATE_RESULTS,
  AI_RUN_SPAN_ERROR_CODES,
  AI_RUN_SPAN_KINDS,
  AI_RUN_SPAN_NAMES,
  AI_RUN_SPAN_STATUSES,
  AI_RUN_VALIDATOR_RESULTS
} from "./ai-run-repository.js";

const AI_MODEL_PROVIDERS = ["openai", "fake", "policy", "none"] as const;
const AI_QUALITY_SEVERITIES = ["info", "warning", "error", "critical"] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:/@+-]+$/;
const SAFE_PROVIDER_MODEL_NAME = /^[A-Za-z0-9._:/@+-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MemoryAiRunRepositoryOptions = {
  failBegin?: boolean;
  failCompletion?: boolean;
};

export class MemoryAiRunInputInvariantError extends Error {
  constructor() {
    super("memory AI run runtime mode does not match its decision profile");
    this.name = "MemoryAiRunInputInvariantError";
  }
}

export class MemoryAiRunReplayConflictError extends Error {
  constructor() {
    super("memory AI run replay does not match the accepted turn");
    this.name = "MemoryAiRunReplayConflictError";
  }
}

export class MemoryAiRunCompletionConflictError extends Error {
  constructor() {
    super("memory AI run is not available for terminal completion");
    this.name = "MemoryAiRunCompletionConflictError";
  }
}

/** Deterministic in-process adapter used by focused app tests; never selected by runtime config. */
export class MemoryAiRunRepository implements AiRunRepository {
  private readonly runsByIdempotencyKey = new Map<
    string,
    RunningAiRunRecord | TerminalAiRunRecord
  >();
  private readonly attemptsByRunId = new Map<
    string,
    Array<{
      id: string;
      attemptNumber: number;
      status: "running" | "succeeded" | "failed" | "fenced";
    }>
  >();

  constructor(private readonly options: MemoryAiRunRepositoryOptions = {}) {}

  get runCount(): number {
    return this.runsByIdempotencyKey.size;
  }

  listRuns(): Array<RunningAiRunRecord | TerminalAiRunRecord> {
    return [...this.runsByIdempotencyKey.values()];
  }

  listAttempts(runId?: string) {
    const attempts = runId
      ? (this.attemptsByRunId.get(runId) ?? [])
      : [...this.attemptsByRunId.values()].flat();
    return attempts.map((attempt) => ({ ...attempt }));
  }

  async beginOrReplay(input: BeginAiRunInput): Promise<BeginAiRunResult> {
    const existingUntrustedKey =
      typeof input.idempotencyKey === "string"
        ? this.runsByIdempotencyKey.get(input.idempotencyKey)
        : undefined;
    try {
      input = sanitizeAiRunStart(input);
    } catch {
      if (existingUntrustedKey) {
        throw new MemoryAiRunReplayConflictError();
      }
      throw new MemoryAiRunInputInvariantError();
    }
    assertRuntimeProfilePair(input);

    if (this.options.failBegin) {
      throw new Error("memory AI run begin unavailable");
    }

    const existing = this.runsByIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      assertReplayMatches(existing, input);
      if (existing.status !== "running") {
        return { kind: "terminal_replay", run: existing };
      }
      const attempts = this.attemptsByRunId.get(existing.id) ?? [];
      const sameAttempt = attempts.find((attempt) => attempt.attemptNumber === input.attemptNumber);
      if (sameAttempt) {
        if (
          sameAttempt.status !== "running" ||
          existing.attempt.idempotencyKey !== input.attemptIdempotencyKey ||
          existing.attempt.inputFingerprint !== input.inputFingerprint ||
          existing.attempt.jobId !== input.jobId ||
          existing.attempt.jobAttemptCount !== input.jobAttemptCount ||
          existing.attempt.maxAttempts !== input.maxAttempts ||
          !sameAttemptConfiguration(existing, input)
        ) {
          throw new MemoryAiRunReplayConflictError();
        }
        return { kind: "running_replay", run: existing };
      }
      const latestAttemptNumber = Math.max(...attempts.map((attempt) => attempt.attemptNumber));
      if (input.attemptNumber <= latestAttemptNumber) {
        throw new MemoryAiRunReplayConflictError();
      }
      for (const attempt of attempts) {
        if (attempt.status === "running" && attempt.attemptNumber < input.attemptNumber) {
          attempt.status = "fenced";
        }
      }
      const next = runningRecord(existing.id, input);
      attempts.push({
        id: next.attempt.id,
        attemptNumber: next.attempt.attemptNumber,
        status: "running"
      });
      this.attemptsByRunId.set(existing.id, attempts);
      this.runsByIdempotencyKey.set(input.idempotencyKey, next);
      return { kind: "started", run: next };
    }

    const run = runningRecord(randomUUID(), input);
    this.attemptsByRunId.set(run.id, [
      {
        id: run.attempt.id,
        attemptNumber: run.attempt.attemptNumber,
        status: "running"
      }
    ]);
    this.runsByIdempotencyKey.set(input.idempotencyKey, run);
    return { kind: "started", run };
  }

  async completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord> {
    if (isReplyBearingStatus(input.completion.status)) {
      throw new MemoryAiRunCompletionConflictError();
    }

    return this.complete(input.run, input.completion);
  }

  async failAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    let completion: AiRunTerminalCompletion;
    try {
      completion = sanitizeAiRunCompletion(input.completion);
    } catch {
      throw new MemoryAiRunCompletionConflictError();
    }
    const current = this.assertCompletion(input.run, completion, undefined);
    this.setAttemptStatus(current, "failed");
    if (
      current.attempt.maxAttempts !== undefined &&
      current.attempt.jobAttemptCount >= current.attempt.maxAttempts
    ) {
      this.runsByIdempotencyKey.set(current.idempotencyKey, {
        ...current,
        ...completion,
        status: "failed"
      });
    }
  }

  async fenceAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    let completion: AiRunTerminalCompletion;
    try {
      completion = sanitizeAiRunCompletion(input.completion);
    } catch {
      throw new MemoryAiRunCompletionConflictError();
    }
    const current = this.assertCompletion(input.run, completion, undefined);
    this.setAttemptStatus(current, "fenced");
  }

  completeWithReply(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    outboundMessageId?: string
  ): TerminalAiRunRecord {
    return this.complete(run, completion, outboundMessageId);
  }

  prepareCompletion(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    outboundMessageId?: string
  ): () => TerminalAiRunRecord {
    try {
      completion = sanitizeAiRunCompletion(completion);
    } catch {
      throw new MemoryAiRunCompletionConflictError();
    }
    this.assertCompletion(run, completion, outboundMessageId);

    return () => {
      const current = this.assertCompletion(run, completion, outboundMessageId, true);
      const failedTerminal = completion.status === "failed";
      const terminal: TerminalAiRunRecord = {
        ...current,
        ...completion,
        ...(failedTerminal ? {} : { winningAttemptId: current.attempt.id }),
        ...(outboundMessageId !== undefined ? { outboundMessageId } : {})
      };
      this.setAttemptStatus(current, failedTerminal ? "failed" : "succeeded");
      this.runsByIdempotencyKey.set(run.idempotencyKey, terminal);
      return terminal;
    };
  }

  private complete(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    outboundMessageId?: string
  ): TerminalAiRunRecord {
    return this.prepareCompletion(run, completion, outboundMessageId)();
  }

  private assertCompletion(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    outboundMessageId: string | undefined,
    prepared = false
  ): RunningAiRunRecord {
    if (!prepared && this.options.failCompletion) {
      throw new Error("memory AI run completion unavailable");
    }

    const current = this.runsByIdempotencyKey.get(run.idempotencyKey);
    if (!current || current.status !== "running" || !sameAcceptedRun(current, run)) {
      throw new MemoryAiRunCompletionConflictError();
    }

    assertCompletionShape(current, completion, outboundMessageId);
    return current;
  }

  private setAttemptStatus(run: RunningAiRunRecord, status: "succeeded" | "failed" | "fenced") {
    const attempt = this.attemptsByRunId
      .get(run.id)
      ?.find((candidate) => candidate.id === run.attempt.id);
    if (!attempt || attempt.status !== "running") {
      throw new MemoryAiRunCompletionConflictError();
    }
    attempt.status = status;
  }
}

function runningRecord(id: string, input: BeginAiRunInput): RunningAiRunRecord {
  const attemptId = randomUUID();
  return {
    ...input,
    id,
    status: "running",
    attempt: {
      id: attemptId,
      attemptNumber: input.attemptNumber,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      jobAttemptCount: input.jobAttemptCount,
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      idempotencyKey: input.attemptIdempotencyKey,
      traceId: input.traceId,
      inputFingerprint: input.inputFingerprint,
      startedAt: input.startedAt
    }
  };
}

function assertRuntimeProfilePair(input: BeginAiRunInput): void {
  const validPair =
    (input.runtimeMode === "direct_openai" &&
      (input.decisionProfile === "legacy_s05" || input.decisionProfile === "live_v2")) ||
    (input.runtimeMode === "mastra_openai_api" && input.decisionProfile === "live_v2");
  const validConfiguredModel =
    enumIncludes(["openai", "fake", "none"] as const, input.model.modelProvider) &&
    SAFE_PROVIDER_MODEL_NAME.test(input.model.requestedModelName) &&
    enumIncludes(["none", "low", "medium", "high"] as const, input.model.reasoningEffort);
  const validAttemptIdentity =
    Number.isInteger(input.attemptNumber) &&
    input.attemptNumber > 0 &&
    input.attemptNumber === input.jobAttemptCount &&
    (input.maxAttempts === undefined || input.maxAttempts >= input.jobAttemptCount) &&
    input.attemptIdempotencyKey.endsWith(`:attempt:${input.attemptNumber}`);

  if (!validPair || !validConfiguredModel || !validAttemptIdentity) {
    throw new MemoryAiRunInputInvariantError();
  }
}

function assertReplayMatches(
  existing: RunningAiRunRecord | TerminalAiRunRecord,
  input: BeginAiRunInput
): void {
  if (
    existing.idempotencyKey !== input.idempotencyKey ||
    existing.leadId !== input.leadId ||
    existing.conversationId !== input.conversationId ||
    existing.inboundMessageId !== input.inboundMessageId ||
    existing.channel !== input.channel ||
    existing.runtimeMode !== input.runtimeMode ||
    existing.decisionProfile !== input.decisionProfile ||
    existing.inputFingerprint !== input.inputFingerprint
  ) {
    throw new MemoryAiRunReplayConflictError();
  }
}

function sameAttemptConfiguration(
  existing: RunningAiRunRecord,
  input: BeginAiRunInput
): boolean {
  return (
    existing.versions.policyVersion === input.versions.policyVersion &&
    existing.versions.promptVersion === input.versions.promptVersion &&
    existing.versions.toolVersion === input.versions.toolVersion &&
    existing.versions.assetVersion === input.versions.assetVersion &&
    existing.versions.toneVersion === input.versions.toneVersion &&
    existing.versions.factsVersion === input.versions.factsVersion &&
    existing.versions.disclosureVersion === input.versions.disclosureVersion &&
    existing.versions.modelProfileVersion === input.versions.modelProfileVersion &&
    existing.versions.runtimeVersion === input.versions.runtimeVersion &&
    existing.model.modelProvider === input.model.modelProvider &&
    existing.model.requestedModelName === input.model.requestedModelName &&
    existing.model.reasoningEffort === input.model.reasoningEffort
  );
}

function sameAcceptedRun(current: RunningAiRunRecord, candidate: RunningAiRunRecord): boolean {
  return (
    current.id === candidate.id &&
    current.traceId === candidate.traceId &&
    current.leadId === candidate.leadId &&
    current.conversationId === candidate.conversationId &&
    current.inboundMessageId === candidate.inboundMessageId &&
    current.channel === candidate.channel &&
    current.runtimeMode === candidate.runtimeMode &&
    current.decisionProfile === candidate.decisionProfile &&
    current.idempotencyKey === candidate.idempotencyKey &&
    current.inputFingerprint === candidate.inputFingerprint
  );
}

function assertCompletionShape(
  run: RunningAiRunRecord,
  completion: AiRunTerminalCompletion,
  outboundMessageId: string | undefined
): void {
  enumValue(
    ["persisted", "handed_off", "blocked", "fallback_unavailable", "failed"],
    completion.status
  );
  enumValue(AI_RUN_NORMALIZED_ACTIONS, completion.normalizedAction);
  enumValue(AI_RUN_OUTCOME_REASONS, completion.outcomeReason);
  enumValue(AI_RUN_VALIDATOR_RESULTS, completion.validatorResult);
  enumValue(AI_MODEL_PROVIDERS, completion.observedModelProvider);
  enumValue(AI_RUN_SEND_GATE_RESULTS, completion.sendGateResult);
  if (completion.failureCode !== undefined) {
    enumValue(AI_RUN_FAILURE_CODES, completion.failureCode);
  }

  const replyBearing = isReplyBearingStatus(completion.status);
  const hasOutboundMessage = outboundMessageId !== undefined;
  const successful = completion.status === "persisted" || completion.status === "handed_off";
  const controlledNoReply =
    completion.status === "fallback_unavailable" &&
    completion.normalizedAction === "no_reply" &&
    (completion.outcomeReason === "no_safe_answer" ||
      completion.outcomeReason === "missing_approved_fact");

  if (
    replyBearing !== hasOutboundMessage ||
    (outboundMessageId !== undefined && !UUID.test(outboundMessageId)) ||
    (successful || controlledNoReply) === (completion.failureCode !== undefined) ||
    !terminalActionMatches(completion) ||
    (completion.sendGateResult === "not_checked") !==
      (completion.sendGateCheckedAt === undefined) ||
    (completion.sendGateResult === "allowed") !== replyBearing ||
    (completion.sendGateResult === "blocked" && completion.status !== "blocked") ||
    !validDate(completion.completedAt) ||
    completion.completedAt < run.startedAt ||
    (completion.sendGateCheckedAt !== undefined && !validDate(completion.sendGateCheckedAt))
  ) {
    throw new MemoryAiRunCompletionConflictError();
  }

  checkedNonNegativeInteger(completion.latencyMs);
  checkedOptionalCount(completion.usage?.inputTokens);
  checkedOptionalCount(completion.usage?.outputTokens);
  checkedOptionalCount(completion.usage?.totalTokens);

  if (
    completion.runtimeRunId !== undefined &&
    (run.decisionProfile !== "live_v2" || !safeIdentifier(completion.runtimeRunId, 200))
  ) {
    throw new MemoryAiRunCompletionConflictError();
  }

  if (
    (completion.costEstimateMicrounits === undefined) !==
      (completion.costRateVersion === undefined) ||
    (completion.costRateVersion !== undefined && !safeIdentifier(completion.costRateVersion, 160))
  ) {
    throw new MemoryAiRunCompletionConflictError();
  }
  checkedOptionalCount(completion.costEstimateMicrounits);

  if (
    completion.observedModelName !== undefined &&
    !SAFE_PROVIDER_MODEL_NAME.test(completion.observedModelName)
  ) {
    throw new MemoryAiRunCompletionConflictError();
  }

  if (
    (completion.observedModelProvider === "none") !==
    (completion.observedModelName === undefined)
  ) {
    throw new MemoryAiRunCompletionConflictError();
  }

  if (!Array.isArray(completion.spans) || !Array.isArray(completion.qualityEvents)) {
    throw new MemoryAiRunCompletionConflictError();
  }

  assertTerminalSpans(completion.spans);
  assertQualityEvents(completion.qualityEvents);
}

function terminalActionMatches(completion: AiRunTerminalCompletion): boolean {
  switch (completion.status) {
    case "persisted":
      return (
        completion.normalizedAction === "answer" ||
        completion.normalizedAction === "ask_clarifying_question"
      );
    case "handed_off":
      return completion.normalizedAction === "handoff_to_manager";
    case "fallback_unavailable":
      return completion.normalizedAction === "no_reply";
    case "blocked":
    case "failed":
      return true;
  }
}

function assertTerminalSpans(spans: AiRunSpanWrite[]): void {
  const spanIds = new Set<string>();

  for (const span of spans) {
    enumValue(AI_RUN_SPAN_KINDS, span.kind);
    enumValue(AI_RUN_SPAN_NAMES, span.name);
    enumValue(AI_RUN_SPAN_STATUSES, span.status);
    if (span.errorCode !== undefined) {
      enumValue(AI_RUN_SPAN_ERROR_CODES, span.errorCode);
    }

    if (
      spanIds.has(span.spanId) ||
      span.status === "running" ||
      !safeIdentifier(span.spanId, 160) ||
      (span.parentSpanId !== undefined && !safeIdentifier(span.parentSpanId, 160)) ||
      (span.toolVersion !== undefined &&
        (span.toolVersion.length < 1 || span.toolVersion.length > 160)) ||
      (span.usedInFinalAnswer !== undefined && typeof span.usedInFinalAnswer !== "boolean")
    ) {
      throw new MemoryAiRunCompletionConflictError();
    }

    spanIds.add(span.spanId);
    checkedNonNegativeInteger(span.latencyMs);
  }
}

function assertQualityEvents(events: AiQualityEventWrite[]): void {
  for (const event of events) {
    enumValue(AI_QUALITY_EVENT_TYPES, event.eventType);
    enumValue(AI_QUALITY_REASON_CODES, event.reasonCode);
    enumValue(AI_QUALITY_SEVERITIES, event.severity);
    if (event.managerVisible !== true) {
      throw new MemoryAiRunCompletionConflictError();
    }
  }
}

function safeIdentifier(value: string, maxLength: number): boolean {
  return value.length >= 1 && value.length <= maxLength && SAFE_IDENTIFIER.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function checkedOptionalCount(value: number | undefined): void {
  if (value !== undefined) {
    checkedNonNegativeInteger(value);
  }
}

function checkedNonNegativeInteger(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > POSTGRES_INTEGER_MAX) {
    throw new MemoryAiRunCompletionConflictError();
  }
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: string
): Values[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new MemoryAiRunCompletionConflictError();
  }

  return value as Values[number];
}

function enumIncludes<const Values extends readonly string[]>(
  values: Values,
  value: string
): value is Values[number] {
  return (values as readonly string[]).includes(value);
}

function isReplyBearingStatus(status: AiRunTerminalCompletion["status"]): boolean {
  return status === "persisted" || status === "handed_off";
}
