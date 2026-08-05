import { randomUUID } from "node:crypto";

import {
  AnySiteWidgetMessageRequestSchema,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";
import { z } from "zod";

import type { AiReplyCandidateEvidence, AiTurnInput } from "../../ai/ai-turn.js";
import {
  AI_SLOT_NAMES,
  AI_HANDOFF_REASONS,
  AI_REQUIREMENT_CATEGORIES,
  AI_REQUIREMENT_MODES,
  AI_TURN_ACTIONS,
  AI_TURN_INTENTS,
  type AiHandoffReason,
  type AiRequirementUpdate,
  type AiSlotName,
  type AiTextEvidence,
  type AiSlotUpdate
} from "../../ai/ai-dialog-contract.js";
import {
  isRequirementValueSupportedByEvidence,
  validateSlotEvidence,
  validateTextEvidence
} from "../../ai/grounding/ai-slot-evidence-service.js";
import { APPROVED_WIDGET_KNOWLEDGE_VERSION } from "../../ai/knowledge/approved-widget-knowledge.js";
import { WIDGET_AI_POLICY_VERSION } from "../../ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../../ai/prompts/widget-ai-prompt.js";
import {
  AgentReplyBlockedError,
  IdempotencyConflictError
} from "../../conversations/repositories/lead-conversation-types.js";
import { buildWidgetAiTurnIdempotencyKey } from "../../conversations/repositories/conversation-message-repository.js";
import type {
  ClaimedSiteWidgetAiJob,
  PublicIntakeRepository,
  SaveAcceptedSiteWidgetMessageResult,
  SiteWidgetAiJobStatus
} from "../../conversations/repositories/public-intake-repository.js";
import {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiUnavailableReason
} from "../ports/public-widget-ai-reply-generator.js";
import type { PublicWidgetAiTurnExecutor } from "../ports/public-widget-ai-turn-executor.js";
import type {
  PublicWidgetManagerReviewReason,
  PublicWidgetManagerReviewRepository
} from "../ports/public-widget-manager-review-repository.js";

export type PublicWidgetIntakeServiceResult = {
  statusCode: number;
  body: SiteWidgetResponse;
};

const INTERNAL_WIDGET_AI_RESULT_VERSION = "internal_widget_ai.v1" as const;

type InternalWidgetAiSuccessResponse = {
  ok: true;
  schema_version: typeof INTERNAL_WIDGET_AI_RESULT_VERSION;
  status: "accepted" | "replayed";
  public_session_id: string;
  public_message_id: string;
  action: "show_widget_saved";
  automation:
    | { status: "disabled"; next_step: "manager_review" }
    | {
        status: "fallback";
        next_step: "manager_review";
        reason: PublicWidgetFallbackReason;
      }
    | {
        status: "degraded";
        next_step: "retry_available";
        conversation_state: "ai_active";
        reason: PublicWidgetAiUnavailableReason | "ai_persistence_unconfirmed";
      }
    | {
        status: "replied";
        next_step: "ai_reply_shown";
        conversation_state: "ai_active" | "manager_pending";
        disclosure: { shown: true; version: string; text: string };
        reply: {
          public_message_id: string;
          sender_role: "ai_assistant";
          text: string;
        };
      };
  message_to_user: string;
};

type InternalWidgetAiServiceResult = {
  statusCode: number;
  body:
    | InternalWidgetAiSuccessResponse
    | {
        ok: false;
        schema_version: typeof INTERNAL_WIDGET_AI_RESULT_VERSION;
        error: {
          type: "retryable_backend_failure";
          code: "persistence_unconfirmed";
          action: "retry_or_show_fallback";
          retry_after_seconds: number;
        };
      };
};

export type PublicWidgetHistoryServiceResult = {
  statusCode: 200 | 404;
  body:
    | {
        ok: true;
        schema_version: "site_widget.history.v1";
        public_session_id: string;
        public_conversation_id: string;
        conversation_state: "ai_active" | "manager_pending" | "manager_active" | "closed";
        messages: Array<{
          public_message_id: string;
          sender_role: "visitor" | "ai_assistant" | "manager";
          text: string;
          submitted_at: string;
        }>;
      }
    | {
        ok: true;
        schema_version: "site_widget.history.v2";
        public_session_id: string;
        public_conversation_id: string;
        conversation_state: "ai_active" | "manager_pending" | "manager_active" | "closed";
        poll_after_ms?: number;
        messages: Array<{
          public_message_id: string;
          sender_role: "visitor" | "ai_assistant" | "manager";
          text: string;
          submitted_at: string;
          delivery_state: "accepted";
          catalog_references?: Array<{
            kind: "catalog_item";
            label: string;
            title: string;
            href: string;
            entity_id: string;
          }>;
          automation?: {
            status: SiteWidgetAiJobStatus;
            reason?: string;
          };
        }>;
      }
    | { ok: false; error: { code: "widget_history_not_found" } };
};

export type ProcessedSiteWidgetAiJobResult = {
  status: "replied" | "degraded" | "blocked" | "superseded";
  terminalReason?: string;
  outputPublicMessageId?: string;
};

export type PublicWidgetIntakeServiceOptions = {
  managerReviewRepository?: PublicWidgetManagerReviewRepository;
  ai?: {
    enabled: boolean;
    turnExecutor?: PublicWidgetAiTurnExecutor;
    jobMaxAttempts?: number;
  };
};

// Stage A has no app-owned approved business fact or price sources yet.
const STAGE_A_APPROVED_BUSINESS_FACT_SOURCE_IDS = new Set<string>();
const STAGE_A_APPROVED_PRICE_SOURCE_IDS = new Set<string>();

export class PublicWidgetIntakeService {
  constructor(
    private readonly repository: PublicIntakeRepository,
    private readonly options: PublicWidgetIntakeServiceOptions = {}
  ) {}

  async getSiteWidgetHistory(
    rawPublicSessionId: string,
    schemaVersion: "site_widget.history.v1" | "site_widget.history.v2" =
      "site_widget.history.v1"
  ): Promise<PublicWidgetHistoryServiceResult> {
    const parsed = z.string().uuid().safeParse(rawPublicSessionId);

    if (!parsed.success || !this.repository.getSiteWidgetHistory) {
      return widgetHistoryNotFound();
    }

    const history = await this.repository.getSiteWidgetHistory(parsed.data);

    if (!history) {
      return widgetHistoryNotFound();
    }

    if (schemaVersion === "site_widget.history.v2") {
      const hasActiveJob = history.messages.some(
        (message) =>
          message.automation?.status === "pending" ||
          message.automation?.status === "processing" ||
          message.automation?.status === "retrying"
      );

      return {
        statusCode: 200,
        body: {
          ok: true,
          schema_version: "site_widget.history.v2",
          public_session_id: history.publicSessionId,
          public_conversation_id: history.publicConversationId,
          conversation_state: history.state,
          poll_after_ms: hasActiveJob ? 700 : undefined,
          messages: history.messages.map((message) => ({
            public_message_id: message.publicMessageId,
            sender_role: message.senderRole,
            text: message.text,
            submitted_at: message.submittedAt,
            delivery_state: "accepted",
            catalog_references: message.catalogReferences?.map((reference) => ({
              kind: reference.kind,
              label: reference.label,
              title: reference.title,
              href: reference.href,
              entity_id: reference.entityId
            })),
            automation: message.automation
          }))
        }
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        schema_version: "site_widget.history.v1",
        public_session_id: history.publicSessionId,
        public_conversation_id: history.publicConversationId,
        conversation_state: history.state,
        messages: history.messages.map((message) => ({
          public_message_id: message.publicMessageId,
          sender_role: message.senderRole,
          text: message.text,
          submitted_at: message.submittedAt
        }))
      }
    };
  }

  async acceptSiteWidgetMessage(rawBody: unknown): Promise<PublicWidgetIntakeServiceResult> {
    const schemaVersion = readSchemaVersion(rawBody);

    if (!schemaVersion) {
      return validationError(
        [{ path: "schema_version", message: "schema_version is required" }],
        "invalid_request",
        400,
        SITE_WIDGET_V2_CONTRACT_VERSION
      );
    }

    if (!SUPPORTED_SITE_WIDGET_VERSIONS.includes(schemaVersion as never)) {
      return {
        statusCode: 422,
        body: {
          ok: false,
          schema_version: schemaVersion,
          error: {
            type: "unsupported_version",
            code: "unsupported_schema_version",
            action: "show_fallback_contact",
            supported_versions: [...SUPPORTED_SITE_WIDGET_VERSIONS]
          }
        }
      };
    }

    const acceptedSchemaVersion = SITE_WIDGET_V2_CONTRACT_VERSION;
    const parsed = AnySiteWidgetMessageRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        })),
        "invalid_request",
        400,
        acceptedSchemaVersion
      );
    }

    const requestFingerprint = sha256Hex(stableStringify(parsed.data));
    const publicSessionId = parsed.data.public_session_id ?? randomUUID();
    const aiTurnExecutor = this.options.ai?.turnExecutor;
    const aiCanRun = this.options.ai?.enabled === true && Boolean(aiTurnExecutor);

    try {
      const saved = await this.repository.saveAcceptedSiteWidgetMessage({
        publicMessageId: randomUUID(),
        publicSessionId,
        agentAllowedToReply: aiCanRun,
        request: parsed.data,
        requestFingerprint,
        enqueueAiJob: aiCanRun,
        aiJobMaxAttempts: this.options.ai?.jobMaxAttempts ?? 3,
        aiJobRuntimeMode: "direct_openai"
      });

      return v2AcceptedSuccess(saved, aiCanRun);
    } catch (error) {
      return persistenceFailure(error, acceptedSchemaVersion);
    }
  }

  async processAcceptedSiteWidgetMessage(
    saved: SaveAcceptedSiteWidgetMessageResult,
    signal?: AbortSignal
  ): Promise<InternalWidgetAiServiceResult> {
      const aiTurnExecutor = this.options.ai?.turnExecutor;

      if (saved.aiReply) {
        return aiReplySuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          saved.aiReply.publicMessageId,
          saved.aiReply.body,
          saved.aiState === "needs_manager" || saved.aiState === "manager_active"
            ? "manager_pending"
            : "ai_active"
        );
      }

      if (!this.options.ai?.enabled) {
        return disabledSuccess(saved.replayed, saved.publicSessionId, saved.publicMessageId);
      }

      if (!aiTurnExecutor) {
        return this.transitionToManagerReviewOr503(
          saved,
          "ai_executor_unavailable",
          "missing_openai_config"
        );
      }

      const aiTurnInput = saved.aiTurnInput;
      const turnIdentity = saved.turnIdentity;

      if (!isReplyCapableSiteWidgetTurn(aiTurnInput) || !turnIdentity) {
        return this.transitionToManagerReviewOr503(
          saved,
          "ai_execution_context_invalid",
          "ai_persistence_unconfirmed"
        );
      }

      const aiInputFingerprint = sha256Hex(stableStringify(aiTurnInput));
      const aiTurnInputWithFingerprint: AiTurnInput = {
        ...aiTurnInput,
        turn: {
          ...aiTurnInput.turn,
          inputFingerprint: aiInputFingerprint
        }
      };

      {
        const executionContext = saved.aiTurnExecutionContext;

        if (!executionContext) {
          return this.transitionToManagerReviewOr503(
            saved,
            "ai_execution_context_invalid",
            "ai_persistence_unconfirmed"
          );
        }

        try {
          throwIfWidgetAiJobAborted(signal);
          const recordedResult = await aiTurnExecutor.execute({
            executionContext: {
              ...executionContext,
              turn: {
                ...executionContext.turn,
                inputFingerprint: aiInputFingerprint
              }
            },
            turnInput: aiTurnInputWithFingerprint,
            signal,
            outbound: {
              publicSessionId: saved.publicSessionId,
              inboundPublicMessageId: saved.publicMessageId,
              sourcePageUrl: aiTurnInputWithFingerprint.page.url,
              aiInputFingerprint,
              idempotencyKey: saved.widgetAiJob
                ? buildWidgetAiTurnIdempotencyKey({
                    conversationId: saved.conversationId,
                    expectedGenerationEpoch: turnIdentity.expectedGenerationEpoch,
                    respondsThroughSequence: turnIdentity.respondsThroughSequence,
                    runtimeMode: saved.widgetAiJob.runtimeMode ?? "direct_openai"
                  })
                : undefined,
              expectedGenerationEpoch: turnIdentity.expectedGenerationEpoch,
              respondsThroughSequence: turnIdentity.respondsThroughSequence,
              runtimeMode: saved.widgetAiJob?.runtimeMode,
              queueWaitMs: saved.widgetAiJob?.queueWaitMs,
              jobCommit: saved.widgetAiJob
                ? {
                    jobId: saved.widgetAiJob.id,
                    attemptCount: saved.widgetAiJob.attemptCount
                  }
                : undefined
            }
          });

          throwIfWidgetAiJobAborted(signal);

          return this.toRecordedTurnResponse(saved, recordedResult);
        } catch (error) {
          throwIfWidgetAiJobAborted(signal);

          if (error instanceof WidgetAiJobExecutionAbortedError) {
            throw error;
          }

          if (error instanceof AgentReplyBlockedError) {
            return fallbackSuccess(
              saved.replayed,
              saved.publicSessionId,
              saved.publicMessageId,
              "agent_reply_blocked"
            );
          }

          if (
            saved.widgetAiJob &&
            this.repository.isSiteWidgetAiJobCurrent &&
            !(await this.repository.isSiteWidgetAiJobCurrent({
              jobId: saved.widgetAiJob.id,
              attemptCount: saved.widgetAiJob.attemptCount
            }))
          ) {
            return fallbackSuccess(
              saved.replayed,
              saved.publicSessionId,
              saved.publicMessageId,
              "agent_reply_blocked"
            );
          }

          return this.transitionToManagerReviewOr503(
            saved,
            "ai_execution_failed",
            "ai_persistence_unconfirmed"
          );
        }
      }

  }

  private async toRecordedTurnResponse(
    saved: SaveAcceptedSiteWidgetMessageResult,
    recordedResult: Awaited<ReturnType<PublicWidgetAiTurnExecutor["execute"]>>
  ): Promise<InternalWidgetAiServiceResult> {
    if (recordedResult.kind === "running_replay") {
      return this.transitionToManagerReviewOr503(
        saved,
        "ai_run_in_progress",
        "ai_persistence_unconfirmed",
        503
      );
    }

    if (recordedResult.kind === "terminal_replay") {
      const reason = publicFallbackReasonForRecordedRun(recordedResult.run);
      const reviewReason = managerReviewReasonForRecordedRun(recordedResult.run);

      if (reviewReason && !saved.widgetAiJob) {
        const transition = await this.transitionToManagerReview(saved, reviewReason);
        if (!transition) {
          return persistenceUnavailable(INTERNAL_WIDGET_AI_RESULT_VERSION);
        }
      }

      return recordedFallbackSuccess(
        true,
        saved.publicSessionId,
        saved.publicMessageId,
        reason
      );
    }

    const outcome = recordedResult.outcome;

    if (outcome.result.status === "persisted" && outcome.persistedReply) {
      return aiReplySuccess(
        saved.replayed,
        saved.publicSessionId,
        saved.publicMessageId,
        outcome.persistedReply.publicMessageId,
        outcome.persistedReply.body,
        "ai_active"
      );
    }

    if (outcome.result.status === "handed_off" && outcome.persistedReply) {
      return aiReplySuccess(
        saved.replayed,
        saved.publicSessionId,
        saved.publicMessageId,
        outcome.persistedReply.publicMessageId,
        outcome.persistedReply.body,
        "manager_pending"
      );
    }

    const reason = publicFallbackReasonForRecordedRun(recordedResult.run);
    const reviewReason = managerReviewReasonForRecordedRun(recordedResult.run);

    if (reviewReason && !saved.widgetAiJob) {
      const transition = await this.transitionToManagerReview(saved, reviewReason);
      if (!transition) {
        return persistenceUnavailable(INTERNAL_WIDGET_AI_RESULT_VERSION);
      }
    }

    return recordedFallbackSuccess(
      saved.replayed,
      saved.publicSessionId,
      saved.publicMessageId,
      reason
    );
  }

  private async transitionToManagerReviewOr503(
    saved: SaveAcceptedSiteWidgetMessageResult,
    reviewReason: PublicWidgetManagerReviewReason,
    publicReason: PublicWidgetFallbackReason,
    statusCode: 202 | 503 = 202
  ): Promise<InternalWidgetAiServiceResult> {
    const transition = await this.transitionToManagerReview(saved, reviewReason);

    if (!transition || statusCode === 503) {
      return persistenceUnavailable(INTERNAL_WIDGET_AI_RESULT_VERSION);
    }

    return recordedFallbackSuccess(
      saved.replayed,
      saved.publicSessionId,
      saved.publicMessageId,
      publicReason
    );
  }

  private async transitionToManagerReview(
    saved: SaveAcceptedSiteWidgetMessageResult,
    reason: PublicWidgetManagerReviewReason
  ): Promise<boolean> {
    if (!this.options.managerReviewRepository || !saved.inboundMessageId) {
      return true;
    }

    try {
      await this.options.managerReviewRepository.transitionSiteWidgetConversationToManagerReview({
        leadId: saved.leadId,
        conversationId: saved.conversationId,
        publicConversationId: saved.publicConversationId,
        inboundMessageId: saved.inboundMessageId,
        inboundPublicMessageId: saved.publicMessageId,
        reason,
        expectedGenerationEpoch: saved.turnIdentity?.expectedGenerationEpoch,
        respondsThroughSequence: saved.turnIdentity?.respondsThroughSequence,
        runtimeMode: saved.widgetAiJob?.runtimeMode,
        jobCommit: saved.widgetAiJob
          ? {
              jobId: saved.widgetAiJob.id,
              attemptCount: saved.widgetAiJob.attemptCount
            }
          : undefined
      });
      return true;
    } catch {
      return false;
    }
  }

  async processClaimedSiteWidgetAiJob(
    job: ClaimedSiteWidgetAiJob,
    signal?: AbortSignal
  ): Promise<ProcessedSiteWidgetAiJobResult> {
    const existingReply = await this.repository.findSiteWidgetAiReply?.(
      job.inboundPublicMessageId
    );

    if (existingReply) {
      return {
        status: "replied",
        outputPublicMessageId: existingReply.publicMessageId
      };
    }

    try {
      const result = await this.processAcceptedSiteWidgetMessage(
        {
          leadId: job.leadId,
          conversationId: job.conversationId,
          publicConversationId: job.publicConversationId,
          channelIdentityId: "",
          publicSessionId: job.publicSessionId,
          publicMessageId: job.inboundPublicMessageId,
          submittedAt: job.aiTurnInput.inboundMessage.submittedAt,
          agentAllowedToReply: job.aiTurnInput.gateSnapshot.agentAllowedToReply,
          aiState: job.aiTurnInput.gateSnapshot.aiState,
          replayed: false,
          aiTurnInput: job.aiTurnInput,
          aiTurnExecutionContext: job.aiTurnExecutionContext,
          turnIdentity: {
            expectedGenerationEpoch: job.expectedGenerationEpoch,
            respondsThroughSequence: job.respondsThroughSequence
          },
          widgetAiJob: job
        },
        signal
      );
      const processed = toProcessedSiteWidgetAiJobResult(result);

      return processed.status === "blocked" && processed.terminalReason === "agent_reply_blocked"
        ? { status: "superseded", terminalReason: "turn_not_current" }
        : processed;
    } catch (error) {
      if (
        (error instanceof WidgetAiJobExecutionAbortedError && error.reason === "job_not_current") ||
        (signal?.aborted && signal.reason === "job_not_current")
      ) {
        return { status: "superseded", terminalReason: "turn_not_current" };
      }

      throw error;
    }
  }
}

