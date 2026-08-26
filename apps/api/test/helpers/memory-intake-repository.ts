import { randomUUID } from "node:crypto";

import { SITE_WIDGET_MESSAGE_EVENT_TYPE, SITE_WIDGET_V2_CONTRACT_VERSION } from "@granit/contracts";

import {
  PUBLIC_WIDGET_CATALOG_ACTION_LIMIT,
  buildSiteWidgetAiTurnExecutionContext,
  buildStageASiteWidgetAiTurnInput,
  type AiTurnInput,
  type WidgetCatalogReference
} from "../../src/modules/ai/ai-turn.js";
import type {
  AiRunTerminalCompletion,
  AiRunSpanWrite,
  BeginAiRunInput,
  BeginAiRunResult,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../../src/modules/ai/repositories/ai-run-repository.js";
import type { PersistRecordedSiteWidgetAiReplyInput } from "../../src/modules/ai/repositories/recorded-site-widget-ai-reply-repository.js";
import type { AiKnownSlots, AiSlotName } from "../../src/modules/ai/ai-dialog-contract.js";
import {
  AiControlVersionConflictError,
  AgentReplyBlockedError,
  buildWidgetAiTurnIdempotencyKey,
  IdempotencyConflictError,
  ManagerTelegramReplyContextMissingError,
  ManagerTelegramReplyRequiresTakeoverError,
  TelegramIdentityRequiredError,
  TelegramOutboundBlockedError,
  type AcceptInboundMessageInput,
  type AcceptInboundMessageResult,
  type BindManagerTelegramChatInput,
  type BindManagerTelegramChatResult,
  type ChangeManagerLeadStatusInput,
  type ClaimedSiteWidgetAiJob,
  type ClearManagerTelegramReplyContextInput,
  type ConversationContentType,
  type CreateManagerTelegramBindTokenInput,
  type CreateManagerTelegramBindTokenResult,
  type CreateManagerTelegramReplyContextInput,
  type CreateManagerTelegramReplyContextResult,
  type FindManagerTelegramActorInput,
  type FinishSiteWidgetAiJobInput,
  type IntakeRepository,
  type ManagerAiControl,
  type ManagerAiQualitySummary,
  type ManagerLeadDetail,
  type ManagerLeadListItem,
  type ManagerTelegramActor,
  type ManagerTelegramBindingStatus,
  type PersistManagerTelegramReplyInput,
  type PersistManagerTelegramReplyResult,
  type PersistAiReplyWithSendGateInput,
  type RecordManualContactInput,
  type RecordAiReviewLabelInput,
  type RecordSiteWidgetAiDegradationInput,
  type SaveAcceptedSiteFormSubmissionInput,
  type SaveAcceptedSiteFormSubmissionResult,
  type SaveAcceptedSiteWidgetMessageInput,
  type SaveAcceptedSiteWidgetMessageResult,
  type SaveSiteWidgetAiMessageInput,
  type SaveSiteWidgetAiMessageResult,
  type SiteWidgetHistoryResult,
  type SiteWidgetAiJobSummary,
  type SetConversationAiControlInput,
  type SetManagerAiControlInput,
  type SetNextStepInput,
  type TakeoverConversationByPublicIdInput,
  type TakeoverConversationInput,
  type TakeoverSiteWidgetConversationInput
} from "../../src/repositories/intake-repository.js";
import { sanitizeAiObservabilityMetadata } from "../../src/modules/ai/observability/ai-observability-sanitizer.js";
import { toAiDialogTranscript } from "../../src/modules/conversations/repositories/ai-dialog-transcript.js";

function memoryRunningAiRun(id: string, input: BeginAiRunInput): RunningAiRunRecord {
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

function sameMemoryAttemptConfiguration(
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

export class MemoryIntakeRepository implements IntakeRepository {
  saveCalls = 0;
  aiSaveCalls = 0;
  lastAiSaveInput?: SaveSiteWidgetAiMessageInput;
  private readonly managerReviewTransitions: Array<Record<string, unknown>> = [];
  private readonly recordedAiRuns: any[] = [];
  private readonly recordedAiAttempts: Array<{
    id: string;
    aiRunId: string;
    attemptNumber: number;
    jobId?: string;
    jobAttemptCount: number;
    startedAt: Date;
    status: "running" | "succeeded" | "failed" | "fenced";
  }> = [];
  private managerAiControl: ManagerAiControl = {
    enabled: true,
    version: 1,
    changedAt: "2026-07-16T00:00:00.000Z"
  };
  private readonly leads = new Map<string, ManagerLeadDetail>();
  private readonly idempotency = new Map<
    string,
    {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetIdempotency = new Map<
    string,
    {
      leadId: string;
      publicSessionId: string;
      publicMessageId: string;
      submittedAt: string;
      requestFingerprint: string;
      expectedGenerationEpoch: number;
      respondsThroughSequence: number;
    }
  >();
  private readonly widgetAiIdempotency = new Map<
    string,
    {
      publicMessageId: string;
      body: string;
      createdAt: string;
      requestFingerprint: string;
    }
  >();
  private readonly widgetAiJobs = new Map<
    string,
    ClaimedSiteWidgetAiJob & { availableAt: Date; leaseExpiresAt?: Date }
  >();
  private readonly widgetAiJobIdsByInboundMessage = new Map<string, string>();
  private readonly widgetCatalogReferences = new Map<string, WidgetCatalogReference[]>();
  private readonly telegramIdempotency = new Map<
    string,
    {
      leadId: string;
      conversationId: string;
      publicConversationId: string;
      channelIdentityId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();
  private readonly sessionLeads = new Map<string, string>();
  private readonly sessionConversations = new Map<string, string>();
  private readonly conversationLeads = new Map<string, string>();
  private readonly conversationSessions = new Map<string, string>();
  private readonly conversationPublicIds = new Map<string, string>();
  private readonly publicConversationIds = new Map<string, string>();
  private readonly conversationLastMessageSequences = new Map<string, number>();
  private readonly conversationLatestVisitorSequences = new Map<string, number>();
  private readonly conversationGenerationEpochs = new Map<string, number>();

  get aiRunCount() {
    return this.recordedAiRuns.length;
  }

  get managerReviewTransitionCalls() {
    return this.managerReviewTransitions.length;
  }

  listAiRuns(): Array<{
    status: string;
    spans: Array<{ name: string; usedInFinalAnswer?: boolean }>;
    [key: string]: any;
  }> {
    return [...this.recordedAiRuns];
  }

  listAiAttempts() {
    return structuredClone(this.recordedAiAttempts);
  }

  listWidgetAiJobs() {
    return structuredClone([...this.widgetAiJobs.values()]);
  }

  async readRecordedSiteWidgetAiGate(input: { leadId: string; conversationId: string }): Promise<{
    aiState: AiTurnInput["gateSnapshot"]["aiState"];
    agentAllowedToReply: boolean;
  }> {
    const leadId = this.conversationLeads.get(input.conversationId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);
    const lead = leadId ? this.leads.get(leadId) : undefined;
    const conversation = lead?.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );

    if (leadId !== input.leadId) {
      throw new Error("memory recorded site widget AI gate is unavailable");
    }

    return {
      aiState: conversation?.aiState ?? "needs_manager",
      agentAllowedToReply:
        Boolean(conversation?.agentAllowedToReply) && this.managerAiControl.enabled
    };
  }

  async transitionSiteWidgetConversationToManagerReview(input: Record<string, unknown>) {
    const leadId = typeof input.leadId === "string" ? input.leadId : undefined;
    const conversationId =
      typeof input.conversationId === "string" ? input.conversationId : undefined;
    const inboundPublicMessageId =
      typeof input.inboundPublicMessageId === "string" ? input.inboundPublicMessageId : undefined;
    const expectedGenerationEpoch =
      typeof input.expectedGenerationEpoch === "number" ? input.expectedGenerationEpoch : undefined;
    const respondsThroughSequence =
      typeof input.respondsThroughSequence === "number" ? input.respondsThroughSequence : undefined;
    const jobCommit =
      typeof input.jobCommit === "object" && input.jobCommit !== null
        ? (input.jobCommit as { jobId?: unknown; attemptCount?: unknown })
        : undefined;
    if (jobCommit) {
      const jobId = typeof jobCommit.jobId === "string" ? jobCommit.jobId : undefined;
      const attemptCount =
        typeof jobCommit.attemptCount === "number" ? jobCommit.attemptCount : undefined;
      if (
        !jobId ||
        attemptCount === undefined ||
        !leadId ||
        !conversationId ||
        !inboundPublicMessageId ||
        !this.isCurrentSiteWidgetAiJobAttempt({
          jobId,
          attemptCount,
          leadId,
          conversationId,
          inboundPublicMessageId,
          expectedGenerationEpoch,
          respondsThroughSequence,
          runtimeMode:
            input.runtimeMode === "mastra_openai_api" ? "mastra_openai_api" : "direct_openai"
        })
      ) {
        throw new AgentReplyBlockedError();
      }
    }

    this.managerReviewTransitions.push(input);
    if (this.options.failManagerReviewTransition) {
      throw new Error("manager review transition unavailable");
    }

    const reason = typeof input.reason === "string" ? input.reason : "ai_execution_failed";

    if (!leadId || !conversationId) {
      throw new Error("memory manager review transition identity is unavailable");
    }

    const lead = this.leads.get(leadId);
    if (!lead) {
      throw new Error("memory manager review lead is unavailable");
    }

    const updatedAt = new Date().toISOString();
    const existingReviewEvent = lead.timeline.some(
      (event) =>
        event.eventType === "conversation.ai_manager_review_required" &&
        event.metadata?.inbound_public_message_id === inboundPublicMessageId
    );

    if (existingReviewEvent) {
      return;
    }

    this.leads.set(leadId, {
      ...lead,
      updatedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_manager_review_required",
          summary: "Website widget AI requires manager review",
          metadata: {
            public_conversation_id:
              typeof input.publicConversationId === "string"
                ? input.publicConversationId
                : this.conversationPublicIds.get(conversationId),
            inbound_public_message_id: inboundPublicMessageId,
            reason
          },
          createdAt: updatedAt
        }
      ],
      conversations: lead.conversations.map((conversation) =>
        this.conversationPublicIds.get(conversationId) === conversation.publicConversationId
          ? {
              ...conversation,
              agentAllowedToReply: false,
              aiState: "needs_manager",
              updatedAt
            }
          : conversation
      )
    });
  }

  async beginOrReplay(input: BeginAiRunInput): Promise<BeginAiRunResult> {
    if (this.options.failAiRunBegin) {
      throw new Error("memory AI run begin unavailable");
    }
    this.assertCurrentJobAttemptForBegin(input);

    const existing = this.recordedAiRuns.find((run) => run.idempotencyKey === input.idempotencyKey);

    if (existing) {
      if (
        existing.leadId !== input.leadId ||
        existing.conversationId !== input.conversationId ||
        existing.inboundMessageId !== input.inboundMessageId ||
        existing.runtimeMode !== input.runtimeMode ||
        existing.decisionProfile !== input.decisionProfile ||
        existing.inputFingerprint !== input.inputFingerprint
      ) {
        throw new AgentReplyBlockedError();
      }
      if (existing.status !== "running") {
        return { kind: "terminal_replay" as const, run: existing };
      }
      if (existing.attempt.attemptNumber === input.attemptNumber) {
        if (
          existing.attempt.idempotencyKey !== input.attemptIdempotencyKey ||
          existing.attempt.inputFingerprint !== input.inputFingerprint ||
          existing.attempt.jobId !== input.jobId ||
          existing.attempt.jobAttemptCount !== input.jobAttemptCount ||
          existing.attempt.maxAttempts !== input.maxAttempts ||
          !sameMemoryAttemptConfiguration(existing, input)
        ) {
          throw new AgentReplyBlockedError();
        }
        return { kind: "running_replay" as const, run: existing };
      }
      const latestAttemptNumber = Math.max(
        ...this.recordedAiAttempts
          .filter((attempt) => attempt.aiRunId === existing.id)
          .map((attempt) => attempt.attemptNumber)
      );
      if (input.attemptNumber <= latestAttemptNumber) {
        throw new AgentReplyBlockedError();
      }
      for (const attempt of this.recordedAiAttempts) {
        if (
          attempt.aiRunId === existing.id &&
          attempt.status === "running" &&
          attempt.attemptNumber < input.attemptNumber
        ) {
          attempt.status = "fenced";
        }
      }
      const next = memoryRunningAiRun(existing.id, input);
      this.recordedAiAttempts.push({
        id: next.attempt.id,
        aiRunId: next.id,
        attemptNumber: next.attempt.attemptNumber,
        ...(next.attempt.jobId ? { jobId: next.attempt.jobId } : {}),
        jobAttemptCount: next.attempt.jobAttemptCount,
        startedAt: next.attempt.startedAt,
        status: "running"
      });
      Object.assign(existing, next);
      return { kind: "started" as const, run: existing };
    }

    const run = memoryRunningAiRun(randomUUID(), input);
    this.recordedAiRuns.push(run);
    this.recordedAiAttempts.push({
      id: run.attempt.id,
      aiRunId: run.id,
      attemptNumber: run.attempt.attemptNumber,
      ...(run.attempt.jobId ? { jobId: run.attempt.jobId } : {}),
      jobAttemptCount: run.attempt.jobAttemptCount,
      startedAt: run.attempt.startedAt,
      status: "running"
    });

    return { kind: "started" as const, run };
  }

  async completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord> {
    if (this.options.failAiRunCompletion) {
      throw new Error("memory AI run completion unavailable");
    }

    const failedTerminal = input.completion.status === "failed";
    const completed: TerminalAiRunRecord = {
      ...input.run,
      ...input.completion,
      ...(failedTerminal ? {} : { winningAttemptId: input.run.attempt.id })
    };
    this.setRecordedAttemptStatus(input.run, failedTerminal ? "failed" : "succeeded");
    const index = this.recordedAiRuns.findIndex((run) => run.id === input.run.id);

    if (index >= 0) {
      this.recordedAiRuns[index] = completed;
    } else {
      this.recordedAiRuns.push(completed);
    }

    return completed;
  }

  async failAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    this.setRecordedAttemptStatus(input.run, "failed");
    if (
      input.run.attempt.maxAttempts !== undefined &&
      input.run.attempt.jobAttemptCount >= input.run.attempt.maxAttempts
    ) {
      const index = this.recordedAiRuns.findIndex((run) => run.id === input.run.id);
      if (index >= 0) {
        this.recordedAiRuns[index] = {
          ...input.run,
          ...input.completion,
          status: "failed"
        };
      }
    }
  }

  async fenceAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    void input.completion;
    const attempt = this.recordedAiAttempts.find(
      (candidate) => candidate.id === input.run.attempt.id
    );
    if (attempt?.status === "running") attempt.status = "fenced";
  }

  private setRecordedAttemptStatus(
    run: RunningAiRunRecord,
    status: "succeeded" | "failed" | "fenced"
  ) {
    const attempt = this.recordedAiAttempts.find((candidate) => candidate.id === run.attempt.id);
    if (!attempt || attempt.status !== "running") {
      throw new AgentReplyBlockedError();
    }
    attempt.status = status;
  }

  private assertCurrentJobAttemptForBegin(input: BeginAiRunInput): void {
    if (!input.jobId) return;
    const job = this.widgetAiJobs.get(input.jobId);
    if (
      input.maxAttempts === undefined ||
      input.attemptNumber !== input.jobAttemptCount ||
      !input.attemptIdempotencyKey.endsWith(`:attempt:${input.attemptNumber}`) ||
      !job ||
      job.status !== "processing" ||
      job.attemptCount !== input.jobAttemptCount ||
      job.maxAttempts !== input.maxAttempts ||
      job.leadId !== input.leadId ||
      job.conversationId !== input.conversationId ||
      job.inboundPublicMessageId !== input.inboundMessageId ||
      job.runtimeMode !== input.runtimeMode ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= input.startedAt
    ) {
      throw new AgentReplyBlockedError();
    }
  }

  private finalizeTerminalAiRunForJob(
    jobId: string,
    jobAttemptCount: number,
    completedAt: Date,
    cause: "attempt_budget_exhausted" | "superseded"
  ): void {
    const attempts = this.recordedAiAttempts
      .filter((attempt) => attempt.jobId === jobId)
      .sort((left, right) => right.attemptNumber - left.attemptNumber);
    const current = attempts.filter((attempt) => attempt.jobAttemptCount === jobAttemptCount);
    if (current.length > 1) throw new AgentReplyBlockedError();
    const attempt = current[0] ?? attempts[0];
    if (!attempt) return;
    if (attempt.status === "succeeded") throw new AgentReplyBlockedError();
    const runIndex = this.recordedAiRuns.findIndex((run) => run.id === attempt.aiRunId);
    const run = runIndex >= 0 ? this.recordedAiRuns[runIndex] : undefined;
    if (!run || run.status !== "running") return;

    if (attempt.status === "running") {
      attempt.status = cause === "superseded" ? "fenced" : "failed";
    }
    const outcomeReason =
      cause === "superseded" ? "execution_context_mismatch" : "generator_failed";
    const failureCode =
      cause === "superseded" ? "execution_context_mismatch" : "runtime_failure";
    this.recordedAiRuns[runIndex] = {
      ...run,
      status: "failed",
      normalizedAction: "no_reply",
      outcomeReason,
      failureCode,
      validatorResult: "not_run",
      observedModelProvider: "none",
      sendGateResult: "not_checked",
      completedAt,
      latencyMs: Math.max(0, completedAt.getTime() - run.startedAt.getTime()),
      spans: [],
      qualityEvents: []
    };
  }

  async completeRecordedSiteWidgetAiNoReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
    publicConversationId: string;
    inboundPublicMessageId: string;
    expectedGenerationEpoch?: number;
    respondsThroughSequence?: number;
    runtimeMode?: "direct_openai" | "mastra_openai_api";
    jobCommit?: { jobId: string; attemptCount: number; maxAttempts: number };
  }): Promise<TerminalAiRunRecord> {
    const job = input.jobCommit ? this.widgetAiJobs.get(input.jobCommit.jobId) : undefined;

    if (
      input.jobCommit &&
      !this.isCurrentSiteWidgetAiJobAttempt({
        jobId: input.jobCommit.jobId,
        attemptCount: input.jobCommit.attemptCount,
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        expectedGenerationEpoch: input.expectedGenerationEpoch,
        respondsThroughSequence: input.respondsThroughSequence,
        runtimeMode: input.runtimeMode ?? "direct_openai"
      })
    ) {
      throw new AgentReplyBlockedError();
    }

    const runIndex = this.recordedAiRuns.findIndex((run) => run.id === input.run.id);
    const previousRun = runIndex >= 0 ? structuredClone(this.recordedAiRuns[runIndex]) : undefined;
    const previousLead = this.leads.get(input.run.leadId);
    const previousJob = job ? structuredClone(job) : undefined;
    const previousTransitionCount = this.managerReviewTransitions.length;

    let completed: TerminalAiRunRecord;

    try {
      completed = await this.completeWithoutReply({
        run: input.run,
        completion: input.completion
      });
      const reviewReason = memoryRecordedManagerReviewReason(input.completion);

      if (reviewReason) {
        await this.transitionSiteWidgetConversationToManagerReview({
          leadId: input.run.leadId,
          conversationId: input.run.conversationId,
          publicConversationId: input.publicConversationId,
          inboundMessageId: input.run.inboundMessageId,
          inboundPublicMessageId: input.inboundPublicMessageId,
          reason: reviewReason,
          expectedGenerationEpoch: input.expectedGenerationEpoch,
          respondsThroughSequence: input.respondsThroughSequence,
          runtimeMode: input.runtimeMode,
          jobCommit: input.jobCommit
        });
      }

      this.recordManagerQuality(input.run, input.completion);

      if (job) {
        job.status = input.completion.sendGateResult === "blocked" ? "superseded" : "blocked";
        job.terminalReason = memoryRecordedJobTerminalReason(input.completion);
        job.leaseExpiresAt = undefined;
      }
    } catch (error) {
      if (runIndex >= 0 && previousRun) {
        this.recordedAiRuns[runIndex] = previousRun;
      } else if (runIndex < 0) {
        const insertedIndex = this.recordedAiRuns.findIndex((run) => run.id === input.run.id);
        if (insertedIndex >= 0) this.recordedAiRuns.splice(insertedIndex, 1);
      }
      if (previousLead) this.leads.set(input.run.leadId, previousLead);
      if (job && previousJob) this.widgetAiJobs.set(job.id, previousJob);
      this.managerReviewTransitions.splice(previousTransitionCount);
      throw error;
    }

    if (this.options.failRecordedNoReplyAfterCommit) {
      throw new Error("memory recorded no-reply acknowledgement lost after commit");
    }

    return completed;
  }

  async failRecordedSiteWidgetAiAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
    inboundPublicMessageId: string;
    expectedGenerationEpoch?: number;
    respondsThroughSequence?: number;
    runtimeMode?: "direct_openai" | "mastra_openai_api";
    jobCommit?: { jobId: string; attemptCount: number; maxAttempts: number };
  }): Promise<void> {
    const job = input.jobCommit ? this.widgetAiJobs.get(input.jobCommit.jobId) : undefined;
    if (
      input.jobCommit &&
      !this.isCurrentSiteWidgetAiJobAttempt({
        jobId: input.jobCommit.jobId,
        attemptCount: input.jobCommit.attemptCount,
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        expectedGenerationEpoch: input.expectedGenerationEpoch,
        respondsThroughSequence: input.respondsThroughSequence,
        runtimeMode: input.runtimeMode ?? "direct_openai",
        maxAttempts: input.jobCommit.maxAttempts
      })
    ) {
      await this.fenceAttempt(input);
      return;
    }
    await this.failAttempt(input);
    if (input.jobCommit && job && input.jobCommit.attemptCount >= job.maxAttempts) {
      job.status = "failed";
      job.terminalReason = "worker_failed";
      job.leaseExpiresAt = undefined;
    }
  }

  fenceRecordedSiteWidgetAiAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    return this.fenceAttempt(input);
  }

  async persistRecordedSiteWidgetAiReply(input: PersistRecordedSiteWidgetAiReplyInput) {
    let saved:
      | {
          publicMessageId: string;
          body: string;
          createdAt: string;
          internalMessageId?: string;
        }
      | undefined;

    try {
      saved = await this.saveSiteWidgetAiMessage({
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        publicMessageId: input.publicMessageId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        expectedGenerationEpoch:
          input.expectedGenerationEpoch ??
          this.conversationGenerationEpochs.get(input.run.conversationId) ??
          0,
        respondsThroughSequence:
          input.respondsThroughSequence ??
          this.conversationLatestVisitorSequences.get(input.run.conversationId) ??
          0,
        runtimeMode: input.runtimeMode,
        jobCommit: input.jobCommit,
        body: input.reply.replyDraft,
        sourcePageUrl: input.sourcePageUrl,
        agentAllowedToReplyAfterSend:
          input.reply.action === "handoff_to_manager" ? false : undefined,
        slotUpdates: input.reply.slotUpdates,
        requirementUpdates: input.reply.requirementUpdates,
        handoff: input.reply.handoff,
        metadata: input.metadata
      });
      const completedRun = await this.completeWithoutReply({
        run: input.run,
        completion: {
          ...input.completionPlan.allowed,
          spans: [
            ...input.completionPlan.allowed.spans,
            {
              spanId: randomUUID(),
              kind: "send_gate",
              name: "send_gate_check",
              status: "succeeded",
              latencyMs: 0,
              usedInFinalAnswer: true
            } satisfies AiRunSpanWrite,
            {
              spanId: randomUUID(),
              kind: "runtime",
              name: "reply_persistence",
              status: "succeeded",
              latencyMs: 0
            } satisfies AiRunSpanWrite
          ]
        }
      });
      const completedWithOutbound = {
        ...completedRun,
        outboundMessageId: saved.internalMessageId ?? saved.publicMessageId
      };
      const index = this.recordedAiRuns.findIndex((run) => run.id === input.run.id);
      if (index >= 0) {
        this.recordedAiRuns[index] = completedWithOutbound;
      }
      this.recordManagerQuality(input.run, input.completionPlan.allowed);

      return {
        status: "persisted" as const,
        internalMessageId: saved.internalMessageId ?? saved.publicMessageId,
        publicMessageId: saved.publicMessageId,
        body: saved.body,
        completedRun: completedWithOutbound
      };
    } catch (error) {
      if (saved) {
        this.rollbackRecordedSiteWidgetAiReply({
          run: input.run,
          publicMessageId: saved.publicMessageId,
          idempotencyKey: input.idempotencyKey,
          jobCommit: input.jobCommit
        });
      }

      const blocked = error instanceof AgentReplyBlockedError;
      const completion = blocked
        ? {
            ...input.completionPlan.agentReplyBlocked,
            spans: [
              ...input.completionPlan.agentReplyBlocked.spans,
              {
                spanId: randomUUID(),
                kind: "send_gate",
                name: "send_gate_check",
                status: "blocked",
                latencyMs: 0,
                errorCode: "send_gate_blocked",
                usedInFinalAnswer: false
              } satisfies AiRunSpanWrite
            ]
          }
        : input.completionPlan.persistenceUnconfirmed;
      const completedRun = input.jobCommit
        ? await this.completeRecordedSiteWidgetAiNoReply({
            run: input.run,
            completion,
            publicConversationId: this.conversationPublicIds.get(input.run.conversationId) ?? "",
            inboundPublicMessageId: input.inboundPublicMessageId,
            expectedGenerationEpoch: input.expectedGenerationEpoch,
            respondsThroughSequence: input.respondsThroughSequence,
            runtimeMode: input.runtimeMode,
            jobCommit: input.jobCommit
          })
        : await this.completeWithoutReply({ run: input.run, completion });

      return {
        status: "blocked" as const,
        reason: blocked
          ? ("agent_reply_blocked" as const)
          : ("ai_persistence_unconfirmed" as const),
        completedRun
      };
    }
  }

  private recordManagerQuality(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion
  ): void {
    const managerQuality = completion.qualityEvents[0];
    const qualityLead = this.leads.get(run.leadId);
    const publicSessionId = this.conversationSessions.get(run.conversationId);
    if (!managerQuality || !qualityLead || !publicSessionId) return;

    const createdAt = completion.completedAt.toISOString();
    this.leads.set(run.leadId, {
      ...qualityLead,
      conversations: qualityLead.conversations.map((conversation) =>
        conversation.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...conversation,
              latestUnresolvedAiQuality: {
                eventType: managerQuality.eventType,
                reasonCode: managerQuality.reasonCode,
                severity: managerQuality.severity,
                runStatus: completion.status,
                createdAt
              },
              updatedAt: createdAt
            }
          : conversation
      )
    });
  }

  private rollbackRecordedSiteWidgetAiReply(input: {
    run: RunningAiRunRecord;
    publicMessageId: string;
    idempotencyKey: string;
    jobCommit?: { jobId: string; attemptCount: number; maxAttempts: number };
  }) {
    this.widgetAiIdempotency.delete(input.idempotencyKey);
    const committedJob = input.jobCommit ? this.widgetAiJobs.get(input.jobCommit.jobId) : undefined;
    if (
      committedJob?.status === "replied" &&
      committedJob.attemptCount === input.jobCommit?.attemptCount
    ) {
      committedJob.status = "processing";
      committedJob.terminalReason = undefined;
    }
    this.conversationLastMessageSequences.set(
      input.run.conversationId,
      Math.max(0, (this.conversationLastMessageSequences.get(input.run.conversationId) ?? 1) - 1)
    );
    const lead = this.leads.get(input.run.leadId);
    const publicSessionId = this.conversationSessions.get(input.run.conversationId);

    if (!lead || !publicSessionId) {
      return;
    }

    this.leads.set(input.run.leadId, {
      ...lead,
      conversations: lead.conversations.map((conversation) =>
        conversation.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...conversation,
              messages: conversation.messages.filter(
                (message) => message.publicMessageId !== input.publicMessageId
              )
            }
          : conversation
      ),
      timeline: lead.timeline.filter(
        (event) =>
          !(
            event.eventType === "conversation.ai_message_sent" &&
            event.metadata?.public_message_id === input.publicMessageId
          )
      )
    });
  }
  private readonly conversationIdentityIds = new Map<string, string>();
  private readonly aiSlotsByConversation = new Map<string, AiKnownSlots>();
  private readonly aiRequirementsByConversation = new Map<
    string,
    AiTurnInput["knownRequirements"]
  >();
  private readonly telegramIdentityLeads = new Map<string, string>();
  private readonly telegramIdentityConversations = new Map<string, string>();
  private readonly telegramProviderMessages = new Map<string, string>();
  private readonly managerTelegramTokens = new Map<
    string,
    {
      managerUserId: string;
      managerEmail: string;
      managerRole: string;
      expiresAt: string;
      usedAt?: string;
    }
  >();
  private readonly managerTelegramBindings = new Map<
    string,
    {
      id: string;
      managerUserId: string;
      managerEmail: string;
      managerRole: string;
      providerAccountId: string;
      externalChatId: string;
      externalUserId?: string;
      username?: string;
      displayName?: string;
      boundAt: string;
    }
  >();
  private readonly managerTelegramReplyContexts = new Map<
    string,
    {
      managerUserId: string;
      managerTelegramBindingId: string;
      leadId: string;
      conversationId: string;
      publicConversationId: string;
      expiresAt: string;
      status: "pending" | "used" | "cancelled" | "expired";
    }
  >();
  private readonly managerReplyIdempotency = new Map<
    string,
    {
      leadId: string;
      publicConversationId: string;
      publicMessageId: string;
      requestFingerprint: string;
    }
  >();

  constructor(
    private readonly options: {
      failPersistence?: boolean;
      failAiPersistence?: boolean;
      failAiRunBegin?: boolean;
      failAiRunCompletion?: boolean;
      failManagerReviewTransition?: boolean;
      failRecordedNoReplyAfterCommit?: boolean;
      clock?: () => Date;
    } = {}
  ) {}

  get leadCount() {
    return this.leads.size;
  }

  onlyLead() {
    const [lead] = Array.from(this.leads.values());

    if (!lead) {
      throw new Error("expected one memory lead");
    }

    return lead;
  }

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.idempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        leadId: existing.leadId,
        publicSubmissionId: existing.publicSubmissionId,
        replayed: true
      };
    }

    const leadId = randomUUID();
    const now = new Date().toISOString();
    const lead = toManagerLead(input, leadId, now);
    this.leads.set(leadId, lead);
    this.idempotency.set(input.request.idempotency_key, {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId,
      publicSubmissionId: input.publicSubmissionId,
      replayed: false
    };
  }

  async acceptInboundMessage(
    input: AcceptInboundMessageInput
  ): Promise<AcceptInboundMessageResult> {
    if (input.channel === "site_widget") {
      const saved = await this.saveAcceptedSiteWidgetMessage({
        publicMessageId: input.publicMessageId,
        publicSessionId: input.widgetPublicSessionId ?? randomUUID(),
        agentAllowedToReply: input.automationRequested,
        request: {
          schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
          event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
          idempotency_key: input.idempotencyKey,
          submitted_at: input.message.submittedAt,
          public_session_id: input.widgetPublicSessionId,
          source: {
            channel: "site_widget",
            page_url: input.sourcePageUrl ?? "https://granit.example/widget",
            widget_instance_id: input.widgetInstanceId ?? "widget",
            referrer_url: input.referrerUrl,
            page_title: input.pageTitle,
            utm: input.utm ?? undefined
          },
          contact: {
            name: input.contact?.name,
            phone: input.contact?.phone,
            email: input.contact?.email,
            preferred_contact: input.contact?.preferredContact,
            city: input.contact?.city
          },
          message: {
            role: "visitor",
            text: input.message.text
          },
          visitor_context: input.visitorContext,
          consent: {
            privacy_policy: true
          }
        },
        requestFingerprint: input.requestFingerprint
      });

      return {
        leadId: saved.leadId,
        conversationId: saved.conversationId,
        publicConversationId: saved.publicConversationId,
        channelIdentityId: saved.channelIdentityId,
        publicMessageId: saved.publicMessageId,
        widgetPublicSessionId: saved.publicSessionId,
        agentAllowedToReply: saved.agentAllowedToReply,
        aiState: saved.aiState,
        replayed: saved.replayed,
        existingAiReply: saved.aiReply,
        aiTurnInput: saved.aiTurnInput
      };
    }

    if (!input.providerAccountId || !input.externalChatId) {
      throw new TelegramIdentityRequiredError();
    }

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.telegramIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      const lead = this.leads.get(existing.leadId);
      const conversation = lead?.conversations.find(
        (candidate) => candidate.publicConversationId === existing.publicConversationId
      );

      return {
        leadId: existing.leadId,
        conversationId: existing.conversationId,
        publicConversationId: existing.publicConversationId,
        channelIdentityId: existing.channelIdentityId,
        publicMessageId: existing.publicMessageId,
        agentAllowedToReply: conversation?.agentAllowedToReply ?? false,
        aiState: conversation?.aiState ?? "needs_manager",
        replayed: true
      };
    }

    const providerReplayKey = telegramProviderReplayKey(input);
    const providerReplayIdempotency = providerReplayKey
      ? this.telegramProviderMessages.get(providerReplayKey)
      : undefined;

    if (providerReplayIdempotency) {
      const replay = this.telegramIdempotency.get(providerReplayIdempotency);

      if (replay) {
        return this.acceptInboundMessage({
          ...input,
          idempotencyKey: providerReplayIdempotency,
          requestFingerprint: replay.requestFingerprint
        });
      }
    }

    const identityKey = telegramIdentityKey(input);
    let leadId = this.telegramIdentityLeads.get(identityKey);
    let conversationId = this.telegramIdentityConversations.get(identityKey);
    let lead = leadId ? this.leads.get(leadId) : undefined;
    const now = new Date().toISOString();
    const channelIdentityId =
      this.conversationIdentityIds.get(conversationId ?? "") ?? randomUUID();
    const contentType = input.message.contentType ?? "text";
    const needsManager = Boolean(input.needsManagerReason) || contentType !== "text";
    const publicConversationId =
      (conversationId ? this.conversationPublicIds.get(conversationId) : undefined) ?? randomUUID();

    if (!leadId || !conversationId || !lead) {
      leadId = randomUUID();
      conversationId = randomUUID();
      lead = toManagerTelegramLead(
        input,
        leadId,
        conversationId,
        publicConversationId,
        channelIdentityId,
        now
      );
      if (needsManager && this.hasActiveManagerTelegramDestination(input.providerAccountId)) {
        lead = markTelegramNotificationPending(lead);
      }
      this.leads.set(leadId, lead);
      this.telegramIdentityLeads.set(identityKey, leadId);
      this.telegramIdentityConversations.set(identityKey, conversationId);
      this.conversationLeads.set(conversationId, leadId);
      this.conversationPublicIds.set(conversationId, publicConversationId);
      this.publicConversationIds.set(publicConversationId, conversationId);
      this.conversationIdentityIds.set(conversationId, channelIdentityId);
    } else {
      const nextAiState = needsManager ? "needs_manager" : "ai_collecting_info";
      const nextAgentAllowed = input.automationRequested && !needsManager;
      lead = {
        ...lead,
        updatedAt: now,
        request: {
          ...lead.request,
          text: input.message.text || input.message.caption || lead.request.text
        },
        timeline: [
          ...lead.timeline,
          {
            eventType: "conversation.message_received",
            summary: "Telegram message received",
            metadata: {
              public_message_id: input.publicMessageId,
              public_conversation_id: publicConversationId,
              channel: "telegram",
              content_type: contentType,
              provider_message_id: input.providerMessageId,
              provider_update_id: input.providerUpdateId
            },
            createdAt: now
          },
          ...(needsManager
            ? [
                {
                  eventType: "manager.notification_enqueued",
                  summary: this.hasActiveManagerTelegramDestination(input.providerAccountId)
                    ? "Telegram manager notification queued"
                    : "Telegram manager notification blocked because no destination is bound",
                  metadata: {
                    public_conversation_id: publicConversationId,
                    public_message_id: input.publicMessageId,
                    status: this.hasActiveManagerTelegramDestination(input.providerAccountId)
                      ? "pending"
                      : "blocked_no_destination",
                    needs_manager_reason: input.needsManagerReason ?? "telegram_media"
                  },
                  createdAt: now
                }
              ]
            : [])
        ],
        conversations: lead.conversations.map((conversation) =>
          conversation.publicConversationId === publicConversationId
            ? {
                ...conversation,
                aiState: nextAiState,
                agentAllowedToReply: nextAgentAllowed && conversation.agentAllowedToReply,
                updatedAt: now,
                messages: [
                  ...conversation.messages,
                  toManagerConversationMessage(input, contentType, now)
                ]
              }
            : conversation
        )
      };
      this.leads.set(leadId, lead);
    }

    this.telegramIdempotency.set(input.idempotencyKey, {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    if (providerReplayKey) {
      this.telegramProviderMessages.set(providerReplayKey, input.idempotencyKey);
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === publicConversationId
    );

    return {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      publicMessageId: input.publicMessageId,
      agentAllowedToReply: conversation?.agentAllowedToReply ?? false,
      aiState: conversation?.aiState ?? (needsManager ? "needs_manager" : "ai_collecting_info"),
      replayed: false
    };
  }

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    this.saveCalls += 1;

    if (this.options.failPersistence) {
      throw new Error("persistence unavailable");
    }

    const existing = this.widgetIdempotency.get(input.request.idempotency_key);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      const conversationId =
        this.sessionConversations.get(existing.publicSessionId) ?? randomUUID();
      const publicConversationId = this.conversationPublicIds.get(conversationId) ?? randomUUID();
      const channelIdentityId = this.conversationIdentityIds.get(conversationId) ?? randomUUID();
      const conversation = this.leads
        .get(existing.leadId)
        ?.conversations.find(
          (candidate) =>
            candidate.channelIdentity.widgetPublicSessionId === existing.publicSessionId
        );
      const agentAllowedToReply =
        Boolean(conversation?.agentAllowedToReply) && this.managerAiControl.enabled;
      const aiState = conversation?.aiState ?? "ai_collecting_info";
      const existingJobId = this.widgetAiJobIdsByInboundMessage.get(existing.publicMessageId);
      const existingJob = existingJobId ? this.widgetAiJobs.get(existingJobId) : undefined;
      const latestJob = [...this.widgetAiJobs.values()]
        .filter((job) => job.conversationId === conversationId)
        .sort(
          (left, right) =>
            right.respondsThroughSequence - left.respondsThroughSequence ||
            right.availableAt.getTime() - left.availableAt.getTime()
        )[0];
      const currentInbound = [...this.widgetIdempotency.values()]
        .filter((candidate) => candidate.publicSessionId === existing.publicSessionId)
        .sort(
          (left, right) => right.respondsThroughSequence - left.respondsThroughSequence
        )[0];
      const currentGenerationEpoch = this.conversationGenerationEpochs.get(conversationId);
      const aiReply =
        (existingJob
          ? this.widgetAiIdempotency.get(
              buildWidgetAiTurnIdempotencyKey({
                conversationId: existingJob.conversationId,
                expectedGenerationEpoch: existingJob.expectedGenerationEpoch,
                respondsThroughSequence: existingJob.respondsThroughSequence,
                runtimeMode: existingJob.runtimeMode
              })
            )
          : undefined) ?? this.widgetAiIdempotency.get(`ai:${existing.publicMessageId}`);
      const replayAiTurnInput = buildMemorySiteWidgetAiTurnInput(
        input,
        {
          publicConversationId,
          publicMessageId: existing.publicMessageId,
          agentAllowedToReply,
          aiState
        },
        {
          recentMessages: toMemoryAiRecentMessages(
            conversation?.messages ?? [],
            existing.publicMessageId
          ),
          persistedSlots: this.aiSlotsByConversation.get(conversationId) ?? {},
          persistedRequirements: this.aiRequirementsByConversation.get(conversationId) ?? []
        }
      );

      return {
        leadId: existing.leadId,
        conversationId,
        publicConversationId,
        channelIdentityId,
        inboundMessageId: existing.publicMessageId,
        publicSessionId: existing.publicSessionId,
        publicMessageId: existing.publicMessageId,
        submittedAt: existing.submittedAt,
        agentAllowedToReply,
        aiState,
        replayed: true,
        turnIdentity: {
          expectedGenerationEpoch:
            existingJob?.expectedGenerationEpoch ?? existing.expectedGenerationEpoch,
          respondsThroughSequence:
            existingJob?.respondsThroughSequence ?? existing.respondsThroughSequence
        },
        currentWidgetAiWindow:
          currentInbound && currentGenerationEpoch !== undefined
            ? {
                inboundPublicMessageId: currentInbound.publicMessageId,
                respondsThroughSequence: currentInbound.respondsThroughSequence,
                generationEpoch: currentGenerationEpoch
              }
            : undefined,
        aiReply: aiReply
          ? {
              publicMessageId: aiReply.publicMessageId,
              body: aiReply.body,
              createdAt: aiReply.createdAt
            }
          : undefined,
        aiRuntimeEnabled: this.managerAiControl.enabled,
        widgetAiJob: existingJob ? toMemoryWidgetAiJobSummary(existingJob) : undefined,
        latestWidgetAiJob: latestJob ? toMemoryWidgetAiJobSummary(latestJob) : undefined,
        aiTurnInput: replayAiTurnInput,
        aiTurnExecutionContext: buildSiteWidgetAiTurnExecutionContext({
          leadId: existing.leadId,
          conversationId,
          inboundMessageId: existing.publicMessageId,
          publicConversationId,
          publicInboundMessageId: existing.publicMessageId,
          requestFingerprint: input.requestFingerprint
        })
      };
    }

    const now = new Date().toISOString();
    const publicSessionId = input.publicSessionId;
    let leadId = this.sessionLeads.get(publicSessionId);
    let conversationId = this.sessionConversations.get(publicSessionId);
    let lead = leadId ? this.leads.get(leadId) : undefined;

    if (!leadId || !lead) {
      leadId = randomUUID();
      conversationId = randomUUID();
      const publicConversationId = randomUUID();
      const channelIdentityId = randomUUID();
      lead = toManagerWidgetLead(
        input,
        leadId,
        conversationId,
        publicConversationId,
        channelIdentityId,
        now
      );
      this.leads.set(leadId, lead);
      this.sessionLeads.set(publicSessionId, leadId);
      this.sessionConversations.set(publicSessionId, conversationId);
      this.conversationLeads.set(conversationId, leadId);
      this.conversationSessions.set(conversationId, publicSessionId);
      this.conversationPublicIds.set(conversationId, publicConversationId);
      this.publicConversationIds.set(publicConversationId, conversationId);
      this.conversationIdentityIds.set(conversationId, channelIdentityId);
    } else {
      if (!conversationId) {
        conversationId = randomUUID();
        const publicConversationId = randomUUID();
        const channelIdentityId = randomUUID();
        this.sessionConversations.set(publicSessionId, conversationId);
        this.conversationLeads.set(conversationId, leadId);
        this.conversationSessions.set(conversationId, publicSessionId);
        this.conversationPublicIds.set(conversationId, publicConversationId);
        this.publicConversationIds.set(publicConversationId, conversationId);
        this.conversationIdentityIds.set(conversationId, channelIdentityId);
      }

      lead = {
        ...lead,
        updatedAt: now,
        timeline: [
          ...lead.timeline,
          {
            eventType: "conversation.message_received",
            summary: "Website widget message received",
            metadata: {
              public_message_id: input.publicMessageId,
              public_session_id: publicSessionId,
              automation_status: "disabled"
            },
            createdAt: now
          }
        ],
        conversations: lead.conversations.map((conversation) =>
          conversation.channelIdentity.widgetPublicSessionId === publicSessionId
            ? {
                ...conversation,
                agentAllowedToReply: input.agentAllowedToReply && conversation.agentAllowedToReply,
                updatedAt: now,
                messages: [
                  ...conversation.messages,
                  {
                    publicMessageId: input.publicMessageId,
                    direction: "inbound",
                    senderRole: "visitor",
                    body: input.request.message.text,
                    contentType: "text",
                    createdAt: now
                  }
                ]
              }
            : conversation
        )
      };
      this.leads.set(leadId, lead);
    }

    const respondsThroughSequence =
      (this.conversationLastMessageSequences.get(conversationId) ?? 0) + 1;
    const expectedGenerationEpoch =
      (this.conversationGenerationEpochs.get(conversationId) ?? 0) + 1;
    this.conversationLastMessageSequences.set(conversationId, respondsThroughSequence);
    this.conversationLatestVisitorSequences.set(conversationId, respondsThroughSequence);
    this.conversationGenerationEpochs.set(conversationId, expectedGenerationEpoch);

    this.widgetIdempotency.set(input.request.idempotency_key, {
      leadId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      submittedAt: now,
      requestFingerprint: input.requestFingerprint,
      expectedGenerationEpoch,
      respondsThroughSequence
    });

    const publicConversationId = this.conversationPublicIds.get(conversationId) ?? randomUUID();
    const channelIdentityId = this.conversationIdentityIds.get(conversationId) ?? randomUUID();
    const conversation = this.leads
      .get(leadId)
      ?.conversations.find(
        (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
      );
    const agentAllowedToReply =
      (conversation?.agentAllowedToReply ?? false) && this.managerAiControl.enabled;
    const aiState = conversation?.aiState ?? "ai_collecting_info";
    const aiTurnInput = buildMemorySiteWidgetAiTurnInput(
      input,
      {
        publicConversationId,
        publicMessageId: input.publicMessageId,
        agentAllowedToReply,
        aiState
      },
      {
        recentMessages: toMemoryAiRecentMessages(
          conversation?.messages ?? [],
          input.publicMessageId
        ),
        persistedSlots: this.aiSlotsByConversation.get(conversationId) ?? {},
        persistedRequirements: this.aiRequirementsByConversation.get(conversationId) ?? []
      }
    );
    let widgetAiJob: SiteWidgetAiJobSummary | undefined;

    if (input.enqueueAiJob && agentAllowedToReply) {
      for (const previous of this.widgetAiJobs.values()) {
        if (
          previous.conversationId === conversationId &&
          (previous.status === "pending" || previous.status === "retrying")
        ) {
          this.finalizeTerminalAiRunForJob(
            previous.id,
            previous.attemptCount,
            new Date(now),
            "superseded"
          );
          previous.status = "superseded";
          previous.terminalReason = "newer_inbound";
        }
      }

      const jobId = randomUUID();
      const aiTurnExecutionContext = buildSiteWidgetAiTurnExecutionContext({
        leadId,
        conversationId,
        inboundMessageId: input.publicMessageId,
        publicConversationId,
        publicInboundMessageId: input.publicMessageId,
        requestFingerprint: input.requestFingerprint
      });
      const job: ClaimedSiteWidgetAiJob & {
        availableAt: Date;
        leaseExpiresAt?: Date;
      } = {
        id: jobId,
        status: "pending",
        attemptCount: 0,
        maxAttempts: input.aiJobMaxAttempts ?? 3,
        leadId,
        conversationId,
        publicConversationId,
        publicSessionId,
        inboundPublicMessageId: input.publicMessageId,
        expectedGenerationEpoch,
        respondsThroughSequence,
        runtimeMode: input.aiJobRuntimeMode ?? "direct_openai",
        queueWaitMs: 0,
        aiTurnInput,
        aiTurnExecutionContext,
        availableAt: new Date(new Date(now).getTime() + 600)
      };
      this.widgetAiJobs.set(jobId, job);
      this.widgetAiJobIdsByInboundMessage.set(input.publicMessageId, jobId);
      widgetAiJob = toMemoryWidgetAiJobSummary(job);
    }

    return {
      leadId,
      conversationId,
      publicConversationId,
      channelIdentityId,
      inboundMessageId: input.publicMessageId,
      publicSessionId,
      publicMessageId: input.publicMessageId,
      submittedAt: now,
      agentAllowedToReply,
      aiState,
      replayed: false,
      aiTurnInput,
      aiTurnExecutionContext: buildSiteWidgetAiTurnExecutionContext({
        leadId,
        conversationId,
        inboundMessageId: input.publicMessageId,
        publicConversationId,
        publicInboundMessageId: input.publicMessageId,
        requestFingerprint: input.requestFingerprint
      }),
      turnIdentity: {
        expectedGenerationEpoch,
        respondsThroughSequence
      },
      currentWidgetAiWindow: {
        inboundPublicMessageId: input.publicMessageId,
        respondsThroughSequence,
        generationEpoch: expectedGenerationEpoch
      },
      aiRuntimeEnabled: this.managerAiControl.enabled,
      widgetAiJob,
      latestWidgetAiJob: widgetAiJob
    };
  }

  async persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    if (input.channel === "telegram") {
      throw new TelegramOutboundBlockedError();
    }

    const {
      channel: _channel,
      provider: _provider,
      publicConversationId: _publicConversationId,
      ...siteWidgetInput
    } = input;
    return this.saveSiteWidgetAiMessage(siteWidgetInput);
  }

  async saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    this.aiSaveCalls += 1;
    this.lastAiSaveInput = input;

    if (this.options.failAiPersistence) {
      throw new Error("ai persistence unavailable");
    }

    const existing = this.widgetAiIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        publicMessageId: existing.publicMessageId,
        body: existing.body,
        createdAt: existing.createdAt
      };
    }

    const leadId = this.conversationLeads.get(input.conversationId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);
    const lead = leadId ? this.leads.get(leadId) : undefined;

    if (!lead || !publicSessionId || leadId !== input.leadId) {
      throw new Error("memory conversation not found");
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );

    if (!conversation?.agentAllowedToReply || !this.managerAiControl.enabled) {
      throw new AgentReplyBlockedError();
    }

    if (
      this.conversationGenerationEpochs.get(input.conversationId) !==
        input.expectedGenerationEpoch ||
      this.conversationLatestVisitorSequences.get(input.conversationId) !==
        input.respondsThroughSequence
    ) {
      throw new AgentReplyBlockedError();
    }

    const committedJob = input.jobCommit ? this.widgetAiJobs.get(input.jobCommit.jobId) : undefined;

    if (
      input.jobCommit &&
      !this.isCurrentSiteWidgetAiJobAttempt({
        jobId: input.jobCommit.jobId,
        attemptCount: input.jobCommit.attemptCount,
        leadId: input.leadId,
        conversationId: input.conversationId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        expectedGenerationEpoch: input.expectedGenerationEpoch,
        respondsThroughSequence: input.respondsThroughSequence,
        runtimeMode: input.runtimeMode ?? "direct_openai"
      })
    ) {
      throw new AgentReplyBlockedError();
    }

    this.conversationLastMessageSequences.set(
      input.conversationId,
      (this.conversationLastMessageSequences.get(input.conversationId) ?? 0) + 1
    );

    const createdAt = new Date().toISOString();
    const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_message_sent",
          summary: "Website widget AI reply persisted",
          metadata: {
            ...sanitizedMetadata,
            public_message_id: input.publicMessageId,
            inbound_public_message_id: input.inboundPublicMessageId
          },
          createdAt
        },
        ...(input.handoff
          ? [
              {
                eventType: "conversation.ai_handoff_created",
                summary: "AI dialog handed to a manager",
                metadata: {
                  public_conversation_id: conversation.publicConversationId,
                  inbound_public_message_id: input.inboundPublicMessageId,
                  outbound_public_message_id: input.publicMessageId,
                  reason: input.handoff.reason,
                  handoff_summary: input.handoff.summary,
                  slots: input.handoff.slotsSnapshot
                },
                createdAt
              }
            ]
          : [])
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...candidate,
              agentAllowedToReply:
                input.agentAllowedToReplyAfterSend ?? candidate.agentAllowedToReply,
              aiState:
                input.agentAllowedToReplyAfterSend === false ? "needs_manager" : candidate.aiState,
              updatedAt: createdAt,
              messages: [
                ...candidate.messages,
                {
                  publicMessageId: input.publicMessageId,
                  direction: "outbound",
                  senderRole: "ai_assistant",
                  body: input.body,
                  contentType: "text",
                  createdAt
                }
              ]
            }
          : candidate
      )
    };

    this.leads.set(lead.leadId, updatedLead);

    if (input.slotUpdates?.length) {
      const slots = {
        ...(this.aiSlotsByConversation.get(input.conversationId) ?? {})
      };
      const conflicts = [...updatedLead.structuredIntake.conflicts];

      for (const slot of input.slotUpdates) {
        if (slots[slot.name]?.source === "manager") {
          const current = slots[slot.name];
          conflicts.push({
            publicConversationId: conversation.publicConversationId,
            name: slot.name,
            candidateValue: slot.value,
            currentValue: current?.value,
            sourceMessageId: slot.sourceMessageId,
            evidence: slot.evidence,
            applied: false,
            createdAt
          });
          continue;
        }

        slots[slot.name] = {
          value: slot.value,
          source: slot.source,
          sourceMessageId: slot.sourceMessageId,
          evidence: slot.evidence,
          confidence: slot.confidence,
          updatedAt: createdAt
        };
      }

      this.aiSlotsByConversation.set(input.conversationId, slots);
      const slotEntries = Object.entries(slots).flatMap(([name, value]) =>
        value
          ? [
              {
                publicConversationId: conversation.publicConversationId,
                name: name as AiSlotName,
                value: value.value,
                source: value.source,
                sourceMessageId: value.sourceMessageId,
                confidence: value.confidence,
                evidence: value.evidence
                  ? {
                      quote: value.evidence.quote,
                      start: value.evidence.start,
                      end: value.evidence.end
                    }
                  : undefined,
                updatedAt: value.updatedAt
              }
            ]
          : []
      );
      const knownNames = new Set(slotEntries.map((slot) => slot.name));

      updatedLead.structuredIntake = {
        slots: slotEntries,
        requirements: updatedLead.structuredIntake.requirements,
        conflicts,
        missingFields: CORE_STRUCTURED_INTAKE_SLOTS.filter((name) => !knownNames.has(name)),
        handoff: input.handoff
          ? {
              reason: input.handoff.reason,
              summary: input.handoff.summary,
              status: "active",
              createdAt
            }
          : updatedLead.structuredIntake.handoff,
        verification: input.aiRun
          ? {
              aiRunId: input.inboundPublicMessageId,
              status: input.handoff ? "handoff" : "replied",
              verdict: input.aiRun.verifierVerdict,
              generatorModelName: input.aiRun.generatorModelName ?? input.aiRun.modelVersion,
              verifierModelName: input.aiRun.verifierModelName,
              verifierVersion: input.aiRun.verifierVersion,
              catalogVersion: input.aiRun.catalogVersion,
              reviewLabels: [],
              createdAt
            }
          : updatedLead.structuredIntake.verification
      };
    }

    if (input.requirementUpdates?.length) {
      const requirements = [...(this.aiRequirementsByConversation.get(input.conversationId) ?? [])];

      for (const requirement of input.requirementUpdates) {
        const existingIndex = requirements.findIndex(
          (candidate) =>
            candidate.category === requirement.category &&
            candidate.mode === requirement.mode &&
            candidate.value === requirement.value
        );
        const persisted: AiTurnInput["knownRequirements"][number] = {
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          source: requirement.source,
          sourceMessageId: requirement.sourceMessageId,
          evidence: requirement.evidence,
          confidence: requirement.confidence,
          updatedAt: createdAt
        };

        if (existingIndex >= 0) {
          requirements[existingIndex] = persisted;
        } else {
          requirements.push(persisted);
        }
      }

      this.aiRequirementsByConversation.set(input.conversationId, requirements.slice(-60));
      updatedLead.structuredIntake = {
        ...updatedLead.structuredIntake,
        requirements: requirements.map((requirement) => ({
          publicConversationId: conversation.publicConversationId,
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          sourceMessageId: requirement.sourceMessageId,
          confidence: requirement.confidence,
          evidence: {
            quote: requirement.evidence.quote,
            start: requirement.evidence.start,
            end: requirement.evidence.end
          },
          updatedAt: requirement.updatedAt
        }))
      };
    }

    if (input.handoff || input.aiRun) {
      updatedLead.structuredIntake = {
        ...updatedLead.structuredIntake,
        handoff: input.handoff
          ? {
              reason: input.handoff.reason,
              summary: input.handoff.summary,
              status: "active",
              createdAt
            }
          : updatedLead.structuredIntake.handoff,
        verification: input.aiRun
          ? {
              aiRunId: input.inboundPublicMessageId,
              status: input.handoff ? "handoff" : "replied",
              verdict: input.aiRun.verifierVerdict,
              generatorModelName: input.aiRun.generatorModelName ?? input.aiRun.modelVersion,
              verifierModelName: input.aiRun.verifierModelName,
              verifierVersion: input.aiRun.verifierVersion,
              catalogVersion: input.aiRun.catalogVersion,
              reviewLabels: [],
              createdAt
            }
          : updatedLead.structuredIntake.verification
      };
    }

    const catalogReferences = readMemoryCatalogReferences(sanitizedMetadata);
    if (catalogReferences.length) {
      this.widgetCatalogReferences.set(input.publicMessageId, catalogReferences);
    }

    this.widgetAiIdempotency.set(input.idempotencyKey, {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt,
      requestFingerprint: input.requestFingerprint
    });

    if (committedJob) {
      committedJob.status = "replied";
      committedJob.terminalReason = input.handoff ? "handoff" : undefined;
    }

    return {
      publicMessageId: input.publicMessageId,
      body: input.body,
      createdAt
    };
  }

  async recordSiteWidgetAiDegradation(input: RecordSiteWidgetAiDegradationInput): Promise<void> {
    const lead = this.leads.get(input.leadId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);

    if (!lead || !publicSessionId) {
      throw new Error("memory conversation not found for AI degradation");
    }

    const committedJob = input.jobCommit ? this.widgetAiJobs.get(input.jobCommit.jobId) : undefined;
    if (
      input.jobCommit &&
      (!committedJob ||
        committedJob.status !== "processing" ||
        committedJob.attemptCount !== input.jobCommit.attemptCount ||
        committedJob.conversationId !== input.conversationId ||
        committedJob.expectedGenerationEpoch !== input.expectedGenerationEpoch ||
        committedJob.respondsThroughSequence !== input.respondsThroughSequence ||
        committedJob.runtimeMode !== (input.runtimeMode ?? "direct_openai") ||
        this.conversationGenerationEpochs.get(input.conversationId) !==
          input.expectedGenerationEpoch ||
        this.conversationLatestVisitorSequences.get(input.conversationId) !==
          input.respondsThroughSequence ||
        !this.managerAiControl.enabled)
    ) {
      throw new AgentReplyBlockedError();
    }

    const createdAt = new Date().toISOString();
    const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
    const qualityEvent = toMemoryAiQualityEvent(input.reason);
    this.leads.set(input.leadId, {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_degraded",
          summary: "AI reply unavailable for this turn; manager review requested",
          metadata: {
            inbound_public_message_id: input.inboundPublicMessageId,
            input_fingerprint: input.inputFingerprint,
            reason: input.reason,
            ...sanitizedMetadata
          },
          createdAt
        }
      ],
      structuredIntake: {
        ...lead.structuredIntake,
        verification: {
          aiRunId: input.inboundPublicMessageId,
          status: "degraded",
          verdict:
            typeof sanitizedMetadata.verifier_verdict === "string"
              ? sanitizedMetadata.verifier_verdict
              : undefined,
          generatorModelName:
            typeof sanitizedMetadata.model_name === "string"
              ? sanitizedMetadata.model_name
              : undefined,
          verifierModelName:
            typeof sanitizedMetadata.verifier_model_name === "string"
              ? sanitizedMetadata.verifier_model_name
              : undefined,
          verifierVersion:
            typeof sanitizedMetadata.verifier_version === "string"
              ? sanitizedMetadata.verifier_version
              : undefined,
          catalogVersion:
            typeof sanitizedMetadata.catalog_version === "string"
              ? sanitizedMetadata.catalog_version
              : undefined,
          reviewLabels: [],
          createdAt
        }
      },
      conversations: lead.conversations.map((conversation) =>
        conversation.channelIdentity.widgetPublicSessionId === publicSessionId
          ? {
              ...conversation,
              latestUnresolvedAiQuality: {
                eventType: qualityEvent.eventType,
                reasonCode: qualityEvent.reasonCode,
                severity: qualityEvent.severity,
                runStatus: "fallback_unavailable",
                createdAt
              },
              updatedAt: createdAt
            }
          : conversation
      )
    });

    if (committedJob) {
      committedJob.status = "degraded";
      committedJob.terminalReason = input.reason;
    }
  }

  async findSiteWidgetAiReply(
    inboundPublicMessageId: string
  ): Promise<SaveSiteWidgetAiMessageResult | null> {
    const jobId = this.widgetAiJobIdsByInboundMessage.get(inboundPublicMessageId);
    const job = jobId ? this.widgetAiJobs.get(jobId) : undefined;
    const existing =
      (job
        ? this.widgetAiIdempotency.get(
            buildWidgetAiTurnIdempotencyKey({
              conversationId: job.conversationId,
              expectedGenerationEpoch: job.expectedGenerationEpoch,
              respondsThroughSequence: job.respondsThroughSequence,
              runtimeMode: job.runtimeMode
            })
          )
        : undefined) ?? this.widgetAiIdempotency.get(`ai:${inboundPublicMessageId}`);

    return existing
      ? {
          publicMessageId: existing.publicMessageId,
          body: existing.body,
          createdAt: existing.createdAt
        }
      : null;
  }

  async claimSiteWidgetAiJob(input: {
    leaseMs: number;
    now: Date;
  }): Promise<ClaimedSiteWidgetAiJob | null> {
    const job = Array.from(this.widgetAiJobs.values())
      .filter(
        (candidate) =>
          (candidate.status === "pending" || candidate.status === "retrying"
            ? candidate.availableAt <= input.now
            : candidate.status === "processing" &&
              Boolean(candidate.leaseExpiresAt && candidate.leaseExpiresAt <= input.now)) &&
          candidate.attemptCount < candidate.maxAttempts &&
          this.conversationGenerationEpochs.get(candidate.conversationId) ===
            candidate.expectedGenerationEpoch &&
          this.conversationLatestVisitorSequences.get(candidate.conversationId) ===
            candidate.respondsThroughSequence &&
          !Array.from(this.widgetAiJobs.values()).some(
            (active) =>
              active.id !== candidate.id &&
              active.conversationId === candidate.conversationId &&
              active.status === "processing"
          )
      )
      .sort((left, right) => left.availableAt.getTime() - right.availableAt.getTime())[0];

    if (!job) {
      return null;
    }

    job.status = "processing";
    job.attemptCount += 1;
    job.leaseExpiresAt = new Date(input.now.getTime() + Math.max(5_000, input.leaseMs));
    job.queueWaitMs = Math.max(0, input.now.getTime() - (job.availableAt.getTime() - 600));
    return structuredClone(job);
  }

  async isSiteWidgetAiJobCurrent(input: { jobId: string; attemptCount: number }): Promise<boolean> {
    const job = this.widgetAiJobs.get(input.jobId);

    return Boolean(
      job &&
      this.isCurrentSiteWidgetAiJobAttempt({
        jobId: input.jobId,
        attemptCount: input.attemptCount,
        leadId: job.leadId,
        conversationId: job.conversationId,
        inboundPublicMessageId: job.inboundPublicMessageId,
        expectedGenerationEpoch: job.expectedGenerationEpoch,
        respondsThroughSequence: job.respondsThroughSequence,
        runtimeMode: job.runtimeMode
      })
    );
  }

  async finishSiteWidgetAiJob(input: FinishSiteWidgetAiJobInput): Promise<void> {
    const job = this.widgetAiJobs.get(input.jobId);

    if (
      !job ||
      job.status !== "processing" ||
      job.attemptCount !== input.attemptCount ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= input.completedAt
    ) {
      return;
    }

    if (input.status === "failed" && input.attemptCount >= job.maxAttempts) {
      this.finalizeTerminalAiRunForJob(
        input.jobId,
        input.attemptCount,
        input.completedAt,
        "attempt_budget_exhausted"
      );
    }
    if (input.status === "superseded") {
      this.finalizeTerminalAiRunForJob(
        input.jobId,
        input.attemptCount,
        input.completedAt,
        "superseded"
      );
    }

    job.status = input.status;
    job.terminalReason = input.terminalReason;
    job.availableAt = input.retryAt ?? input.completedAt;
    job.leaseExpiresAt = undefined;
  }

  private isCurrentSiteWidgetAiJobAttempt(input: {
    jobId: string;
    attemptCount: number;
    leadId: string;
    conversationId: string;
    inboundPublicMessageId: string;
    expectedGenerationEpoch?: number;
    respondsThroughSequence?: number;
    runtimeMode: "direct_openai" | "mastra_openai_api";
    maxAttempts?: number;
  }): boolean {
    const job = this.widgetAiJobs.get(input.jobId);
    const publicSessionId = this.conversationSessions.get(input.conversationId);
    const lead = this.leads.get(input.leadId);
    const conversation = lead?.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );
    const now = this.options.clock?.() ?? new Date();

    return Boolean(
      job &&
      job.status === "processing" &&
      job.attemptCount === input.attemptCount &&
      (input.maxAttempts === undefined || job.maxAttempts === input.maxAttempts) &&
      job.leaseExpiresAt &&
      job.leaseExpiresAt > now &&
      job.leadId === input.leadId &&
      job.conversationId === input.conversationId &&
      job.inboundPublicMessageId === input.inboundPublicMessageId &&
      job.expectedGenerationEpoch === input.expectedGenerationEpoch &&
      job.respondsThroughSequence === input.respondsThroughSequence &&
      job.runtimeMode === input.runtimeMode &&
      this.conversationGenerationEpochs.get(job.conversationId) === input.expectedGenerationEpoch &&
      this.conversationLatestVisitorSequences.get(job.conversationId) ===
        input.respondsThroughSequence &&
      conversation?.agentAllowedToReply &&
      this.managerAiControl.enabled
    );
  }

  async getSiteWidgetHistory(publicSessionId: string): Promise<SiteWidgetHistoryResult | null> {
    const conversationId = this.sessionConversations.get(publicSessionId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;
    const lead = leadId ? this.leads.get(leadId) : undefined;
    const conversation = lead?.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === publicSessionId
    );

    if (!conversation) {
      return null;
    }

    const currentInbound = [...this.widgetIdempotency.values()]
      .filter((candidate) => candidate.publicSessionId === publicSessionId)
      .sort((left, right) => right.respondsThroughSequence - left.respondsThroughSequence)[0];
    const currentGenerationEpoch = conversationId
      ? this.conversationGenerationEpochs.get(conversationId)
      : undefined;

    return {
      publicSessionId,
      publicConversationId: conversation.publicConversationId,
      state:
        conversation.aiState === "closed"
          ? "closed"
          : conversation.aiState === "manager_active"
            ? "manager_active"
            : conversation.aiState === "needs_manager"
              ? "manager_pending"
              : "ai_active",
      agentAllowedToReply: conversation.agentAllowedToReply,
      runtimeEnabled: this.managerAiControl.enabled,
      currentWidgetAiWindow:
        currentInbound && currentGenerationEpoch !== undefined
          ? {
              inboundPublicMessageId: currentInbound.publicMessageId,
              respondsThroughSequence: currentInbound.respondsThroughSequence,
              generationEpoch: currentGenerationEpoch
            }
          : undefined,
      messages: conversation.messages
        .filter(
          (message) =>
            message.contentType === "text" &&
            (message.senderRole === "visitor" ||
              message.senderRole === "ai_assistant" ||
              message.senderRole === "manager")
        )
        .map((message) => {
          const jobId = this.widgetAiJobIdsByInboundMessage.get(message.publicMessageId);
          const job = jobId ? this.widgetAiJobs.get(jobId) : undefined;

          return {
            publicMessageId: message.publicMessageId,
            senderRole: message.senderRole as "visitor" | "ai_assistant" | "manager",
            text: message.body,
            submittedAt: message.createdAt,
            catalogReferences: this.widgetCatalogReferences.get(message.publicMessageId),
            automation: job
              ? {
                  status: job.status,
                  reason: job.terminalReason,
                  expectedGenerationEpoch: job.expectedGenerationEpoch,
                  respondsThroughSequence: job.respondsThroughSequence
                }
              : undefined
          };
        })
    };
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    return Array.from(this.leads.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(({ timeline, conversations, internalNotePlaceholder, ...lead }) => lead);
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    return this.leads.get(leadId) ?? null;
  }

  async getManagerAiControl(): Promise<ManagerAiControl> {
    return { ...this.managerAiControl };
  }

  async setManagerAiControl(input: SetManagerAiControlInput): Promise<ManagerAiControl> {
    if (input.expectedVersion !== this.managerAiControl.version) {
      throw new AiControlVersionConflictError();
    }

    const enabledChanged = this.managerAiControl.enabled !== input.enabled;
    this.managerAiControl = {
      enabled: input.enabled,
      version: this.managerAiControl.version + 1,
      changedByManagerEmail: input.changedByManagerEmail,
      changedAt: new Date().toISOString()
    };

    if (enabledChanged) {
      for (const conversationId of this.conversationGenerationEpochs.keys()) {
        this.conversationGenerationEpochs.set(
          conversationId,
          (this.conversationGenerationEpochs.get(conversationId) ?? 0) + 1
        );
      }
    }

    return { ...this.managerAiControl };
  }

  async setConversationAiControl(
    input: SetConversationAiControlInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!conversation || conversation.channel !== "site_widget") {
      return null;
    }

    const nextAiState = input.enabled ? "ai_collecting_info" : "manager_active";

    if (
      conversation.agentAllowedToReply === input.enabled &&
      conversation.aiState === nextAiState
    ) {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    if (conversationId) {
      this.conversationGenerationEpochs.set(
        conversationId,
        (this.conversationGenerationEpochs.get(conversationId) ?? 0) + 1
      );
    }
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_control_changed",
          summary: input.enabled ? "Manager enabled AI replies" : "Manager disabled AI replies",
          metadata: {
            public_conversation_id: input.publicConversationId,
            enabled: input.enabled,
            previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
            previous_ai_state: conversation.aiState,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === input.publicConversationId
          ? {
              ...candidate,
              agentAllowedToReply: input.enabled,
              aiState: nextAiState,
              updatedAt: changedAt
            }
          : candidate
      )
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async recordAiReviewLabel(input: RecordAiReviewLabelInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (
      !lead?.structuredIntake.verification ||
      lead.structuredIntake.verification.aiRunId !== input.aiRunId
    ) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      structuredIntake: {
        ...lead.structuredIntake,
        verification: {
          ...lead.structuredIntake.verification,
          reviewLabels: [
            ...lead.structuredIntake.verification.reviewLabels,
            { label: input.label, note: input.note, createdAt }
          ]
        }
      },
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.ai_review_labeled",
          summary: "Manager reviewed an AI response",
          metadata: {
            ai_run_id: input.aiRunId,
            label: input.label,
            note: input.note ?? null,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);
    return updatedLead;
  }

  async changeManagerLeadStatus(
    input: ChangeManagerLeadStatusInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    if (lead.status === input.status) {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      status: input.status,
      nextStep: statusRequiresNextStep(input.status)
        ? {
            at: changedAt,
            summary: "Связаться с клиентом",
            channel: "manager_call"
          }
        : lead.nextStep,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.status_changed",
          summary: `Lead status changed from ${lead.status} to ${input.status}`,
          metadata: {
            from_status: lead.status,
            to_status: input.status,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };
    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async setNextStep(input: SetNextStepInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: {
        at: input.nextStepAt,
        summary: input.nextStepSummary,
        channel: input.nextStepChannel
      },
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.next_step_updated",
          summary: "Lead next step updated",
          metadata: {
            next_step_at: input.nextStepAt,
            next_step_summary: input.nextStepSummary,
            next_step_channel: input.nextStepChannel,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async recordManualContact(input: RecordManualContactInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const changedAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: input.nextStepAt
        ? {
            at: input.nextStepAt,
            summary: input.nextStepSummary ?? input.summary,
            channel: input.contactChannel
          }
        : lead.nextStep,
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "lead.manual_contact_recorded",
          summary: "Manual contact recorded",
          metadata: {
            contact_channel: input.contactChannel,
            contacted_at: input.contactedAt,
            summary: input.summary,
            next_step_at: input.nextStepAt,
            next_step_summary: input.nextStepSummary,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ]
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async takeoverConversation(input: TakeoverConversationInput): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!conversation) {
      return null;
    }

    if (!conversation.agentAllowedToReply && conversation.aiState === "manager_active") {
      return lead;
    }

    const changedAt = new Date().toISOString();
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    if (conversationId) {
      this.conversationGenerationEpochs.set(
        conversationId,
        (this.conversationGenerationEpochs.get(conversationId) ?? 0) + 1
      );
    }
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      nextStep: {
        at: changedAt,
        summary: "Связаться с клиентом",
        channel: conversation.channel === "telegram" ? "telegram" : "site_widget"
      },
      updatedAt: changedAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.manager_takeover",
          summary: "Manager takeover disabled AI replies",
          metadata: {
            public_conversation_id: input.publicConversationId,
            channel: conversation.channel,
            previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
            previous_ai_state: conversation.aiState,
            changed_by_manager_id: input.changedByManagerId,
            changed_by_manager_email: input.changedByManagerEmail,
            changed_by_manager_role: input.changedByManagerRole
          },
          createdAt: changedAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === input.publicConversationId
          ? {
              ...candidate,
              agentAllowedToReply: false,
              aiState: "manager_active",
              updatedAt: changedAt
            }
          : candidate
      )
    };

    this.leads.set(input.leadId, updatedLead);

    return updatedLead;
  }

  async takeoverConversationByPublicId(
    input: TakeoverConversationByPublicIdInput
  ): Promise<ManagerLeadDetail | null> {
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;

    if (!leadId) {
      return null;
    }

    return this.takeoverConversation({
      leadId,
      publicConversationId: input.publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null> {
    const lead = this.leads.get(input.leadId);

    if (!lead) {
      return null;
    }

    const conversation = lead.conversations.find(
      (candidate) => candidate.channelIdentity.widgetPublicSessionId === input.publicSessionId
    );

    if (!conversation) {
      return null;
    }

    return this.takeoverConversation({
      leadId: input.leadId,
      publicConversationId: conversation.publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async getManagerTelegramBindingStatus(
    managerUserId: string
  ): Promise<ManagerTelegramBindingStatus> {
    const binding = Array.from(this.managerTelegramBindings.values()).find(
      (candidate) => candidate.managerUserId === managerUserId
    );

    if (!binding) {
      return { bound: false };
    }

    return {
      bound: true,
      username: binding.username,
      displayName: binding.displayName,
      externalChatId: `***${binding.externalChatId.slice(-4)}`,
      boundAt: binding.boundAt
    };
  }

  async createManagerTelegramBindToken(
    input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult> {
    const token = `bind-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.managerTelegramTokens.set(token, {
      managerUserId: input.managerUserId,
      managerEmail: input.managerEmail,
      managerRole: input.managerRole,
      expiresAt
    });

    return { token, expiresAt };
  }

  async bindManagerTelegramChat(
    input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult> {
    const token = this.managerTelegramTokens.get(input.token);

    if (!token) {
      return { status: "invalid_token" };
    }

    if (token.usedAt) {
      return { status: "used_token" };
    }

    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return { status: "expired_token" };
    }

    const bindingId = randomUUID();
    const now = new Date().toISOString();
    this.managerTelegramTokens.set(input.token, { ...token, usedAt: now });

    for (const [key, binding] of this.managerTelegramBindings.entries()) {
      if (
        binding.managerUserId === token.managerUserId ||
        (binding.providerAccountId === input.providerAccountId &&
          binding.externalChatId === input.externalChatId)
      ) {
        this.managerTelegramBindings.delete(key);
      }
    }

    this.managerTelegramBindings.set(bindingId, {
      id: bindingId,
      managerUserId: token.managerUserId,
      managerEmail: token.managerEmail,
      managerRole: token.managerRole,
      providerAccountId: input.providerAccountId,
      externalChatId: input.externalChatId,
      externalUserId: input.externalUserId,
      username: input.username,
      displayName: input.displayName,
      boundAt: now
    });

    return {
      status: "bound",
      managerUserId: token.managerUserId,
      managerEmail: token.managerEmail,
      managerRole: token.managerRole,
      bindingId
    };
  }

  async findManagerTelegramActor(
    input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null> {
    const binding = Array.from(this.managerTelegramBindings.values()).find(
      (candidate) =>
        candidate.providerAccountId === input.providerAccountId &&
        candidate.externalChatId === input.externalChatId &&
        candidate.externalUserId === input.externalUserId
    );

    if (!binding) {
      return null;
    }

    return {
      managerUserId: binding.managerUserId,
      managerEmail: binding.managerEmail,
      managerRole: binding.managerRole,
      bindingId: binding.id,
      externalChatId: binding.externalChatId
    };
  }

  async createManagerTelegramReplyContext(
    input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null> {
    const conversationId = this.publicConversationIds.get(input.publicConversationId);
    const leadId = conversationId ? this.conversationLeads.get(conversationId) : undefined;
    const lead = leadId ? this.leads.get(leadId) : undefined;
    const conversation = lead?.conversations.find(
      (candidate) => candidate.publicConversationId === input.publicConversationId
    );

    if (!lead || !conversation || !conversationId || !leadId) {
      return null;
    }

    if (
      conversation.channel !== "telegram" ||
      conversation.agentAllowedToReply ||
      conversation.aiState !== "manager_active"
    ) {
      throw new ManagerTelegramReplyRequiresTakeoverError();
    }

    for (const context of this.managerTelegramReplyContexts.values()) {
      if (context.managerUserId === input.managerUserId && context.status === "pending") {
        context.status = "cancelled";
      }
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.managerTelegramReplyContexts.set(input.managerUserId, {
      managerUserId: input.managerUserId,
      managerTelegramBindingId: input.managerTelegramBindingId,
      leadId,
      conversationId,
      publicConversationId: input.publicConversationId,
      expiresAt,
      status: "pending"
    });

    return {
      leadId,
      publicConversationId: input.publicConversationId,
      expiresAt
    };
  }

  async clearManagerTelegramReplyContext(
    input: ClearManagerTelegramReplyContextInput
  ): Promise<void> {
    const context = this.managerTelegramReplyContexts.get(input.managerUserId);

    if (context?.managerTelegramBindingId === input.managerTelegramBindingId) {
      context.status = input.reason;
    }
  }

  async persistManagerTelegramReply(
    input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult> {
    const existing = this.managerReplyIdempotency.get(input.idempotencyKey);

    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new IdempotencyConflictError();
      }

      return {
        leadId: existing.leadId,
        publicConversationId: existing.publicConversationId,
        publicMessageId: existing.publicMessageId,
        deliveryStatus: "pending",
        replayed: true
      };
    }

    const context = this.managerTelegramReplyContexts.get(input.managerUserId);

    if (
      !context ||
      context.managerTelegramBindingId !== input.managerTelegramBindingId ||
      context.status !== "pending" ||
      new Date(context.expiresAt).getTime() <= Date.now()
    ) {
      throw new ManagerTelegramReplyContextMissingError();
    }

    const lead = this.leads.get(context.leadId);
    const conversation = lead?.conversations.find(
      (candidate) => candidate.publicConversationId === context.publicConversationId
    );

    if (!lead || !conversation) {
      throw new ManagerTelegramReplyContextMissingError();
    }

    if (
      conversation.channel !== "telegram" ||
      conversation.agentAllowedToReply ||
      conversation.aiState !== "manager_active"
    ) {
      throw new ManagerTelegramReplyRequiresTakeoverError();
    }

    const createdAt = new Date().toISOString();
    const updatedLead: ManagerLeadDetail = {
      ...lead,
      updatedAt: createdAt,
      timeline: [
        ...lead.timeline,
        {
          eventType: "conversation.manager_message_queued",
          summary: "Manager Telegram reply queued for delivery",
          metadata: {
            public_conversation_id: context.publicConversationId,
            public_message_id: input.publicMessageId,
            delivery_status: "pending",
            changed_by_manager_email: input.managerEmail
          },
          createdAt
        }
      ],
      conversations: lead.conversations.map((candidate) =>
        candidate.publicConversationId === context.publicConversationId
          ? {
              ...candidate,
              updatedAt: createdAt,
              messages: [
                ...candidate.messages,
                {
                  publicMessageId: input.publicMessageId,
                  direction: "outbound",
                  senderRole: "manager",
                  body: input.body,
                  contentType: "text",
                  delivery: {
                    status: "pending",
                    attemptCount: 0,
                    updatedAt: createdAt
                  },
                  createdAt
                }
              ]
            }
          : candidate
      )
    };

    context.status = "used";
    this.leads.set(lead.leadId, updatedLead);
    this.managerReplyIdempotency.set(input.idempotencyKey, {
      leadId: lead.leadId,
      publicConversationId: context.publicConversationId,
      publicMessageId: input.publicMessageId,
      requestFingerprint: input.requestFingerprint
    });

    return {
      leadId: lead.leadId,
      publicConversationId: context.publicConversationId,
      publicMessageId: input.publicMessageId,
      deliveryStatus: "pending",
      replayed: false
    };
  }

  private hasActiveManagerTelegramDestination(providerAccountId?: string) {
    return Array.from(this.managerTelegramBindings.values()).some(
      (binding) =>
        binding.providerAccountId === providerAccountId &&
        (binding.managerRole === "owner" || binding.managerRole === "manager")
    );
  }
}

function toManagerLead(
  input: SaveAcceptedSiteFormSubmissionInput,
  leadId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicSubmissionId,
    status: "new",
    source: {
      channel: "site_form",
      pageUrl: input.request.source.page_url,
      formKind: input.request.source.form_kind,
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm
    },
    contact: {
      name: input.request.contact.name,
      phone: input.request.contact.phone,
      email: input.request.contact.email,
      preferredContact: input.request.contact.preferred_contact,
      city: input.request.contact.city
    },
    request: {
      text: input.request.request?.message,
      productInterest: input.request.request?.product_interest
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_form",
        summary: "Lead created from public website form",
        metadata: {},
        createdAt
      }
    ],
    conversations: [],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function toManagerWidgetLead(
  input: SaveAcceptedSiteWidgetMessageInput,
  leadId: string,
  _conversationId: string,
  publicConversationId: string,
  channelIdentityId: string,
  createdAt: string
): ManagerLeadDetail {
  return {
    leadId,
    publicSubmissionId: input.publicMessageId,
    status: "new",
    source: {
      channel: "site_widget",
      pageUrl: input.request.source.page_url,
      formKind: "site_widget",
      referrerUrl: input.request.source.referrer_url,
      utm: input.request.source.utm,
      widgetInstanceId: input.request.source.widget_instance_id
    },
    contact: {
      name: input.request.contact?.name ?? "Site visitor",
      phone: input.request.contact?.phone,
      email: input.request.contact?.email,
      preferredContact: input.request.contact?.preferred_contact,
      city: input.request.contact?.city
    },
    request: {
      text: input.request.message.text
    },
    submittedAt: input.request.submitted_at,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_site_widget",
        summary: "Lead created from public website widget",
        metadata: {
          public_session_id: input.publicSessionId,
          public_conversation_id: publicConversationId,
          channel_identity_id: channelIdentityId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Website widget message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_session_id: input.publicSessionId,
          public_conversation_id: publicConversationId,
          automation_status: input.agentAllowedToReply ? "enabled" : "disabled"
        },
        createdAt
      }
    ],
    conversations: [
      {
        publicConversationId,
        channel: "site_widget",
        channelIdentity: {
          provider: "site_widget",
          widgetPublicSessionId: input.publicSessionId,
          widgetInstanceId: input.request.source.widget_instance_id
        },
        status: "open",
        aiState: "ai_collecting_info",
        agentAllowedToReply: input.agentAllowedToReply,
        sourcePageUrl: input.request.source.page_url,
        createdAt,
        updatedAt: createdAt,
        messages: [
          {
            publicMessageId: input.publicMessageId,
            direction: "inbound",
            senderRole: "visitor",
            body: input.request.message.text,
            contentType: "text",
            createdAt
          }
        ]
      }
    ],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function toMemoryWidgetAiJobSummary(job: ClaimedSiteWidgetAiJob): SiteWidgetAiJobSummary {
  return {
    id: job.id,
    inboundPublicMessageId: job.inboundPublicMessageId,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    terminalReason: job.terminalReason,
    expectedGenerationEpoch: job.expectedGenerationEpoch,
    respondsThroughSequence: job.respondsThroughSequence,
    runtimeMode: job.runtimeMode,
    queueWaitMs: job.queueWaitMs
  };
}

function readMemoryCatalogReferences(metadata: Record<string, unknown>): WidgetCatalogReference[] {
  if (!Array.isArray(metadata.catalog_references)) {
    return [];
  }

  return metadata.catalog_references
    .slice(0, PUBLIC_WIDGET_CATALOG_ACTION_LIMIT)
    .flatMap((reference) => {
      if (
        !reference ||
        typeof reference !== "object" ||
        Array.isArray(reference) ||
        (reference as { kind?: unknown }).kind !== "catalog_item" ||
        typeof (reference as { label?: unknown }).label !== "string" ||
        typeof (reference as { title?: unknown }).title !== "string" ||
        typeof (reference as { href?: unknown }).href !== "string" ||
        typeof (reference as { entityId?: unknown }).entityId !== "string"
      ) {
        return [];
      }

      return [structuredClone(reference) as WidgetCatalogReference];
    });
}

function buildMemorySiteWidgetAiTurnInput(
  input: SaveAcceptedSiteWidgetMessageInput,
  accepted: {
    publicConversationId: string;
    publicMessageId: string;
    agentAllowedToReply: boolean;
    aiState: SaveAcceptedSiteWidgetMessageResult["aiState"];
  },
  context: {
    recentMessages: AiTurnInput["compactContext"]["messages"];
    persistedSlots: AiKnownSlots;
    persistedRequirements: AiTurnInput["knownRequirements"];
  }
): AiTurnInput {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: accepted.publicConversationId,
    publicMessageId: accepted.publicMessageId,
    requestFingerprint: input.requestFingerprint,
    submittedAt: input.request.submitted_at,
    text: input.request.message.text,
    page: {
      url: input.request.source.page_url,
      widgetInstanceId: input.request.source.widget_instance_id,
      referrerUrl: input.request.source.referrer_url,
      title: input.request.source.page_title
    },
    customer: {
      name: input.request.contact?.name,
      phoneProvided: Boolean(input.request.contact?.phone),
      emailProvided: Boolean(input.request.contact?.email),
      preferredContact: input.request.contact?.preferred_contact,
      city: input.request.contact?.city
    },
    visitor: {
      locale: input.request.visitor_context?.locale,
      timezone: input.request.visitor_context?.timezone
    },
    gate: {
      aiState: accepted.aiState,
      agentAllowedToReply: accepted.agentAllowedToReply
    },
    recentMessages: context.recentMessages,
    persistedSlots: context.persistedSlots,
    persistedRequirements: context.persistedRequirements
  });
}

function toMemoryAiRecentMessages(
  messages: ManagerLeadDetail["conversations"][number]["messages"],
  currentPublicMessageId: string
): AiTurnInput["compactContext"]["messages"] {
  const currentIndex = messages.findIndex(
    (message) => message.publicMessageId === currentPublicMessageId
  );
  const causalMessages = currentIndex >= 0 ? messages.slice(0, currentIndex + 1) : messages;
  const newestFirst = [...causalMessages].reverse().map((message) => ({
    publicMessageId: message.publicMessageId,
    direction: message.direction,
    senderRole: message.senderRole,
    contentType: message.contentType,
    submittedAt: new Date(message.createdAt),
    body: message.body
  }));

  return toAiDialogTranscript(newestFirst, currentPublicMessageId);
}

function toManagerTelegramLead(
  input: AcceptInboundMessageInput,
  leadId: string,
  _conversationId: string,
  publicConversationId: string,
  channelIdentityId: string,
  createdAt: string
): ManagerLeadDetail {
  const contentType = input.message.contentType ?? "text";
  const needsManager = Boolean(input.needsManagerReason) || contentType !== "text";

  return {
    leadId,
    publicSubmissionId: input.publicMessageId,
    status: "new",
    source: {
      channel: "telegram"
    },
    contact: {
      name: input.contact?.name ?? input.displayName ?? "Telegram",
      phone: input.contact?.phone,
      email: input.contact?.email,
      preferredContact: input.contact?.preferredContact ?? "telegram",
      city: input.contact?.city
    },
    request: {
      text: input.message.text || input.message.caption
    },
    submittedAt: input.message.submittedAt,
    createdAt,
    updatedAt: createdAt,
    timeline: [
      {
        eventType: "lead.created_from_telegram",
        summary: "Lead created from Telegram inbound",
        metadata: {
          public_conversation_id: publicConversationId,
          channel_identity_id: channelIdentityId,
          provider_account_id: input.providerAccountId,
          external_chat_id: input.externalChatId
        },
        createdAt
      },
      {
        eventType: "conversation.message_received",
        summary: "Telegram message received",
        metadata: {
          public_message_id: input.publicMessageId,
          public_conversation_id: publicConversationId,
          channel: "telegram",
          content_type: contentType,
          provider_message_id: input.providerMessageId,
          provider_update_id: input.providerUpdateId
        },
        createdAt
      },
      ...(needsManager
        ? [
            {
              eventType: "manager.notification_enqueued",
              summary: "Telegram manager notification blocked because no destination is bound",
              metadata: {
                public_conversation_id: publicConversationId,
                public_message_id: input.publicMessageId,
                status: "blocked_no_destination",
                needs_manager_reason: input.needsManagerReason ?? "telegram_media"
              },
              createdAt
            }
          ]
        : [])
    ],
    conversations: [
      {
        publicConversationId,
        channel: "telegram",
        channelIdentity: {
          provider: input.provider,
          displayName: input.displayName ?? input.contact?.name,
          username: input.username ?? input.contact?.username,
          externalChatId: input.externalChatId,
          externalUserId: input.externalUserId
        },
        status: "open",
        aiState: needsManager ? "needs_manager" : "ai_collecting_info",
        agentAllowedToReply: input.automationRequested && !needsManager,
        createdAt,
        updatedAt: createdAt,
        messages: [toManagerConversationMessage(input, contentType, createdAt)]
      }
    ],
    structuredIntake: emptyStructuredIntake(),
    internalNotePlaceholder: ""
  };
}

function toManagerConversationMessage(
  input: AcceptInboundMessageInput,
  contentType: ConversationContentType,
  createdAt: string
): ManagerLeadDetail["conversations"][number]["messages"][number] {
  return {
    publicMessageId: input.publicMessageId,
    direction: "inbound",
    senderRole: "visitor",
    body: input.message.text || input.message.caption || `[${contentType}]`,
    contentType,
    caption: input.message.caption,
    providerFileId: input.message.providerFileId,
    createdAt
  };
}

function toMemoryAiQualityEvent(
  reason: string
): Pick<ManagerAiQualitySummary, "eventType" | "reasonCode" | "severity"> {
  if (reason === "missing_openai_config") {
    return {
      eventType: "degradation",
      reasonCode: reason,
      severity: "warning"
    };
  }

  if (reason === "model_error" || reason === "semantic_verifier_error") {
    return {
      eventType: "model_failure",
      reasonCode: reason,
      severity: "critical"
    };
  }

  if (reason === "turn_timeout") {
    return {
      eventType: "model_failure",
      reasonCode: reason,
      severity: "error"
    };
  }

  if (
    reason === "empty_model_response" ||
    reason === "unsafe_model_response" ||
    reason === "grounding_validation_failed"
  ) {
    return {
      eventType: "policy_violation",
      reasonCode: reason,
      severity: "error"
    };
  }

  if (reason === "agent_reply_blocked") {
    return { eventType: "blocked", reasonCode: reason, severity: "info" };
  }

  if (reason === "ai_persistence_unconfirmed") {
    return {
      eventType: "runtime_failure",
      reasonCode: reason,
      severity: "critical"
    };
  }

  return {
    eventType: "degradation",
    reasonCode: normalizeMemoryReasonCode(reason),
    severity: "warning"
  };
}

function normalizeMemoryReasonCode(_value: string): ManagerAiQualitySummary["reasonCode"] {
  return "runtime_failed";
}

function memoryRecordedManagerReviewReason(
  completion: AiRunTerminalCompletion
):
  | "ai_execution_context_invalid"
  | "ai_execution_failed"
  | "ai_no_reply"
  | "ai_reply_persistence_unconfirmed"
  | undefined {
  if (
    completion.sendGateResult === "blocked" ||
    completion.outcomeReason === "agent_reply_blocked" ||
    completion.outcomeReason === "gate_closed" ||
    completion.failureCode === "send_gate_blocked"
  ) {
    return undefined;
  }

  if (
    completion.outcomeReason === "ai_persistence_unconfirmed" ||
    completion.failureCode === "persistence_failure"
  ) {
    return "ai_reply_persistence_unconfirmed";
  }

  if (
    completion.outcomeReason === "execution_context_mismatch" ||
    completion.failureCode === "execution_context_mismatch"
  ) {
    return "ai_execution_context_invalid";
  }

  if (
    completion.outcomeReason === "recorder_failure" ||
    completion.failureCode === "recorder_failure" ||
    completion.failureCode === "runtime_failure"
  ) {
    return "ai_execution_failed";
  }

  return "ai_no_reply";
}

function memoryRecordedJobTerminalReason(completion: AiRunTerminalCompletion): string {
  if (
    completion.sendGateResult === "blocked" ||
    completion.failureCode === "send_gate_blocked" ||
    completion.outcomeReason === "gate_closed" ||
    completion.outcomeReason === "agent_reply_blocked"
  ) {
    return "turn_not_current";
  }

  if (completion.outcomeReason === "missing_provider_config") {
    return "missing_openai_config";
  }

  if (
    completion.outcomeReason === "generator_failed" ||
    completion.failureCode === "runtime_failure"
  ) {
    return "model_error";
  }

  if (
    completion.outcomeReason === "ai_persistence_unconfirmed" ||
    completion.outcomeReason === "recorder_failure" ||
    completion.failureCode === "persistence_failure" ||
    completion.failureCode === "recorder_failure"
  ) {
    return "ai_persistence_unconfirmed";
  }

  if (
    completion.outcomeReason === "candidate_invalid" ||
    completion.outcomeReason === "no_safe_answer" ||
    completion.outcomeReason === "missing_approved_fact" ||
    completion.failureCode === "invalid_candidate"
  ) {
    return "unsafe_model_response";
  }

  return completion.outcomeReason;
}

const CORE_STRUCTURED_INTAKE_SLOTS: readonly AiSlotName[] = [
  "monumentType",
  "material",
  "size",
  "city",
  "installation",
  "desiredTiming",
  "preferredContact"
];

function emptyStructuredIntake(): ManagerLeadDetail["structuredIntake"] {
  return {
    slots: [],
    requirements: [],
    conflicts: [],
    missingFields: [...CORE_STRUCTURED_INTAKE_SLOTS]
  };
}

function markTelegramNotificationPending(lead: ManagerLeadDetail): ManagerLeadDetail {
  return {
    ...lead,
    timeline: lead.timeline.map((event) =>
      event.eventType === "manager.notification_enqueued"
        ? {
            ...event,
            summary: "Telegram manager notification queued",
            metadata: {
              ...event.metadata,
              status: "pending"
            }
          }
        : event
    )
  };
}

function telegramIdentityKey(input: AcceptInboundMessageInput) {
  return `${input.provider}:${input.providerAccountId}:${input.externalChatId}`;
}

function telegramProviderReplayKey(input: AcceptInboundMessageInput) {
  const providerBase = telegramIdentityKey(input);

  if (input.providerMessageId) {
    return `${providerBase}:message:${input.providerMessageId}`;
  }

  if (input.providerUpdateId) {
    return `${providerBase}:update:${input.providerUpdateId}`;
  }

  return null;
}

function statusRequiresNextStep(status: ManagerLeadListItem["status"]) {
  return status === "in_progress" || status === "waiting_response";
}
