import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";

import {
  aiQualityEvents,
  aiRunAttempts,
  aiRunSpans,
  aiRuns,
  conversationMessages,
  widgetAiJobs,
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
import {
  isAiValidatorFailureCode,
  type AiValidatorFailureCode
} from "../observability/ai-validator-failure-code.js";

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
    super("AI run attempt is not available for terminal completion");
    this.name = "AiRunCompletionConflictError";
  }
}

export class AiRunInputInvariantError extends Error {
  constructor() {
    super("AI run input does not match the logical-run/attempt contract");
    this.name = "AiRunInputInvariantError";
  }
}

export class PostgresAiRunRepository implements AiRunRepository {
  constructor(private readonly db: OperationsDb) {}

  async beginOrReplay(rawInput: BeginAiRunInput): Promise<BeginAiRunResult> {
    const input = sanitizeAiRunStart(rawInput);
    assertRuntimeProfilePair(input);
    assertAttemptIdentity(input);
    const [inboundMessage] = await this.db
      .select({ publicMessageId: conversationMessages.publicMessageId })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, input.inboundMessageId),
          eq(conversationMessages.leadId, input.leadId),
          eq(conversationMessages.conversationId, input.conversationId),
          eq(conversationMessages.direction, "inbound")
        )
      )
      .limit(1);

    if (!inboundMessage) throw new AiRunInputInvariantError();

    const result = await this.db.transaction(async (tx) => {
      await lockCurrentJobAttemptForBegin(tx, input);

      await tx
        .insert(aiRuns)
        .values({
          id: randomUUID(),
          recordingContract: "logical_recorded_v2",
          traceId: input.traceId,
          leadId: input.leadId,
          conversationId: input.conversationId,
          inboundMessageId: input.inboundMessageId,
          inboundPublicMessageId: inboundMessage.publicMessageId,
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
        .onConflictDoNothing({ target: aiRuns.idempotencyKey });

      const [runRow] = await tx
        .select()
        .from(aiRuns)
        .where(eq(aiRuns.idempotencyKey, input.idempotencyKey))
        .limit(1)
        .for("update");

      if (!runRow) throw new AiRunReplayConflictError();
      assertReplayMatches(runRow, input);

      if (runRow.status !== "running") {
        return { kind: "terminal" as const, runRow };
      }

      const [latestAttempt] = await tx
        .select({ attemptNumber: aiRunAttempts.attemptNumber })
        .from(aiRunAttempts)
        .where(eq(aiRunAttempts.aiRunId, runRow.id))
        .orderBy(desc(aiRunAttempts.attemptNumber))
        .limit(1)
        .for("update");
      if (
        latestAttempt &&
        input.attemptNumber < latestAttempt.attemptNumber
      ) {
        throw new AiRunReplayConflictError();
      }

      await tx
        .update(aiRunAttempts)
        .set({
          status: "fenced",
          observedModelProvider: "none",
          outcomeReason: "lease_fenced",
          failureCode: "lease_lost",
          completedAt: input.startedAt,
          latencyMs: sql<number>`GREATEST(0, floor(extract(epoch FROM (${input.startedAt.toISOString()}::timestamptz - ${aiRunAttempts.startedAt})) * 1000)::integer)`,
          updatedAt: input.startedAt
        })
        .where(
          and(
            eq(aiRunAttempts.aiRunId, runRow.id),
            eq(aiRunAttempts.status, "running"),
            lt(aiRunAttempts.attemptNumber, input.attemptNumber)
          )
        );

      const [insertedAttempt] = await tx
        .insert(aiRunAttempts)
        .values(attemptInsert(runRow.id, input))
        .onConflictDoNothing()
        .returning();
      const attemptRow =
        insertedAttempt ??
        (
          await tx
            .select()
            .from(aiRunAttempts)
            .where(eq(aiRunAttempts.idempotencyKey, input.attemptIdempotencyKey))
            .limit(1)
        )[0];

      if (!attemptRow) throw new AiRunReplayConflictError();
      assertAttemptMatches(attemptRow, runRow.id, input);
      if (attemptRow.status !== "running") throw new AiRunReplayConflictError();

      return {
        kind: insertedAttempt ? ("started" as const) : ("running_replay" as const),
        run: toRunningRecord(runRow, attemptRow)
      };
    });

    if (result.kind === "terminal") {
      return {
        kind: "terminal_replay",
        run: await this.toTerminalRecord(result.runRow)
      };
    }
    return result;
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

  failAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    return this.db.transaction((tx) => failAiRunAttemptInTransaction(tx, input));
  }

  fenceAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    return this.db.transaction((tx) => fenceAiRunAttemptInTransaction(tx, input));
  }

  private async toTerminalRecord(row: typeof aiRuns.$inferSelect): Promise<TerminalAiRunRecord> {
    const status = enumValue(AI_RUN_STATUSES, row.status);
    if (
      status === "running" ||
      !row.decisionAction ||
      !row.outcomeReason ||
      !row.completedAt ||
      row.latencyMs === null
    ) {
      throw new AiRunCompletionConflictError();
    }

    const [attemptRow, spanRows, eventRows] = await Promise.all([
      this.db
        .select()
        .from(aiRunAttempts)
        .where(
          row.winningAttemptId
            ? eq(aiRunAttempts.id, row.winningAttemptId)
            : eq(aiRunAttempts.aiRunId, row.id)
        )
        .orderBy(desc(aiRunAttempts.attemptNumber))
        .limit(1)
        .then((rows) => rows[0]),
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
    if (!attemptRow) throw new AiRunCompletionConflictError();

    const runtimeRunId = row.runtimeRunId
      ? checkedSafeIdentifier(row.runtimeRunId, 200)
      : undefined;
    const normalizedAction = enumValue(AI_RUN_NORMALIZED_ACTIONS, row.decisionAction);
    const outcomeReason = enumValue(AI_RUN_OUTCOME_REASONS, row.outcomeReason);
    const failureCode = row.failureCode
      ? enumValue(AI_RUN_FAILURE_CODES, row.failureCode)
      : undefined;
    const validatorResult = enumValue(AI_RUN_VALIDATOR_RESULTS, row.profileValidatorResult);
    const validatorFailureCode = validatorFailureCodeFromMetadata(row.metadata);
    if (
      validatorFailureCode &&
      (status !== "blocked" ||
        normalizedAction !== "no_reply" ||
        outcomeReason !== "candidate_invalid" ||
        failureCode !== "invalid_candidate" ||
        validatorResult !== "rejected")
    ) {
      throw new AiRunCompletionConflictError();
    }
    return {
      ...runningRecordBase(row, attemptRow),
      status,
      normalizedAction,
      outcomeReason,
      ...(failureCode ? { failureCode } : {}),
      validatorResult,
      ...(validatorFailureCode ? { validatorFailureCode } : {}),
      ...(runtimeRunId ? { runtimeRunId } : {}),
      observedModelProvider: enumValue(
        AI_MODEL_PROVIDERS,
        requiredObservedModelProvider(row.observedModelProvider)
      ),
      ...(row.observedModelName ? { observedModelName: row.observedModelName } : {}),
      ...(usageFromRow(row) ? { usage: usageFromRow(row) } : {}),
      ...(costFromRow(row) ?? {}),
      sendGateResult: enumValue(AI_RUN_SEND_GATE_RESULTS, row.sendGateResult),
      ...(row.sendGateCheckedAt ? { sendGateCheckedAt: row.sendGateCheckedAt } : {}),
      completedAt: row.completedAt,
      latencyMs: checkedNonNegativeInteger(row.latencyMs),
      spans: spanRows.map(toSpanWrite),
      qualityEvents: eventRows.map(toQualityEventWrite),
      ...(row.outboundMessageId ? { outboundMessageId: row.outboundMessageId } : {}),
      ...(row.winningAttemptId ? { winningAttemptId: row.winningAttemptId } : {})
    };
  }
}

export async function completeAiRunInTransaction(
  tx: AiRunTransaction,
  rawInput: CompleteAiRunInTransactionInput
): Promise<TerminalAiRunRecord> {
  const input = {
    ...rawInput,
    completion: sanitizeAiRunCompletion(rawInput.completion)
  };
  assertCompletionShape(input.run, input.completion, input.outboundMessageId);
  const outboundPublicMessageId = await readOutboundPublicMessageId(tx, input);
  const failedTerminal = input.completion.status === "failed";

  const [completedAttempt] = await tx
    .update(aiRunAttempts)
    .set(attemptCompletionSet(input.completion, failedTerminal ? "failed" : "succeeded"))
    .where(runningAttemptFence(input.run))
    .returning({ id: aiRunAttempts.id });
  if (!completedAttempt) throw new AiRunCompletionConflictError();

  const [updatedRun] = await tx
    .update(aiRuns)
    .set({
      ...logicalCompletionSet(input.completion),
      winningAttemptId: failedTerminal ? null : input.run.attempt.id,
      outboundMessageId: input.outboundMessageId ?? null,
      outboundPublicMessageId
    })
    .where(runningLogicalFence(input.run))
    .returning({ id: aiRuns.id });
  if (!updatedRun) throw new AiRunCompletionConflictError();

  await insertAttemptEvidence(tx, input.run, input.completion, input.outboundMessageId);
  return {
    ...input.run,
    ...input.completion,
    ...(failedTerminal ? {} : { winningAttemptId: input.run.attempt.id }),
    ...(input.outboundMessageId ? { outboundMessageId: input.outboundMessageId } : {})
  };
}

export async function failAiRunAttemptInTransaction(
  tx: AiRunTransaction,
  rawInput: { run: RunningAiRunRecord; completion: AiRunTerminalCompletion }
): Promise<void> {
  const completion = sanitizeAiRunCompletion(rawInput.completion);
  assertCompletionShape(rawInput.run, completion, undefined);
  const [failedAttempt] = await tx
    .update(aiRunAttempts)
    .set(attemptCompletionSet(completion, "failed"))
    .where(runningAttemptFence(rawInput.run))
    .returning({ id: aiRunAttempts.id });
  if (!failedAttempt) return;

  await insertAttemptEvidence(tx, rawInput.run, completion);
  if (
    rawInput.run.attempt.maxAttempts !== undefined &&
    rawInput.run.attempt.jobAttemptCount >= rawInput.run.attempt.maxAttempts
  ) {
    const [failedRun] = await tx
      .update(aiRuns)
      .set({
        ...logicalCompletionSet(completion),
        status: "failed",
        winningAttemptId: null
      })
      .where(runningLogicalFence(rawInput.run))
      .returning({ id: aiRuns.id });
    if (!failedRun) throw new AiRunCompletionConflictError();
  }
}

export async function fenceAiRunAttemptInTransaction(
  tx: AiRunTransaction,
  rawInput: { run: RunningAiRunRecord; completion: AiRunTerminalCompletion }
): Promise<void> {
  const completion = sanitizeAiRunCompletion(rawInput.completion);
  assertCompletionShape(rawInput.run, completion, undefined);
  const [fencedAttempt] = await tx
    .update(aiRunAttempts)
    .set(attemptCompletionSet(completion, "fenced"))
    .where(runningAttemptFence(rawInput.run))
    .returning({ id: aiRunAttempts.id });
  if (!fencedAttempt) return;
  await insertAttemptEvidence(tx, rawInput.run, completion);
}

export async function finalizeExhaustedAiRunForJobInTransaction(
  tx: AiRunTransaction,
  input: {
    jobId: string;
    jobAttemptCount: number;
    completedAt: Date;
    runningAttemptStatus: "failed" | "fenced";
  }
): Promise<void> {
  return finalizeTerminalAiRunForJobInTransaction(tx, {
    ...input,
    terminalCause: "attempt_budget_exhausted"
  });
}

export async function finalizeSupersededAiRunForJobInTransaction(
  tx: AiRunTransaction,
  input: {
    jobId: string;
    jobAttemptCount: number;
    completedAt: Date;
  }
): Promise<void> {
  return finalizeTerminalAiRunForJobInTransaction(tx, {
    ...input,
    runningAttemptStatus: "fenced",
    terminalCause: "superseded"
  });
}

async function finalizeTerminalAiRunForJobInTransaction(
  tx: AiRunTransaction,
  input: {
    jobId: string;
    jobAttemptCount: number;
    completedAt: Date;
    runningAttemptStatus: "failed" | "fenced";
    terminalCause: "attempt_budget_exhausted" | "superseded";
  }
): Promise<void> {
  const terminalEvidence =
    input.terminalCause === "superseded"
      ? {
          outcomeReason: "execution_context_mismatch" as const,
          failureCode: "execution_context_mismatch" as const,
          reasonCode: "execution_context_mismatch" as const,
          severity: "warning" as const
        }
      : {
          outcomeReason: "generator_failed" as const,
          failureCode: "runtime_failure" as const,
          reasonCode: "runtime_failed" as const,
          severity: "critical" as const
        };
  const currentAttempts = await tx
    .select({
      id: aiRunAttempts.id,
      aiRunId: aiRunAttempts.aiRunId,
      status: aiRunAttempts.status,
      startedAt: aiRunAttempts.startedAt
    })
    .from(aiRunAttempts)
    .where(
      and(
        eq(aiRunAttempts.jobId, input.jobId),
        eq(aiRunAttempts.jobAttemptCount, input.jobAttemptCount)
      )
    )
    .orderBy(desc(aiRunAttempts.attemptNumber))
    .limit(2)
    .for("update");
  if (currentAttempts.length > 1) throw new AiRunCompletionConflictError();
  const attempt =
    currentAttempts[0] ??
    (
      await tx
        .select({
          id: aiRunAttempts.id,
          aiRunId: aiRunAttempts.aiRunId,
          status: aiRunAttempts.status,
          startedAt: aiRunAttempts.startedAt
        })
        .from(aiRunAttempts)
        .where(eq(aiRunAttempts.jobId, input.jobId))
        .orderBy(desc(aiRunAttempts.attemptNumber))
        .limit(1)
        .for("update")
    )[0];
  if (!attempt) return;
  if (attempt.status === "succeeded") throw new AiRunCompletionConflictError();

  const [run] = await tx
    .select({
      id: aiRuns.id,
      leadId: aiRuns.leadId,
      conversationId: aiRuns.conversationId,
      inboundMessageId: aiRuns.inboundMessageId,
      startedAt: aiRuns.startedAt,
      status: aiRuns.status
    })
    .from(aiRuns)
    .where(eq(aiRuns.id, attempt.aiRunId))
    .limit(1)
    .for("update");
  if (!run || run.status !== "running") return;
  if (!run.startedAt) throw new AiRunCompletionConflictError();

  if (attempt.status === "running") {
    await tx
      .update(aiRunAttempts)
      .set({
        status: input.runningAttemptStatus,
        observedModelProvider: "none",
        observedModelName: null,
        sendGateResult: "not_checked",
        sendGateCheckedAt: null,
        outcomeReason: terminalEvidence.outcomeReason,
        failureCode: terminalEvidence.failureCode,
        profileValidatorResult: "not_run",
        completedAt: input.completedAt,
        latencyMs: Math.max(0, input.completedAt.getTime() - attempt.startedAt.getTime()),
        updatedAt: input.completedAt
      })
      .where(and(eq(aiRunAttempts.id, attempt.id), eq(aiRunAttempts.status, "running")));
    await tx.insert(aiQualityEvents).values({
      aiRunId: run.id,
      aiRunAttemptId: attempt.id,
      leadId: run.leadId,
      conversationId: run.conversationId,
      messageId: run.inboundMessageId,
      eventType: "runtime_failure",
      reasonCode: terminalEvidence.reasonCode,
      severity: terminalEvidence.severity,
      managerVisible: true,
      createdAt: input.completedAt
    });
  }

  await tx
    .update(aiRuns)
    .set({
      decisionAction: "no_reply",
      status: "failed",
      observedModelProvider: "none",
      observedModelName: null,
      sendGateResult: "not_checked",
      sendGateCheckedAt: null,
      outcomeReason: terminalEvidence.outcomeReason,
      failureCode: terminalEvidence.failureCode,
      profileValidatorResult: "not_run",
      completedAt: input.completedAt,
      latencyMs: Math.max(0, input.completedAt.getTime() - run.startedAt.getTime()),
      winningAttemptId: null,
      updatedAt: input.completedAt
    })
    .where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "running")));
}