class WidgetAiJobExecutionAbortedError extends Error {
  constructor(readonly reason: unknown) {
    super("widget AI job execution aborted");
    this.name = "WidgetAiJobExecutionAbortedError";
  }
}

function throwIfWidgetAiJobAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WidgetAiJobExecutionAbortedError(signal.reason);
  }
}

function v2AcceptedSuccess(
  saved: SaveAcceptedSiteWidgetMessageResult,
  aiCanRun: boolean
): PublicWidgetIntakeServiceResult {
  const managerPending =
    saved.aiState === "needs_manager" || saved.aiState === "manager_active";
  const job = saved.widgetAiJob;
  const automation = saved.aiReply
    ? {
        status: "replied" as const,
        next_step: "history_available" as const,
        conversation_state: managerPending ? ("manager_pending" as const) : ("ai_active" as const)
      }
    : job?.status === "replied"
        ? {
            status: "replied" as const,
            next_step: "history_available" as const,
            conversation_state: managerPending
              ? ("manager_pending" as const)
              : ("ai_active" as const)
          }
        : job?.status === "blocked"
          ? {
              status: "manager_pending" as const,
              next_step: "manager_review" as const,
              conversation_state: "manager_pending" as const,
              reason: toV2ManagerReason(job.terminalReason)
            }
          : job?.status === "degraded" || job?.status === "failed"
            ? {
                status: "degraded" as const,
                next_step: "retry_or_manager" as const,
                conversation_state: "ai_active" as const,
                reason: toV2DegradedReason(job.terminalReason)
              }
            : job?.status === "pending" ||
                job?.status === "processing" ||
                job?.status === "retrying"
              ? {
                  status: "processing" as const,
                  next_step: "poll_history" as const,
                  conversation_state: "ai_active" as const,
                  poll_after_ms: 700
                }
              : !aiCanRun || !saved.agentAllowedToReply || job?.status === "superseded"
                ? {
                    status: "disabled" as const,
                    next_step: "manager_review" as const,
                    conversation_state: "manager_pending" as const
                  }
                : {
                  status: "degraded" as const,
                  next_step: "retry_or_manager" as const,
                  conversation_state: "ai_active" as const,
                  reason: "ai_persistence_unconfirmed" as const
                };

  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      status: saved.replayed ? "replayed" : "accepted",
      public_session_id: saved.publicSessionId,
      public_conversation_id: saved.publicConversationId,
      public_message_id: saved.publicMessageId,
      submitted_at: saved.submittedAt,
      action: "show_widget_saved",
      automation,
      message_to_user:
        automation.status === "processing"
          ? "Сообщение принято. AI-помощник готовит ответ."
          : automation.status === "replied"
            ? "Сообщение принято, ответ доступен в истории диалога."
            : automation.status === "disabled" || automation.status === "manager_pending"
              ? "Сообщение принято. Менеджер увидит его в панели."
              : "Сообщение сохранено. Если AI не ответит, диалог увидит менеджер."
    }
  };
}

