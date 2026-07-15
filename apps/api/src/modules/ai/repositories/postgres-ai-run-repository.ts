import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  aiQualityEvents,
  aiRunSpans,
  aiRuns,
  type OperationsDb
} from "@granit/db";

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
  type AiRunRepository,
  type AiRunSpanWrite,
  type AiRunTerminalCompletion,
  type BeginAiRunInput,
  type BeginAiRunResult,
  type RunningAiRunRecord,
  type TerminalAiRunRecord
} from "./ai-run-repository.js";
import {
  sanitizeAiRunCompletion,
  sanitizeAiRunStart
} from "../observability/ai-observability-sanitizer.js";

const AI_MODEL_PROVIDERS = ["openai", "fake", "policy", "none"] as const;
const AI_CONFIGURED_MODEL_PROVIDERS = ["openai", "fake", "none"] as const;
const AI_REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
const AI_QUALITY_SEVERITIES = ["info", "warning", "error", "critical"] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

type AiRunTransaction = Parameters<Parameters<OperationsDb["transaction"]>[0]>[0];

export type CompleteAiRunInTransactionInput = {
  run: RunningAiRunRecord;
  completion: AiRunTerminalCompletion;
  outboundMessageId?: string;
};

export class AiRunReplayConflictError extends Error {
  constructor() {
    super("AI run replay does not match the accepted turn");
    this.name = "AiRunReplayConflictError";
  }
}

export class AiRunCompletionConflictError extends Error {
  constructor() {
    super("AI run is not available for terminal completion");
    this.name = "AiRunCompletionConflictError";
  }
}

export class AiRunInputInvariantError extends Error {
  constructor() {
    super("AI run runtime mode does not match its decision profile");
    this.name = "AiRunInputInvariantError";
  }
}

export class PostgresAiRunRepository implements AiRunRepository {
  constructor(private readonly db: OperationsDb) {}

  async beginOrReplay(input: BeginAiRunInput): Promise<BeginAiRunResult> {
    input = sanitizeAiRunStart(input);
    assertRuntimeProfilePair(input);

    const [inserted] = await this.db
      .insert(aiRuns)
      .values({
        id: randomUUID(),
        traceId: input.traceId,
        leadId: input.leadId,
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        channel: input.channel,
        runtimeMode: input.runtimeMode,
        decisionProfile: input.decisionProfile,
        idempotencyKey: input.idempotencyKey,
        inputFingerprint: input.inputFingerprint,
        status: "running",
        policyVersion: input.versions.policyVersion,
        promptVersion: input.versions.promptVersion,
        toolVersion: input.versions.toolVersion,
        assetVersion: input.versions.assetVersion ?? null,
        toneVersion: input.versions.toneVersion ?? null,
        factsVersion: input.versions.factsVersion ?? null,
        disclosureVersion: input.versions.disclosureVersion,
        configuredModelProvider: input.model.modelProvider,
        configuredModelName: input.model.requestedModelName,
        reasoningEffort: input.model.reasoningEffort,
        modelProfileVersion: input.versions.modelProfileVersion,
        runtimeVersion: input.versions.runtimeVersion ?? null,
        startedAt: input.startedAt,
        updatedAt: input.startedAt
      })
      .onConflictDoNothing({ target: aiRuns.idempotencyKey })
      .returning();

    if (inserted) {
      return { kind: "started", run: toRunningRecord(inserted) };
    }

    const existing = await this.findByIdempotencyKey(input.idempotencyKey);

    if (!existing) {
      throw new AiRunReplayConflictError();
    }

    assertReplayMatches(existing, input);

    if (existing.status === "running") {
      return { kind: "running_replay", run: toRunningRecord(existing) };
    }

    return {
      kind: "terminal_replay",
      run: await this.toTerminalRecord(existing)
    };
  }

  async completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord> {
    if (isReplyBearingStatus(input.completion.status)) {
      throw new AiRunCompletionConflictError();
    }

    return this.db.transaction((tx) => completeAiRunInTransaction(tx, input));
  }