async function lockCurrentJobAttemptForBegin(
  tx: AiRunTransaction,
  input: BeginAiRunInput
): Promise<void> {
  if (!input.jobId) return;
  if (input.maxAttempts === undefined) throw new AiRunInputInvariantError();

  const [job] = await tx
    .select({ id: widgetAiJobs.id })
    .from(widgetAiJobs)
    .where(
      and(
        eq(widgetAiJobs.id, input.jobId),
        eq(widgetAiJobs.status, "processing"),
        eq(widgetAiJobs.attemptCount, input.jobAttemptCount),
        eq(widgetAiJobs.maxAttempts, input.maxAttempts),
        eq(widgetAiJobs.leadId, input.leadId),
        eq(widgetAiJobs.conversationId, input.conversationId),
        eq(widgetAiJobs.inboundMessageId, input.inboundMessageId),
        eq(widgetAiJobs.runtimeMode, input.runtimeMode),
        isNotNull(widgetAiJobs.leaseExpiresAt),
        gt(widgetAiJobs.leaseExpiresAt, input.startedAt)
      )
    )
    .limit(1)
    .for("update");
  if (!job) throw new AiRunInputInvariantError();
}

function attemptInsert(aiRunId: string, input: BeginAiRunInput) {
  return {
    id: randomUUID(),
    aiRunId,
    attemptNumber: input.attemptNumber,
    jobId: input.jobId ?? null,
    jobAttemptCount: input.jobAttemptCount,
    maxAttempts: input.maxAttempts ?? null,
    idempotencyKey: input.attemptIdempotencyKey,
    traceId: input.traceId,
    inputFingerprint: input.inputFingerprint,
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
    status: "running",
    startedAt: input.startedAt,
    updatedAt: input.startedAt
  };
}