function toV2ManagerReason(reason: string | undefined): "agent_reply_blocked" | "handoff" {
  return reason === "handoff" ? "handoff" : "agent_reply_blocked";
}

function toV2DegradedReason(
  reason: string | undefined
):
  | PublicWidgetAiUnavailableReason
  | "ai_persistence_unconfirmed"
  | "worker_failed" {
  return isPublicWidgetAiUnavailableReason(reason) || reason === "ai_persistence_unconfirmed"
    ? reason
    : "worker_failed";
}

function persistenceFailure(
  error: unknown,
  schemaVersion: typeof SITE_WIDGET_V2_CONTRACT_VERSION
): PublicWidgetIntakeServiceResult {
  if (error instanceof IdempotencyConflictError) {
    return validationError(
      [
        {
          path: "idempotency_key",
          message: "idempotency_key was already used for a different widget message"
        }
      ],
      "idempotency_conflict",
      409,
      schemaVersion
    );
  }

  return persistenceUnavailable(schemaVersion);
}

function persistenceUnavailable(
  schemaVersion: typeof INTERNAL_WIDGET_AI_RESULT_VERSION
): InternalWidgetAiServiceResult;
function persistenceUnavailable(
  schemaVersion: typeof SITE_WIDGET_V2_CONTRACT_VERSION
): PublicWidgetIntakeServiceResult;
function persistenceUnavailable(
  schemaVersion:
    | typeof INTERNAL_WIDGET_AI_RESULT_VERSION
    | typeof SITE_WIDGET_V2_CONTRACT_VERSION
): InternalWidgetAiServiceResult | PublicWidgetIntakeServiceResult {
  if (schemaVersion === INTERNAL_WIDGET_AI_RESULT_VERSION) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
        error: {
          type: "retryable_backend_failure",
          code: "persistence_unconfirmed",
          action: "retry_or_show_fallback",
          retry_after_seconds: 30
        }
      }
    };
  }

  return {
    statusCode: 503,
    body: {
      ok: false,
      schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
      error: {
        type: "retryable_backend_failure",
        code: "persistence_unconfirmed",
        action: "retry_or_show_fallback",
        retry_after_seconds: 30
      }
    }
  };
}