  private async findByIdempotencyKey(idempotencyKey: string) {
    const [row] = await this.db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.idempotencyKey, idempotencyKey))
      .limit(1);

    return row ?? null;
  }

  private async toTerminalRecord(
    row: typeof aiRuns.$inferSelect
  ): Promise<TerminalAiRunRecord> {
    const status = enumValue(AI_RUN_STATUSES, row.status);

    if (status === "running") {
      throw new AiRunCompletionConflictError();
    }

    if (
      !row.decisionAction ||
      !row.outcomeReason ||
      !row.completedAt ||
      row.latencyMs === null
    ) {
      throw new AiRunCompletionConflictError();
    }

    const [spanRows, eventRows] = await Promise.all([
      this.db
        .select()
        .from(aiRunSpans)
        .where(eq(aiRunSpans.aiRunId, row.id))
        .orderBy(asc(aiRunSpans.createdAt), asc(aiRunSpans.id)),
      this.db
        .select()
        .from(aiQualityEvents)
        .where(eq(aiQualityEvents.aiRunId, row.id))
        .orderBy(asc(aiQualityEvents.createdAt), asc(aiQualityEvents.id))
    ]);
    const usage = usageFromRow(row);

    return {
      ...runningRecordBase(row),
      status,
      normalizedAction: enumValue(AI_RUN_NORMALIZED_ACTIONS, row.decisionAction),
      outcomeReason: enumValue(AI_RUN_OUTCOME_REASONS, row.outcomeReason),
      ...(row.failureCode
        ? { failureCode: enumValue(AI_RUN_FAILURE_CODES, row.failureCode) }
        : {}),
      validatorResult: enumValue(AI_RUN_VALIDATOR_RESULTS, row.profileValidatorResult),
      observedModelProvider: enumValue(
        AI_MODEL_PROVIDERS,
        requiredObservedModelProvider(row.observedModelProvider)
      ),
      ...(row.observedModelName ? { observedModelName: row.observedModelName } : {}),
      ...(usage ? { usage } : {}),
      sendGateResult: enumValue(AI_RUN_SEND_GATE_RESULTS, row.sendGateResult),
      ...(row.sendGateCheckedAt ? { sendGateCheckedAt: row.sendGateCheckedAt } : {}),
      completedAt: row.completedAt,
      latencyMs: checkedNonNegativeInteger(row.latencyMs),
      spans: spanRows.map(toSpanWrite),
      qualityEvents: eventRows.map(toQualityEventWrite),
      ...(row.outboundMessageId ? { outboundMessageId: row.outboundMessageId } : {})
    };
  }
}

/**
 * Completes a run using the caller's transaction. The conversation repository uses this after its
 * send-gate decision so an allowed outbound row and its terminal run linkage commit together.
 */
export async function completeAiRunInTransaction(
  tx: AiRunTransaction,
  input: CompleteAiRunInTransactionInput
): Promise<TerminalAiRunRecord> {
  input = {
    ...input,
    completion: sanitizeAiRunCompletion(input.completion)
  };
  assertCompletionShape(input.run, input.completion, input.outboundMessageId);

  const [updated] = await tx
    .update(aiRuns)
    .set({
      outboundMessageId: input.outboundMessageId ?? null,
      decisionAction: input.completion.normalizedAction,
      status: input.completion.status,
      observedModelProvider: input.completion.observedModelProvider,
      observedModelName: input.completion.observedModelName ?? null,
      inputTokens: input.completion.usage?.inputTokens ?? null,
      outputTokens: input.completion.usage?.outputTokens ?? null,
      totalTokens: input.completion.usage?.totalTokens ?? null,
      sendGateResult: input.completion.sendGateResult,
      sendGateCheckedAt: input.completion.sendGateCheckedAt ?? null,
      outcomeReason: input.completion.outcomeReason,
      failureCode: input.completion.failureCode ?? null,
      profileValidatorResult: input.completion.validatorResult,
      completedAt: input.completion.completedAt,
      latencyMs: input.completion.latencyMs,
      updatedAt: input.completion.completedAt
    })
    .where(
      and(
        eq(aiRuns.id, input.run.id),
        eq(aiRuns.status, "running"),
        eq(aiRuns.traceId, input.run.traceId),
        eq(aiRuns.leadId, input.run.leadId),
        eq(aiRuns.conversationId, input.run.conversationId),
        eq(aiRuns.inboundMessageId, input.run.inboundMessageId),
        eq(aiRuns.idempotencyKey, input.run.idempotencyKey),
        eq(aiRuns.inputFingerprint, input.run.inputFingerprint)
      )
    )
    .returning({ id: aiRuns.id });

  if (!updated) {
    throw new AiRunCompletionConflictError();
  }

  if (input.completion.spans.length > 0) {
    await tx.insert(aiRunSpans).values(
      input.completion.spans.map((span) => ({
        aiRunId: input.run.id,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? null,
        kind: span.kind,
        name: span.name,
        toolVersion: span.toolVersion ?? null,
        status: span.status,
        latencyMs: span.latencyMs,
        errorCode: span.errorCode ?? null,
        usedInFinalAnswer: span.usedInFinalAnswer ?? null
      }))
    );
  }

  if (input.completion.qualityEvents.length > 0) {
    const evidenceMessageId = input.outboundMessageId ?? input.run.inboundMessageId;
    await tx.insert(aiQualityEvents).values(
      input.completion.qualityEvents.map((event) => ({
        aiRunId: input.run.id,
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        messageId: evidenceMessageId,
        eventType: event.eventType,
        reasonCode: event.reasonCode,
        severity: event.severity,
        managerVisible: true
      }))
    );
  }

  return {
    ...input.run,
    ...input.completion,
    ...(input.outboundMessageId ? { outboundMessageId: input.outboundMessageId } : {})
  };
}