function attemptCompletionSet(
  completion: AiRunTerminalCompletion,
  status: "succeeded" | "failed" | "fenced"
) {
  return {
    status,
    observedModelProvider: completion.observedModelProvider,
    observedModelName: completion.observedModelName ?? null,
    runtimeRunId: completion.runtimeRunId ?? null,
    inputTokens: completion.usage?.inputTokens ?? null,
    outputTokens: completion.usage?.outputTokens ?? null,
    totalTokens: completion.usage?.totalTokens ?? null,
    costEstimateMicrounits: completion.costEstimateMicrounits ?? null,
    costRateVersion: completion.costRateVersion ?? null,
    sendGateResult: completion.sendGateResult,
    sendGateCheckedAt: completion.sendGateCheckedAt ?? null,
    outcomeReason: completion.outcomeReason,
    failureCode: completion.failureCode ?? null,
    profileValidatorResult: completion.validatorResult,
    completedAt: completion.completedAt,
    latencyMs: completion.latencyMs,
    updatedAt: completion.completedAt
  };
}

function logicalCompletionSet(completion: AiRunTerminalCompletion) {
  return {
    decisionAction: completion.normalizedAction,
    status: completion.status,
    observedModelProvider: completion.observedModelProvider,
    observedModelName: completion.observedModelName ?? null,
    runtimeRunId: completion.runtimeRunId ?? null,
    inputTokens: completion.usage?.inputTokens ?? null,
    outputTokens: completion.usage?.outputTokens ?? null,
    totalTokens: completion.usage?.totalTokens ?? null,
    costEstimateMicrounits: completion.costEstimateMicrounits ?? null,
    costRateVersion: completion.costRateVersion ?? null,
    sendGateResult: completion.sendGateResult,
    sendGateCheckedAt: completion.sendGateCheckedAt ?? null,
    outcomeReason: completion.outcomeReason,
    failureCode: completion.failureCode ?? null,
    profileValidatorResult: completion.validatorResult,
    ...(completion.validatorFailureCode
      ? {
          metadata: sql<Record<string, unknown>>`${aiRuns.metadata} || ${JSON.stringify({
            validator_failure_code: completion.validatorFailureCode
          })}::jsonb`
        }
      : {}),
    completedAt: completion.completedAt,
    latencyMs: completion.latencyMs,
    updatedAt: completion.completedAt
  };
}

