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
import { executeLegacyS05Turn } from "../../ai/profiles/legacy-s05/legacy-s05-orchestrator.js";
import {
  AgentReplyBlockedError,
  IdempotencyConflictError
} from "../../conversations/repositories/lead-conversation-types.js";
import type { PublicIntakeRepository } from "../../conversations/repositories/public-intake-repository.js";
import {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator,
  type PublicWidgetAiUnavailableReason
} from "../ports/public-widget-ai-reply-generator.js";

export type PublicWidgetIntakeServiceResult = {
  statusCode: number;
  body: SiteWidgetResponse;
};

export type PublicWidgetIntakeServiceOptions = {
  ai?: {
    enabled: boolean;
    replyGenerator?: PublicWidgetAiReplyGenerator;
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
    const aiCanRun = this.options.ai?.enabled === true && Boolean(aiReplyGenerator);

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
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "missing_openai_config"
        );
      }

      if (!saved.agentAllowedToReply) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "agent_reply_blocked"
        );
      }

      const aiTurnInput = saved.aiTurnInput;
      const aiTurnExecutionContext = saved.aiTurnExecutionContext;

      if (!isReplyCapableSiteWidgetTurn(aiTurnInput) || !aiTurnExecutionContext) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "ai_persistence_unconfirmed"
        );
      }

      if (
        aiTurnExecutionContext.internal.leadId !== saved.leadId ||
        aiTurnExecutionContext.internal.conversationId !== saved.conversationId ||
        aiTurnExecutionContext.internal.inboundMessageId !== saved.inboundMessageId
      ) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "ai_persistence_unconfirmed"
        );
      }

      if (!aiTurnInput.conversation.agentAllowedToReply) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "agent_reply_blocked"
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
      const aiTurnExecutionContextWithFingerprint = {
        ...aiTurnExecutionContext,
        turn: {
          ...aiTurnExecutionContext.turn,
          inputFingerprint: aiInputFingerprint
        }
      };
      const outcome = await executeLegacyS05Turn({
        executionContext: aiTurnExecutionContextWithFingerprint,
        turnInput: aiTurnInputWithFingerprint,
        generator: aiReplyGenerator,
        applier: {
          persistReply: async (reply) => {
            try {
              const outboundFingerprint = sha256Hex(
                stableStringify({
                  outbound_kind: "site_widget_ai_reply",
                  inbound_public_message_id: saved.publicMessageId,
                  public_conversation_id: saved.publicConversationId,
                  body: reply.replyDraft,
                  metadata: reply.metadata
                })
              );
              const persistedAiReply = await this.repository.saveSiteWidgetAiMessage({
                leadId: reply.executionContext.internal.leadId,
                conversationId: reply.executionContext.internal.conversationId,
                publicMessageId: randomUUID(),
                inboundPublicMessageId: saved.publicMessageId,
                idempotencyKey: `ai:${saved.publicMessageId}`,
                requestFingerprint: outboundFingerprint,
                body: reply.replyDraft,
                sourcePageUrl: aiTurnInputWithFingerprint.page.url,
                agentAllowedToReplyAfterSend:
                  reply.action === "handoff_to_manager" ? false : undefined,
                metadata: {
                  ...reply.metadata,
                  channel: "site_widget",
                  public_session_id: saved.publicSessionId,
                  inbound_public_message_id: saved.publicMessageId,
                  ai_input_fingerprint: aiInputFingerprint
                }
              });

              return {
                status: "persisted" as const,
                internalMessageId: persistedAiReply.internalMessageId,
                publicMessageId: persistedAiReply.publicMessageId,
                body: persistedAiReply.body
              };
            } catch (error) {
              return {
                status: "blocked" as const,
                reason:
                  error instanceof AgentReplyBlockedError
                    ? ("agent_reply_blocked" as const)
                    : ("ai_persistence_unconfirmed" as const)
              };
            }
          }
        }
      });

      if (outcome.decision.action === "no_reply") {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          outcome.decision.reason
        );
      }

      if (!outcome.persistedReply) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          outcome.result.status === "blocked" &&
            outcome.result.reason === "agent_reply_blocked"
            ? "agent_reply_blocked"
            : "ai_persistence_unconfirmed"
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
