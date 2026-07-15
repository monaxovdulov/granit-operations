import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  SiteWidgetMessageRequestSchema,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";

import type { AiTurnInput } from "../../ai/ai-turn.js";
import { IdempotencyConflictError } from "../../conversations/repositories/lead-conversation-types.js";
import type {
  PublicIntakeRepository,
  SaveAcceptedSiteWidgetMessageResult
} from "../../conversations/repositories/public-intake-repository.js";
import {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator,
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

export type PublicWidgetIntakeServiceOptions = {
  managerReviewRepository?: PublicWidgetManagerReviewRepository;
  ai?: {
    enabled: boolean;
    replyGenerator?: PublicWidgetAiReplyGenerator;
    turnExecutor?: PublicWidgetAiTurnExecutor;
  };
};

export class PublicWidgetIntakeService {
  constructor(
    private readonly repository: PublicIntakeRepository,
    private readonly options: PublicWidgetIntakeServiceOptions = {}
  ) {}

  async acceptSiteWidgetMessage(rawBody: unknown): Promise<PublicWidgetIntakeServiceResult> {
    const schemaVersion = readSchemaVersion(rawBody);

    if (!schemaVersion) {
      return validationError([{ path: "schema_version", message: "schema_version is required" }]);
    }

    if (schemaVersion !== SITE_WIDGET_CONTRACT_VERSION) {
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

    const parsed = SiteWidgetMessageRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      );
    }

    const requestFingerprint = sha256Hex(stableStringify(parsed.data));
    const publicSessionId = parsed.data.public_session_id ?? randomUUID();
    const aiReplyGenerator = this.options.ai?.replyGenerator;
    const aiTurnExecutor = this.options.ai?.turnExecutor;
    const aiCanRun =
      this.options.ai?.enabled === true && Boolean(aiReplyGenerator) && Boolean(aiTurnExecutor);

    try {
      const saved = await this.repository.saveAcceptedSiteWidgetMessage({
        publicMessageId: randomUUID(),
        publicSessionId,
        agentAllowedToReply: aiCanRun,
        request: parsed.data,
        requestFingerprint
      });

      if (saved.aiReply) {
        return aiReplySuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          saved.aiReply.publicMessageId,
          saved.aiReply.body
        );
      }

      if (!this.options.ai?.enabled) {
        return disabledSuccess(saved.replayed, saved.publicSessionId, saved.publicMessageId);
      }

      if (!aiReplyGenerator) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_executor_unavailable",
          "missing_openai_config"
        );
      }

      if (!aiTurnExecutor) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_executor_unavailable",
          "ai_persistence_unconfirmed"
        );
      }

      if (!saved.agentAllowedToReply && !saved.replayed) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_send_gate_blocked",
          "agent_reply_blocked"
        );
      }

      const aiTurnInput = saved.aiTurnInput;
      const aiTurnExecutionContext = saved.aiTurnExecutionContext;

      if (!isReplyCapableSiteWidgetTurn(aiTurnInput) || !aiTurnExecutionContext) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_execution_context_invalid",
          "ai_persistence_unconfirmed"
        );
      }

      if (
        aiTurnExecutionContext.internal.leadId !== saved.leadId ||
        aiTurnExecutionContext.internal.conversationId !== saved.conversationId ||
        aiTurnExecutionContext.internal.inboundMessageId !== saved.inboundMessageId
      ) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_execution_context_invalid",
          "ai_persistence_unconfirmed"
        );
      }

      if (!aiTurnInput.conversation.agentAllowedToReply && !saved.replayed) {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_send_gate_blocked",
          "agent_reply_blocked"
        );
      }

      const aiInputFingerprint = siteWidgetAiInputFingerprint(aiTurnInput);
      const aiTurnInputWithFingerprint: AiTurnInput = {
        ...aiTurnInput,
        turn: {
          ...aiTurnInput.turn,
          inputFingerprint: aiInputFingerprint
        }
      };
      const aiTurnExecutionContextWithFingerprint = {
        ...aiTurnExecutionContext,
        turn: {
          ...aiTurnExecutionContext.turn,
          inputFingerprint: aiInputFingerprint
        }
      };
      let execution;

      try {
        execution = await aiTurnExecutor.execute({
          executionContext: aiTurnExecutionContextWithFingerprint,
          turnInput: aiTurnInputWithFingerprint,
          generator: aiReplyGenerator,
          outbound: {
            publicSessionId: saved.publicSessionId,
            inboundPublicMessageId: saved.publicMessageId,
            sourcePageUrl: aiTurnInputWithFingerprint.page.url,
            aiInputFingerprint
          }
        });
      } catch {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_execution_failed",
          "ai_persistence_unconfirmed"
        );
      }

      if (execution.kind === "running_replay") {
        await this.transitionToManagerReview(saved, "ai_run_in_progress");
        throw new WidgetAiRunInProgressError();
      }

      if (execution.kind === "terminal_replay") {
        return await this.fallbackWithManagerReview(
          saved,
          terminalReplayManagerReviewReason(execution.run),
          terminalReplayFallbackReason(execution.run),
          true
        );
      }

      const outcome = execution.outcome;

      if (outcome.decision.action === "no_reply") {
        return await this.fallbackWithManagerReview(
          saved,
          "ai_no_reply",
          outcome.decision.reason
        );
      }

      if (!outcome.persistedReply) {
        const sendGateBlocked =
          outcome.result.status === "blocked" &&
          outcome.result.reason === "agent_reply_blocked";

        return await this.fallbackWithManagerReview(
          saved,
          sendGateBlocked
            ? "ai_send_gate_blocked"
            : "ai_reply_persistence_unconfirmed",
          sendGateBlocked ? "agent_reply_blocked" : "ai_persistence_unconfirmed"
        );
      }

      return aiReplySuccess(
        saved.replayed,
        saved.publicSessionId,
        saved.publicMessageId,
        outcome.persistedReply.publicMessageId,
        outcome.persistedReply.body
      );
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return validationError(
          [
            {
              path: "idempotency_key",
              message: "idempotency_key was already used for a different widget message"
            }
          ],
          "idempotency_conflict",
          409
        );
      }

      return {
        statusCode: 503,
        body: {
          ok: false,
          schema_version: SITE_WIDGET_CONTRACT_VERSION,
          error: {
            type: "retryable_backend_failure",
            code: "persistence_unconfirmed",
            action: "retry_or_show_fallback",
            retry_after_seconds: 30
          }
        }
      };
    }
  }

  private async fallbackWithManagerReview(
    saved: SaveAcceptedSiteWidgetMessageResult,
    managerReviewReason: PublicWidgetManagerReviewReason,
    fallbackReason: PublicWidgetFallbackReason,
    replayed = saved.replayed
  ): Promise<PublicWidgetIntakeServiceResult> {
    await this.transitionToManagerReview(saved, managerReviewReason);

    return fallbackSuccess(
      replayed,
      saved.publicSessionId,
      saved.publicMessageId,
      fallbackReason
    );
  }

  private async transitionToManagerReview(
    saved: SaveAcceptedSiteWidgetMessageResult,
    reason: PublicWidgetManagerReviewReason
  ): Promise<void> {
    const repository = this.options.managerReviewRepository;

    if (!repository) {
      throw new Error("site widget manager review persistence is unavailable");
    }

    await repository.transitionSiteWidgetConversationToManagerReview({
      leadId: saved.leadId,
      conversationId: saved.conversationId,
      publicConversationId: saved.publicConversationId,
      inboundMessageId: saved.inboundMessageId,
      inboundPublicMessageId: saved.publicMessageId,
      reason
    });
  }
}