function validatorFailureCodeFromMetadata(
  metadata: Record<string, unknown>
): AiValidatorFailureCode | undefined {
  const value = metadata.validator_failure_code;
  if (value === undefined) return undefined;
  if (!isAiValidatorFailureCode(value)) throw new AiRunCompletionConflictError();
  return value;
}

function runningAttemptFence(run: RunningAiRunRecord) {
  return and(
    eq(aiRunAttempts.id, run.attempt.id),
    eq(aiRunAttempts.aiRunId, run.id),
    eq(aiRunAttempts.status, "running"),
    eq(aiRunAttempts.attemptNumber, run.attempt.attemptNumber),
    eq(aiRunAttempts.idempotencyKey, run.attempt.idempotencyKey),
    eq(aiRunAttempts.traceId, run.attempt.traceId),
    eq(aiRunAttempts.inputFingerprint, run.attempt.inputFingerprint)
  );
}

function runningLogicalFence(run: RunningAiRunRecord) {
  return and(
    eq(aiRuns.id, run.id),
    eq(aiRuns.status, "running"),
    eq(aiRuns.leadId, run.leadId),
    eq(aiRuns.conversationId, run.conversationId),
    eq(aiRuns.inboundMessageId, run.inboundMessageId),
    eq(aiRuns.idempotencyKey, run.idempotencyKey)
  );
}