function assertRuntimeProfilePair(input: BeginAiRunInput): void {
  const validPair =
    (input.runtimeMode === "direct_openai" && input.decisionProfile === "legacy_s05") ||
    (input.runtimeMode === "mastra_openai_api" && input.decisionProfile === "live_v2");

  if (!validPair) {
    throw new AiRunInputInvariantError();
  }
}

function runningRecordBase(
  row: typeof aiRuns.$inferSelect
): Omit<RunningAiRunRecord, "status"> {
  if (row.channel !== "site_widget") {
    throw new AiRunCompletionConflictError();
  }

  return {
    id: row.id,
    traceId: row.traceId,
    leadId: row.leadId,
    conversationId: row.conversationId,
    inboundMessageId: row.inboundMessageId,
    channel: "site_widget",
    runtimeMode: enumValue(AI_RUN_RUNTIME_MODES, row.runtimeMode),
    decisionProfile: enumValue(AI_RUN_DECISION_PROFILES, row.decisionProfile),
    idempotencyKey: row.idempotencyKey,
    inputFingerprint: row.inputFingerprint,
    versions: {
      policyVersion: row.policyVersion,
      promptVersion: row.promptVersion,
      toolVersion: row.toolVersion,
      ...(row.assetVersion ? { assetVersion: row.assetVersion } : {}),
      ...(row.toneVersion ? { toneVersion: row.toneVersion } : {}),
      ...(row.factsVersion ? { factsVersion: row.factsVersion } : {}),
      disclosureVersion: row.disclosureVersion,
      modelProfileVersion: row.modelProfileVersion,
      ...(row.runtimeVersion ? { runtimeVersion: row.runtimeVersion } : {})
    },
    model: {
      modelProvider: enumValue(
        AI_CONFIGURED_MODEL_PROVIDERS,
        row.configuredModelProvider
      ),
      requestedModelName: row.configuredModelName,
      reasoningEffort: enumValue(AI_REASONING_EFFORTS, row.reasoningEffort)
    },
    startedAt: row.startedAt
  };
}

function toRunningRecord(row: typeof aiRuns.$inferSelect): RunningAiRunRecord {
  if (row.status !== "running") {
    throw new AiRunCompletionConflictError();
  }

  return { ...runningRecordBase(row), status: "running" };
}

function assertReplayMatches(row: typeof aiRuns.$inferSelect, input: BeginAiRunInput): void {
  if (
    row.leadId !== input.leadId ||
    row.conversationId !== input.conversationId ||
    row.inboundMessageId !== input.inboundMessageId ||
    row.channel !== input.channel ||
    row.runtimeMode !== input.runtimeMode ||
    row.decisionProfile !== input.decisionProfile ||
    row.inputFingerprint !== input.inputFingerprint
  ) {
    throw new AiRunReplayConflictError();
  }
}