class WidgetAiRunInProgressError extends Error {
  constructor() {
    super("widget AI run is still in progress");
    this.name = "WidgetAiRunInProgressError";
  }
}

function terminalReplayFallbackReason(run: {
  status: string;
  outcomeReason: string;
}): PublicWidgetFallbackReason {
  switch (run.outcomeReason) {
    case "missing_provider_config":
      return "missing_openai_config";
    case "model_error":
      return "model_error";
    case "empty_model_response":
      return "empty_model_response";
    case "unsafe_model_response":
    case "execution_context_mismatch":
    case "candidate_invalid":
      return "unsafe_model_response";
    case "agent_reply_blocked":
    case "gate_closed":
      return "agent_reply_blocked";
    default:
      return "ai_persistence_unconfirmed";
  }
}

function terminalReplayManagerReviewReason(run: {
  status: string;
  outcomeReason: string;
  sendGateResult: string;
}): PublicWidgetManagerReviewReason {
  if (
    run.sendGateResult === "blocked" ||
    run.outcomeReason === "agent_reply_blocked" ||
    run.outcomeReason === "gate_closed"
  ) {
    return "ai_send_gate_blocked";
  }

  if (run.status === "failed" || run.outcomeReason === "ai_persistence_unconfirmed") {
    return "ai_reply_persistence_unconfirmed";
  }

  return "ai_no_reply";
}

function disabledSuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string
): PublicWidgetIntakeServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
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
): PublicWidgetIntakeServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
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

function siteWidgetAiInputFingerprint(input: AiTurnInput): string {
  const { conversation, gateSnapshot: _gateSnapshot, ...immutableTurn } = input;

  // The conversation gate is mutable after acceptance (manager takeover/fail-closed review).
  // Replay identity must remain tied to the accepted inbound and bounded context, while the
  // current gate is still enforced independently before any outbound persistence.
  return sha256Hex(
    stableStringify({
      ...immutableTurn,
      conversation: { publicConversationId: conversation.publicConversationId }
    })
  );
}

function aiReplySuccess(
  replayed: boolean,
  publicSessionId: string,
  publicMessageId: string,
  publicReplyMessageId: string,
  replyText: string
): PublicWidgetIntakeServiceResult {
  return {
    statusCode: 202,
    body: {
      ok: true,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
      status: replayed ? "replayed" : "accepted",
      public_session_id: publicSessionId,
      public_message_id: publicMessageId,
      action: "show_widget_saved",
      automation: {
        status: "replied",
        next_step: "ai_reply_shown",
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
  statusCode = 400
): PublicWidgetIntakeServiceResult {
  return {
    statusCode,
    body: {
      ok: false,
      schema_version: SITE_WIDGET_CONTRACT_VERSION,
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