async function readOutboundPublicMessageId(
  tx: AiRunTransaction,
  input: CompleteAiRunInTransactionInput
): Promise<string | null> {
  if (!input.outboundMessageId) return null;
  const [message] = await tx
    .select({ publicMessageId: conversationMessages.publicMessageId })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, input.outboundMessageId),
        eq(conversationMessages.leadId, input.run.leadId),
        eq(conversationMessages.conversationId, input.run.conversationId),
        eq(conversationMessages.direction, "outbound")
      )
    )
    .limit(1);
  if (!message) throw new AiRunCompletionConflictError();
  return message.publicMessageId;
}

async function insertAttemptEvidence(
  tx: AiRunTransaction,
  run: RunningAiRunRecord,
  completion: AiRunTerminalCompletion,
  outboundMessageId?: string
): Promise<void> {
  if (completion.spans.length > 0) {
    await tx.insert(aiRunSpans).values(
      completion.spans.map((span) => ({
        aiRunId: run.id,
        aiRunAttemptId: run.attempt.id,
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
  if (completion.qualityEvents.length > 0) {
    await tx.insert(aiQualityEvents).values(
      completion.qualityEvents.map((event) => ({
        aiRunId: run.id,
        aiRunAttemptId: run.attempt.id,
        leadId: run.leadId,
        conversationId: run.conversationId,
        messageId: outboundMessageId ?? run.inboundMessageId,
        eventType: event.eventType,
        reasonCode: event.reasonCode,
        severity: event.severity,
        managerVisible: true
      }))
    );
  }
}

function runningRecordBase(
  row: typeof aiRuns.$inferSelect,
  attempt: typeof aiRunAttempts.$inferSelect
): Omit<RunningAiRunRecord, "status"> {
  if (
    row.recordingContract !== "logical_recorded_v2" ||
    row.traceId === null ||
    row.channel !== "site_widget" ||
    row.idempotencyKey === null ||
    row.policyVersion === null ||
    row.promptVersion === null ||
    row.toolVersion === null ||
    row.disclosureVersion === null ||
    row.configuredModelProvider === null ||
    row.configuredModelName === null ||
    row.reasoningEffort === null ||
    row.modelProfileVersion === null ||
    row.startedAt === null
  ) {
    throw new AiRunCompletionConflictError();
  }
  return {
    id: row.id,
    traceId: attempt.traceId,
    leadId: row.leadId,
    conversationId: row.conversationId,
    inboundMessageId: row.inboundMessageId,
    channel: "site_widget",
    runtimeMode: enumValue(AI_RUN_RUNTIME_MODES, row.runtimeMode),
    decisionProfile: enumValue(AI_RUN_DECISION_PROFILES, row.decisionProfile),
    idempotencyKey: row.idempotencyKey,
    attemptIdempotencyKey: attempt.idempotencyKey,
    attemptNumber: attempt.attemptNumber,
    ...(attempt.jobId ? { jobId: attempt.jobId } : {}),
    jobAttemptCount: attempt.jobAttemptCount,
    ...(attempt.maxAttempts === null ? {} : { maxAttempts: attempt.maxAttempts }),
    inputFingerprint: attempt.inputFingerprint,
    versions: {
      policyVersion: attempt.policyVersion,
      promptVersion: attempt.promptVersion,
      toolVersion: attempt.toolVersion,
      ...(attempt.assetVersion ? { assetVersion: attempt.assetVersion } : {}),
      ...(attempt.toneVersion ? { toneVersion: attempt.toneVersion } : {}),
      ...(attempt.factsVersion ? { factsVersion: attempt.factsVersion } : {}),
      disclosureVersion: attempt.disclosureVersion,
      modelProfileVersion: attempt.modelProfileVersion,
      ...(attempt.runtimeVersion ? { runtimeVersion: attempt.runtimeVersion } : {})
    },
    model: {
      modelProvider: enumValue(AI_CONFIGURED_MODEL_PROVIDERS, attempt.configuredModelProvider),
      requestedModelName: attempt.configuredModelName,
      reasoningEffort: enumValue(AI_REASONING_EFFORTS, attempt.reasoningEffort)
    },
    startedAt: attempt.startedAt,
    attempt: {
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      ...(attempt.jobId ? { jobId: attempt.jobId } : {}),
      jobAttemptCount: attempt.jobAttemptCount,
      ...(attempt.maxAttempts === null ? {} : { maxAttempts: attempt.maxAttempts }),
      idempotencyKey: attempt.idempotencyKey,
      traceId: attempt.traceId,
      inputFingerprint: attempt.inputFingerprint,
      startedAt: attempt.startedAt
    }
  };
}

function toRunningRecord(
  row: typeof aiRuns.$inferSelect,
  attempt: typeof aiRunAttempts.$inferSelect
): RunningAiRunRecord {
  if (row.status !== "running" || attempt.status !== "running") {
    throw new AiRunCompletionConflictError();
  }
  return { ...runningRecordBase(row, attempt), status: "running" };
}

function assertReplayMatches(row: typeof aiRuns.$inferSelect, input: BeginAiRunInput): void {
  if (
    row.recordingContract !== "logical_recorded_v2" ||
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

function assertAttemptMatches(
  row: typeof aiRunAttempts.$inferSelect,
  aiRunId: string,
  input: BeginAiRunInput
): void {
  if (
    row.aiRunId !== aiRunId ||
    row.attemptNumber !== input.attemptNumber ||
    row.jobId !== (input.jobId ?? null) ||
    row.jobAttemptCount !== input.jobAttemptCount ||
    row.maxAttempts !== (input.maxAttempts ?? null) ||
    row.inputFingerprint !== input.inputFingerprint ||
    row.policyVersion !== input.versions.policyVersion ||
    row.promptVersion !== input.versions.promptVersion ||
    row.toolVersion !== input.versions.toolVersion ||
    row.assetVersion !== (input.versions.assetVersion ?? null) ||
    row.toneVersion !== (input.versions.toneVersion ?? null) ||
    row.factsVersion !== (input.versions.factsVersion ?? null) ||
    row.disclosureVersion !== input.versions.disclosureVersion ||
    row.configuredModelProvider !== input.model.modelProvider ||
    row.configuredModelName !== input.model.requestedModelName ||
    row.reasoningEffort !== input.model.reasoningEffort ||
    row.modelProfileVersion !== input.versions.modelProfileVersion ||
    row.runtimeVersion !== (input.versions.runtimeVersion ?? null)
  ) {
    throw new AiRunReplayConflictError();
  }
}

function assertAttemptIdentity(input: BeginAiRunInput): void {
  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber !== input.jobAttemptCount ||
    (input.jobId !== undefined && input.maxAttempts === undefined) ||
    (input.maxAttempts !== undefined && input.maxAttempts < input.jobAttemptCount) ||
    !input.attemptIdempotencyKey.endsWith(`:attempt:${input.attemptNumber}`)
  ) {
    throw new AiRunInputInvariantError();
  }
}

function assertRuntimeProfilePair(input: BeginAiRunInput): void {
  const validPair = input.runtimeMode === "direct_openai" && input.decisionProfile === "live_v2";
  if (!validPair) throw new AiRunInputInvariantError();
}

function assertCompletionShape(
  run: RunningAiRunRecord,
  completion: AiRunTerminalCompletion,
  outboundMessageId: string | undefined
): void {
  const replyBearing = isReplyBearingStatus(completion.status);
  const successful = completion.status === "persisted" || completion.status === "handed_off";
  const controlledNoReply =
    completion.status === "fallback_unavailable" &&
    completion.normalizedAction === "no_reply" &&
    (completion.outcomeReason === "no_safe_answer" ||
      completion.outcomeReason === "missing_approved_fact");
  if (
    replyBearing !== Boolean(outboundMessageId) ||
    (successful || controlledNoReply) === (completion.failureCode !== undefined) ||
    (completion.sendGateResult === "not_checked") !== !completion.sendGateCheckedAt ||
    (completion.sendGateResult === "allowed") !== replyBearing ||
    (completion.sendGateResult === "blocked" && completion.status !== "blocked") ||
    !(completion.completedAt instanceof Date) ||
    !Number.isFinite(completion.completedAt.getTime()) ||
    completion.completedAt < run.attempt.startedAt
  ) {
    throw new AiRunCompletionConflictError();
  }
  checkedNonNegativeInteger(completion.latencyMs);
  checkedOptionalCount(completion.usage?.inputTokens);
  checkedOptionalCount(completion.usage?.outputTokens);
  checkedOptionalCount(completion.usage?.totalTokens);
  if (completion.runtimeRunId !== undefined) checkedSafeIdentifier(completion.runtimeRunId, 200);
  if (
    (completion.costEstimateMicrounits === undefined) !==
    (completion.costRateVersion === undefined)
  ) {
    throw new AiRunCompletionConflictError();
  }
  if (completion.costRateVersion) checkedSafeIdentifier(completion.costRateVersion, 160);
  checkedOptionalCount(completion.costEstimateMicrounits);
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
  if (row.latencyMs === null) throw new AiRunCompletionConflictError();
  return {
    spanId: row.spanId,
    ...(row.parentSpanId ? { parentSpanId: row.parentSpanId } : {}),
    kind: enumValue(AI_RUN_SPAN_KINDS, row.kind),
    name: enumValue(AI_RUN_SPAN_NAMES, row.name),
    status: enumValue(AI_RUN_SPAN_STATUSES, row.status),
    latencyMs: checkedNonNegativeInteger(row.latencyMs),
    ...(row.errorCode ? { errorCode: enumValue(AI_RUN_SPAN_ERROR_CODES, row.errorCode) } : {}),
    ...(typeof row.usedInFinalAnswer === "boolean"
      ? { usedInFinalAnswer: row.usedInFinalAnswer }
      : {}),
    ...(row.toolVersion ? { toolVersion: row.toolVersion } : {})
  };
}

function toQualityEventWrite(row: typeof aiQualityEvents.$inferSelect): AiQualityEventWrite {
  if (row.managerVisible !== true) throw new AiRunCompletionConflictError();
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
    ...(row.totalTokens === null ? {} : { totalTokens: checkedNonNegativeInteger(row.totalTokens) })
  };
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function costFromRow(
  row: typeof aiRuns.$inferSelect
): Pick<AiRunTerminalCompletion, "costEstimateMicrounits" | "costRateVersion"> | undefined {
  if ((row.costEstimateMicrounits === null) !== (row.costRateVersion === null)) {
    throw new AiRunCompletionConflictError();
  }
  if (row.costEstimateMicrounits === null || row.costRateVersion === null) return undefined;
  return {
    costEstimateMicrounits: checkedNonNegativeInteger(row.costEstimateMicrounits),
    costRateVersion: checkedSafeIdentifier(row.costRateVersion, 160)
  };
}

function checkedOptionalCount(value: number | undefined): void {
  if (value !== undefined) checkedNonNegativeInteger(value);
}

function checkedNonNegativeInteger(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > POSTGRES_INTEGER_MAX) {
    throw new AiRunCompletionConflictError();
  }
  return value;
}

function checkedSafeIdentifier(value: string, maxLength: number): string {
  if (value.length < 1 || value.length > maxLength || !/^[A-Za-z0-9._:/@+-]+$/.test(value)) {
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
  if (value === null) throw new AiRunCompletionConflictError();
  return value;
}