function publicFallbackReasonForRecordedRun(run: {
  status: string;
  outcomeReason?: string;
  failureCode?: string;
}): PublicWidgetFallbackReason {
  if (
    run.outcomeReason === "agent_reply_blocked" ||
    run.outcomeReason === "gate_closed" ||
    run.failureCode === "send_gate_blocked"
  ) {
    return "agent_reply_blocked";
  }

  if (
    run.outcomeReason === "ai_persistence_unconfirmed" ||
    run.outcomeReason === "recorder_failure" ||
    run.failureCode === "persistence_failure" ||
    run.failureCode === "recorder_failure"
  ) {
    return "ai_persistence_unconfirmed";
  }

  if (run.outcomeReason === "missing_provider_config") {
    return "missing_openai_config";
  }

  if (
    run.outcomeReason === "generator_failed" ||
    run.failureCode === "runtime_failure"
  ) {
    return "model_error";
  }

  if (isPublicWidgetAiUnavailableReason(run.outcomeReason)) {
    return run.outcomeReason;
  }

  return "unsafe_model_response";
}

function managerReviewReasonForRecordedRun(run: {
  status: string;
  outcomeReason?: string;
  failureCode?: string;
}): PublicWidgetManagerReviewReason | undefined {
  if (
    run.outcomeReason === "agent_reply_blocked" ||
    run.outcomeReason === "gate_closed" ||
    run.failureCode === "send_gate_blocked"
  ) {
    return undefined;
  }

  if (
    run.outcomeReason === "ai_persistence_unconfirmed" ||
    run.failureCode === "persistence_failure"
  ) {
    return "ai_reply_persistence_unconfirmed";
  }

  if (
    run.outcomeReason === "recorder_failure" ||
    run.failureCode === "recorder_failure"
  ) {
    return "ai_execution_failed";
  }

  if (
    run.outcomeReason === "execution_context_mismatch" ||
    run.failureCode === "execution_context_mismatch"
  ) {
    return "ai_execution_context_invalid";
  }

  return "ai_no_reply";
}