function assertCompletionShape(
  run: RunningAiRunRecord,
  completion: AiRunTerminalCompletion,
  outboundMessageId: string | undefined
): void {
  const replyBearing = isReplyBearingStatus(completion.status);

  if (replyBearing !== Boolean(outboundMessageId)) {
    throw new AiRunCompletionConflictError();
  }

  if (
    (completion.sendGateResult === "not_checked") !== !completion.sendGateCheckedAt ||
    (completion.sendGateResult === "allowed") !== replyBearing ||
    (completion.sendGateResult === "blocked" && completion.status !== "blocked") ||
    !(completion.completedAt instanceof Date) ||
    !Number.isFinite(completion.completedAt.getTime()) ||
    completion.completedAt < run.startedAt
  ) {
    throw new AiRunCompletionConflictError();
  }

  checkedNonNegativeInteger(completion.latencyMs);
  checkedOptionalCount(completion.usage?.inputTokens);
  checkedOptionalCount(completion.usage?.outputTokens);
  checkedOptionalCount(completion.usage?.totalTokens);
  if (
    completion.observedModelName !== undefined &&
    !/^[A-Za-z0-9._:/@+-]{1,120}$/.test(completion.observedModelName)
  ) {
    throw new AiRunCompletionConflictError();
  }

  if (
    (completion.observedModelProvider === "none") !==
    (completion.observedModelName === undefined)
  ) {
    throw new AiRunCompletionConflictError();
  }

  const spanIds = new Set<string>();
  for (const span of completion.spans) {
    if (spanIds.has(span.spanId) || span.status === "running") {
      throw new AiRunCompletionConflictError();
    }

    spanIds.add(span.spanId);
    checkedNonNegativeInteger(span.latencyMs);
  }

  if (completion.qualityEvents.some((event) => event.managerVisible !== true)) {
    throw new AiRunCompletionConflictError();
  }
}

function toSpanWrite(row: typeof aiRunSpans.$inferSelect): AiRunSpanWrite {
  if (row.latencyMs === null) {
    throw new AiRunCompletionConflictError();
  }

  return {
    spanId: row.spanId,
    ...(row.parentSpanId ? { parentSpanId: row.parentSpanId } : {}),
    kind: enumValue(AI_RUN_SPAN_KINDS, row.kind),
    name: enumValue(AI_RUN_SPAN_NAMES, row.name),
    status: enumValue(AI_RUN_SPAN_STATUSES, row.status),
    latencyMs: checkedNonNegativeInteger(row.latencyMs),
    ...(row.errorCode
      ? { errorCode: enumValue(AI_RUN_SPAN_ERROR_CODES, row.errorCode) }
      : {}),
    ...(typeof row.usedInFinalAnswer === "boolean"
      ? { usedInFinalAnswer: row.usedInFinalAnswer }
      : {}),
    ...(row.toolVersion ? { toolVersion: row.toolVersion } : {})
  };
}

function toQualityEventWrite(row: typeof aiQualityEvents.$inferSelect): AiQualityEventWrite {
  if (row.managerVisible !== true) {
    throw new AiRunCompletionConflictError();
  }

  return {
    eventType: enumValue(AI_QUALITY_EVENT_TYPES, row.eventType),
    reasonCode: enumValue(AI_QUALITY_REASON_CODES, row.reasonCode),
    severity: enumValue(AI_QUALITY_SEVERITIES, row.severity),
    managerVisible: true
  };
}

function usageFromRow(row: typeof aiRuns.$inferSelect) {
  const usage = {
    ...(row.inputTokens === null
      ? {}
      : { inputTokens: checkedNonNegativeInteger(row.inputTokens) }),
    ...(row.outputTokens === null
      ? {}
      : { outputTokens: checkedNonNegativeInteger(row.outputTokens) }),
    ...(row.totalTokens === null
      ? {}
      : { totalTokens: checkedNonNegativeInteger(row.totalTokens) })
  };

  return Object.keys(usage).length > 0 ? usage : undefined;
}

function checkedOptionalCount(value: number | undefined): void {
  if (value !== undefined) {
    checkedNonNegativeInteger(value);
  }
}

function checkedNonNegativeInteger(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > POSTGRES_INTEGER_MAX) {
    throw new AiRunCompletionConflictError();
  }

  return value;
}

function enumValue<const Values extends readonly string[]>(
  values: Values,
  value: string
): Values[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new AiRunCompletionConflictError();
  }

  return value as Values[number];
}

function isReplyBearingStatus(status: AiRunTerminalCompletion["status"]): boolean {
  return status === "persisted" || status === "handed_off";
}

function requiredObservedModelProvider(value: string | null): string {
  if (value === null) {
    throw new AiRunCompletionConflictError();
  }

  return value;
}