function toProcessedSiteWidgetAiJobResult(
  result: InternalWidgetAiServiceResult
): ProcessedSiteWidgetAiJobResult {
  if (!result.body.ok) {
    throw new Error(`widget AI job failed with HTTP ${result.statusCode}`);
  }

  if (result.body.schema_version !== INTERNAL_WIDGET_AI_RESULT_VERSION) {
    throw new Error("widget AI job returned an unexpected contract version");
  }

  if (result.body.automation.status === "replied") {
    return {
      status: "replied",
      terminalReason:
        result.body.automation.conversation_state === "manager_pending"
          ? "handoff"
          : undefined,
      outputPublicMessageId: result.body.automation.reply.public_message_id
    };
  }

  if (result.body.automation.status === "degraded") {
    return {
      status: "degraded",
      terminalReason: result.body.automation.reason
    };
  }

  return {
    status: "blocked",
    terminalReason:
      result.body.automation.status === "fallback"
        ? result.body.automation.reason
        : "agent_reply_blocked"
  };
}

function widgetHistoryNotFound(): PublicWidgetHistoryServiceResult {
  return {
    statusCode: 404,
    body: { ok: false, error: { code: "widget_history_not_found" } }
  };
}

function disabledSuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string
): InternalWidgetAiServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
      status: replayed ? "replayed" : "accepted",
      public_session_id: publicSessionId,
      public_message_id: publicMessageId,
      action: "show_widget_saved",
      automation: {
        status: "disabled",
        next_step: "manager_review"
      },
      message_to_user: "Сообщение принято. Менеджер увидит его в панели."
    }
  };
}

function fallbackSuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string,
  reason: PublicWidgetFallbackReason
): InternalWidgetAiServiceResult {
  if (reason !== "agent_reply_blocked") {
    return {
      statusCode: 202,
      body: {
        ok: true,
        schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
        status: replayed ? "replayed" : "accepted",
        public_session_id: publicSessionId,
        public_message_id: publicMessageId,
        action: "show_widget_saved",
        automation: {
          status: "degraded",
          next_step: "retry_available",
          conversation_state: "ai_active",
          reason
        },
        message_to_user:
          "Сообщение сохранено, но AI не смог ответить на этот ход. Можно продолжить диалог или повторить вопрос."
      }
    };
  }

  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
      status: replayed ? "replayed" : "accepted",
      public_session_id: publicSessionId,
      public_message_id: publicMessageId,
      action: "show_widget_saved",
      automation: {
        status: "fallback",
        next_step: "manager_review",
        reason
      },
      message_to_user:
        "Сообщение принято. AI-ответ сейчас недоступен, менеджер увидит диалог в панели."
    }
  };
}

function recordedFallbackSuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string,
  reason: PublicWidgetFallbackReason
): InternalWidgetAiServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
      status: replayed ? "replayed" : "accepted",
      public_session_id: publicSessionId,
      public_message_id: publicMessageId,
      action: "show_widget_saved",
      automation: {
        status: "fallback",
        next_step: "manager_review",
        reason
      },
      message_to_user:
        "Сообщение принято. AI-ответ сейчас недоступен, менеджер увидит диалог в панели."
    }
  };
}

type PublicWidgetFallbackReason =
  | PublicWidgetAiUnavailableReason
  | "agent_reply_blocked"
  | "ai_persistence_unconfirmed";

type ValidatedAiReplyCandidate =
  | {
      status: "replied";
      text: string;
      agentAllowedToReplyAfterSend?: boolean;
      slotUpdates?: AiSlotUpdate[];
      requirementUpdates?: AiRequirementUpdate[];
      action?: (typeof AI_TURN_ACTIONS)[number];
      intent?: (typeof AI_TURN_INTENTS)[number];
      handoffReason?: AiHandoffReason;
      metadata: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reason: PublicWidgetAiUnavailableReason;
      metadata?: Record<string, unknown>;
    };

function aiReplySuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string,
  publicReplyMessageId: string,
  replyText: string,
  conversationState: "ai_active" | "manager_pending"
): InternalWidgetAiServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: INTERNAL_WIDGET_AI_RESULT_VERSION,
      status: replayed ? "replayed" : "accepted",
      public_session_id: publicSessionId,
      public_message_id: publicMessageId,
      action: "show_widget_saved",
      automation: {
        status: "replied",
        next_step: "ai_reply_shown",
        conversation_state: conversationState,
        disclosure: {
          shown: true,
          version: WIDGET_AI_DISCLOSURE_VERSION,
          text: WIDGET_AI_DISCLOSURE_TEXT
        },
        reply: {
          public_message_id: publicReplyMessageId,
          sender_role: "ai_assistant",
          text: replyText
        }
      },
      message_to_user: "AI-помощник ответил. Важные условия подтвердит менеджер."
    }
  }
}

function validationError(
  fields: SiteWidgetValidationIssue[],
  code: "invalid_request" | "idempotency_conflict" = "invalid_request",
  statusCode = 400,
  schemaVersion: typeof SITE_WIDGET_V2_CONTRACT_VERSION = SITE_WIDGET_V2_CONTRACT_VERSION
): PublicWidgetIntakeServiceResult {
  return {
    statusCode,
    body: {
      ok: false,
      schema_version: schemaVersion,
      error: {
        type: "validation",
        code,
        action: "show_validation_errors",
        fields
      }
    }
  };
}

function readSchemaVersion(rawBody: unknown): string | null {
  if (!rawBody || typeof rawBody !== "object" || !("schema_version" in rawBody)) {
    return null;
  }

  const value = (rawBody as { schema_version?: unknown }).schema_version;
  return typeof value === "string" ? value : null;
}

function isReplyCapableSiteWidgetTurn(input: AiTurnInput | undefined): input is AiTurnInput {
  return (
    Boolean(input) &&
    input?.channel === "site_widget" &&
    input.replyCapability === "site_widget_sync_reply"
  );
}

function validateAiReplyCandidate(
  value: unknown,
  input: AiTurnInput
): ValidatedAiReplyCandidate {
  if (!isRecord(value)) {
    return unavailable("unsafe_model_response");
  }

  if (value.decision === "no_reply") {
    return {
      status: "unavailable",
      reason: isPublicWidgetAiUnavailableReason(value.reason)
        ? value.reason
        : "unsafe_model_response",
      metadata: isRecord(value.metadata) ? value.metadata : undefined
    };
  }

  if (value.decision !== "reply_candidate") {
    return unavailable("unsafe_model_response");
  }

  if (!isRecord(value.metadata)) {
    return unavailable("unsafe_model_response");
  }

  if (
    "agentAllowedToReplyAfterSend" in value &&
    value.agentAllowedToReplyAfterSend !== undefined &&
    typeof value.agentAllowedToReplyAfterSend !== "boolean"
  ) {
    return unavailable("unsafe_model_response");
  }

  const text = typeof value.text === "string" ? normalizeCandidateText(value.text) : "";

  if (!text) {
    return unavailable(
      typeof value.text === "string" ? "empty_model_response" : "unsafe_model_response"
    );
  }

  const groundingVerified = value.metadata.grounding_verified === true;
  const evidence = isRecord(value.evidence) ? readCandidateEvidence(value.evidence) : undefined;

  if (!groundingVerified && hasBusinessFactWithoutAppApprovedSource(evidence)) {
    return unavailable("unsafe_model_response");
  }

  const unsafeReason = groundingVerified ? null : unsafeCandidateReplyReason(text, evidence);

  if (unsafeReason) {
    return unavailable("unsafe_model_response");
  }

  const action = readEnumValue(value.action, AI_TURN_ACTIONS);
  const intent = readEnumValue(value.intent, AI_TURN_INTENTS);
  const requestedSlots = readRequestedSlots(value.requestedSlots);
  const slotUpdates = readSlotUpdates(value.slotUpdates, input, groundingVerified);
  const requirementUpdates = readRequirementUpdates(
    value.requirementUpdates,
    input,
    groundingVerified
  );
  const sourceEvidenceIsValid = hasValidTypedSourceEvidence(value.sourceEvidence, input);
  const handoffReason = readEnumValue(value.handoffReason, AI_HANDOFF_REASONS);

  if (
    ("action" in value && value.action !== undefined && !action) ||
    ("intent" in value && value.intent !== undefined && !intent) ||
    ("handoffReason" in value && value.handoffReason !== undefined && !handoffReason) ||
    requestedSlots === null ||
    slotUpdates === null ||
    requirementUpdates === null ||
    !sourceEvidenceIsValid ||
    action === "block" ||
    action === "fallback"
  ) {
    return unavailable("unsafe_model_response");
  }

  const requestedSlot = requestedSlots?.[0];

  if (
    requestedSlot &&
    (input.knownSlots.values[requestedSlot] ||
      slotUpdates?.some((slot) => slot.name === requestedSlot))
  ) {
    return unavailable("unsafe_model_response");
  }

  if (action === "clarify" && requestedSlots?.length !== 1) {
    return unavailable("unsafe_model_response");
  }

  if (action === "handoff" && !handoffReason) {
    return unavailable("unsafe_model_response");
  }

  return {
    status: "replied",
    text,
    agentAllowedToReplyAfterSend:
      action === "handoff"
        ? false
        : typeof value.agentAllowedToReplyAfterSend === "boolean"
        ? value.agentAllowedToReplyAfterSend
        : undefined,
    slotUpdates: slotUpdates ?? undefined,
    requirementUpdates: requirementUpdates ?? undefined,
    action,
    intent,
    handoffReason,
    metadata: value.metadata
  };
}

async function recordDegradationIfPossible(
  repository: PublicIntakeRepository,
  saved: {
    leadId: string;
    conversationId: string;
    publicMessageId: string;
    aiTurnInput?: AiTurnInput;
  },
  reason: PublicWidgetAiUnavailableReason
) {
  if (!repository.recordSiteWidgetAiDegradation || !saved.aiTurnInput) {
    return;
  }

  const inputFingerprint = sha256Hex(stableStringify(saved.aiTurnInput));
  await repository.recordSiteWidgetAiDegradation({
    leadId: saved.leadId,
    conversationId: saved.conversationId,
    inboundPublicMessageId: saved.publicMessageId,
    inputFingerprint,
    reason,
    metadata: {
      prompt_version: WIDGET_AI_PROMPT_VERSION,
      policy_version: WIDGET_AI_POLICY_VERSION,
      knowledge_version: APPROVED_WIDGET_KNOWLEDGE_VERSION
    }
  }).catch(() => undefined);
}

function buildSlotSnapshot(
  input: AiTurnInput,
  updates: AiSlotUpdate[] | undefined,
  requirementUpdates: AiRequirementUpdate[] | undefined
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  for (const [name, slot] of Object.entries(input.knownSlots.values)) {
    if (slot) {
      snapshot[name] = slot.value;
    }
  }

  for (const slot of updates ?? []) {
    snapshot[slot.name] = slot.value;
  }

  const requirements = [
    ...input.knownRequirements,
    ...(requirementUpdates ?? [])
  ].map((requirement) => ({
    category: requirement.category,
    mode: requirement.mode,
    value: requirement.value
  }));

  if (requirements.length) {
    snapshot.requirements = requirements;
  }

  return snapshot;
}

function buildHandoffSummary(input: AiTurnInput, updates: AiSlotUpdate[] | undefined): string {
  const summaryUpdate = updates?.find((slot) => slot.name === "questionSummary");
  return (summaryUpdate?.value ?? input.inboundMessage.text).trim().slice(0, 900);
}

function readOptionalMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function hasValidTypedSourceEvidence(value: unknown, input: AiTurnInput): boolean {
  if (value === undefined) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.sourceId !== "string" ||
      typeof candidate.version !== "string"
    ) {
      return false;
    }

    if (candidate.kind === "price") {
      return false;
    }

    return (
      candidate.kind === "business_fact" &&
      input.approvedSources.businessFacts.some(
        (source) =>
          source.sourceId === candidate.sourceId &&
          source.version === candidate.version
      )
    );
  });
}

function readRequestedSlots(value: unknown): AiSlotName[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > 1) {
    return null;
  }

  const slots = value.filter(isAiSlotName);
  return slots.length === value.length ? slots : null;
}

function readSlotUpdates(
  value: unknown,
  input: AiTurnInput,
  requireEvidence = false
): AiSlotUpdate[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > AI_SLOT_NAMES.length) {
    return null;
  }

  const updates: AiSlotUpdate[] = [];
  const names = new Set<AiSlotName>();

  for (const candidate of value) {
    if (!isRecord(candidate) || !isAiSlotName(candidate.name)) {
      return null;
    }

    const evidence = readSlotEvidence(candidate.evidence);
    const legacyCurrentMessageEvidence =
      !requireEvidence &&
      !evidence &&
      candidate.sourceMessageId === input.inboundMessage.publicMessageId;
    const groundedEvidenceIsValid =
      evidence &&
      evidence.messageId === candidate.sourceMessageId &&
      typeof candidate.value === "string" &&
      !validateSlotEvidence(candidate.name as AiSlotName, candidate.value, evidence, input);

    if (
      names.has(candidate.name) ||
      typeof candidate.value !== "string" ||
      !candidate.value.trim() ||
      candidate.value.trim().length > 240 ||
      candidate.source !== "ai_extraction" ||
      typeof candidate.sourceMessageId !== "string" ||
      (!legacyCurrentMessageEvidence && !groundedEvidenceIsValid) ||
      typeof candidate.confidence !== "number" ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      return null;
    }

    names.add(candidate.name);
    updates.push({
      name: candidate.name,
      value: candidate.value.trim(),
      source: "ai_extraction",
      sourceMessageId: candidate.sourceMessageId,
      evidence,
      confidence: candidate.confidence
    });
  }

  return updates;
}

function readRequirementUpdates(
  value: unknown,
  input: AiTurnInput,
  requireEvidence = false
): AiRequirementUpdate[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > 24) {
    return null;
  }

  const updates: AiRequirementUpdate[] = [];
  const keys = new Set<string>();

  for (const candidate of value) {
    if (!isRecord(candidate)) {
      return null;
    }

    const category = readEnumValue(candidate.category, AI_REQUIREMENT_CATEGORIES);
    const mode = readEnumValue(candidate.mode, AI_REQUIREMENT_MODES);
    const evidence = readSlotEvidence(candidate.evidence);
    const currentMessageEvidence =
      evidence &&
      evidence.messageId === candidate.sourceMessageId &&
      !validateTextEvidence(evidence, input) &&
      typeof candidate.value === "string" &&
      isRequirementValueSupportedByEvidence(candidate.value, evidence.quote);

    if (
      !category ||
      !mode ||
      typeof candidate.value !== "string" ||
      !candidate.value.trim() ||
      candidate.value.trim().length > 240 ||
      candidate.source !== "ai_extraction" ||
      typeof candidate.sourceMessageId !== "string" ||
      (!currentMessageEvidence && requireEvidence) ||
      (!currentMessageEvidence && candidate.evidence !== undefined) ||
      typeof candidate.confidence !== "number" ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      return null;
    }

    const normalizedValue = candidate.value.trim();
    const key = `${category}:${mode}:${normalizedValue.toLocaleLowerCase("ru-RU")}`;

    if (keys.has(key) || !evidence) {
      return null;
    }

    keys.add(key);
    updates.push({
      category,
      mode,
      value: normalizedValue,
      confidence: candidate.confidence,
      evidence,
      source: "ai_extraction",
      sourceMessageId: candidate.sourceMessageId
    });
  }

  return updates;
}

function readSlotEvidence(value: unknown): AiTextEvidence | undefined {
  if (
    !isRecord(value) ||
    typeof value.messageId !== "string" ||
    typeof value.quote !== "string" ||
    !value.quote ||
    typeof value.start !== "number" ||
    typeof value.end !== "number"
  ) {
    return undefined;
  }

  return {
    messageId: value.messageId,
    quote: value.quote,
    start: value.start,
    end: value.end
  };
}

function isAiSlotName(value: unknown): value is AiSlotName {
  return typeof value === "string" && AI_SLOT_NAMES.includes(value as AiSlotName);
}

function readEnumValue<T extends readonly string[]>(
  value: unknown,
  values: T
): T[number] | undefined {
  return typeof value === "string" && values.includes(value) ? value : undefined;
}

function unavailable(reason: PublicWidgetAiUnavailableReason): ValidatedAiReplyCandidate {
  return {
    status: "unavailable",
    reason
  };
}

function isPublicWidgetAiUnavailableReason(
  value: unknown
): value is PublicWidgetAiUnavailableReason {
  return (
    value === "missing_openai_config" ||
    value === "model_error" ||
    value === "empty_model_response" ||
    value === "unsafe_model_response" ||
    value === "semantic_verifier_error" ||
    value === "grounding_validation_failed" ||
    value === "turn_timeout"
  );
}

function normalizeCandidateText(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n").slice(0, 900);
}

function readCandidateEvidence(value: Record<string, unknown>): AiReplyCandidateEvidence {
  const businessFacts: AiReplyCandidateEvidence["businessFacts"] = Array.isArray(
    value.businessFacts
  )
    ? value.businessFacts.map((fact) => {
        if (!isRecord(fact)) {
          return { kind: "business_fact" as const };
        }

        const kind: "price" | "business_fact" =
          fact.kind === "price" ? "price" : "business_fact";
        const approvedSourceId =
          typeof fact.approvedSourceId === "string" && fact.approvedSourceId.trim()
            ? fact.approvedSourceId
            : undefined;

        return {
          kind,
          approvedSourceId
        };
      })
    : undefined;

  return { businessFacts };
}

function hasBusinessFactWithoutAppApprovedSource(evidence: AiReplyCandidateEvidence | undefined) {
  return Boolean(
    evidence?.businessFacts?.some(
      (fact) => !isAppApprovedBusinessFactSource(fact.kind, fact.approvedSourceId)
    )
  );
}

function unsafeCandidateReplyReason(
  text: string,
  evidence: AiReplyCandidateEvidence | undefined
): string | null {
  const normalized = text.toLocaleLowerCase("ru-RU");

  if (hasStageAPriceAmountOrOrientation(normalized) && !hasAppApprovedPriceSource(evidence)) {
    return "price_amount_without_approved_source";
  }

  if (/(?:за|через)\s+\d+\s*(?:дн|час|нед|месяц)|\d+\s*(?:дн|час|нед|месяц)|будет готов|точн(?:о|ые сроки)|к\s+\d{1,2}[./]\d{1,2}/i.test(normalized)) {
    return "exact_deadline_promise";
  }

  if (/(гарантируем|предоставим гарантию|скидк[ауи]\s*\d|в наличии|заключим договор|подпишем договор|можно оплатить|рассрочк[ау])/i.test(normalized)) {
    return "binding_terms_promise";
  }

  if (/(по закону|юридическ(?:ая консультация|ие советы|и можно|и нужно)|наследств|оформить захоронение|похоронные документы)/i.test(normalized)) {
    return "legal_funeral_advice";
  }

  return null;
}

function hasStageAPriceAmountOrOrientation(normalized: string) {
  if (/\d[\d\s]*(?:₽|руб|р\.)/i.test(normalized)) {
    return true;
  }

  if (!/(цен|стоим|стоить|стоит|прайс|бюджет|сумм)/i.test(normalized)) {
    return false;
  }

  return /(?:^|\s)(?:от|примерно|ориентир(?:овочно)?|порядка|около|в районе)\s+\d[\d\s]*(?:тыс|тысяч)?|\d[\d\s]*(?:[-–—]|\s+до\s+)\d[\d\s]*(?:тыс|тысяч)?|(?:^|\s)\d[\d\s]{3,}(?:[.,!?]|\s|$)|(?:^|\s)\d+\s*(?:тыс|тысяч)/i.test(
    normalized
  );
}

function hasAppApprovedPriceSource(evidence: AiReplyCandidateEvidence | undefined) {
  return Boolean(
    evidence?.businessFacts?.some(
      (fact) =>
        fact.kind === "price" && isAppApprovedBusinessFactSource(fact.kind, fact.approvedSourceId)
    )
  );
}

function isAppApprovedBusinessFactSource(
  kind: "price" | "business_fact",
  approvedSourceId: string | undefined
) {
  if (!approvedSourceId?.trim()) {
    return false;
  }

  return kind === "price"
    ? STAGE_A_APPROVED_PRICE_SOURCE_IDS.has(approvedSourceId.trim())
    : STAGE_A_APPROVED_BUSINESS_FACT_SOURCE_IDS.has(approvedSourceId.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
