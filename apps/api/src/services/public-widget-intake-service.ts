import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  SiteWidgetMessageRequestSchema,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";

import {
  AgentReplyBlockedError,
  IdempotencyConflictError,
  type IntakeRepository
} from "../repositories/intake-repository.js";
import {
  WidgetAiService,
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type WidgetAiProvider
} from "./widget-ai-service.js";

export type PublicWidgetIntakeServiceResult = {
  statusCode: number;
  body: SiteWidgetResponse;
};

export type PublicWidgetIntakeServiceOptions = {
  ai?: {
    enabled: boolean;
    provider?: WidgetAiProvider;
    modelName?: string;
  };
};

export class PublicWidgetIntakeService {
  private readonly aiService: WidgetAiService;

  constructor(
    private readonly repository: IntakeRepository,
    private readonly options: PublicWidgetIntakeServiceOptions = {}
  ) {
    this.aiService = new WidgetAiService({
      provider: options.ai?.provider,
      modelName: options.ai?.modelName
    });
  }

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
    const aiCanRun = this.options.ai?.enabled === true && Boolean(this.options.ai.provider);

    try {
      const saved = await this.repository.saveAcceptedSiteWidgetMessage({
        publicMessageId: randomUUID(),
        publicSessionId,
        agentAllowedToReply: aiCanRun,
        request: parsed.data,
        requestFingerprint
      });

      if (!this.options.ai?.enabled) {
        return disabledSuccess(saved.replayed, saved.publicSessionId, saved.publicMessageId);
      }

      if (!this.options.ai.provider) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          "missing_openai_config"
        );
      }

      if (saved.aiReply) {
        return aiReplySuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          saved.aiReply.publicMessageId,
          saved.aiReply.body
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

      const aiReply = await this.aiService.generateReply(parsed.data);

      if (aiReply.status === "unavailable") {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          aiReply.reason
        );
      }

      try {
        const persistedAiReply = await this.repository.saveSiteWidgetAiMessage({
          leadId: saved.leadId,
          conversationId: saved.conversationId,
          publicMessageId: randomUUID(),
          inboundPublicMessageId: saved.publicMessageId,
          idempotencyKey: `ai:${saved.publicMessageId}`,
          requestFingerprint: sha256Hex(
            stableStringify({
              inbound_public_message_id: saved.publicMessageId,
              body: aiReply.text,
              metadata: aiReply.metadata
            })
          ),
          body: aiReply.text,
          sourcePageUrl: parsed.data.source.page_url,
          agentAllowedToReplyAfterSend: aiReply.agentAllowedToReplyAfterSend,
          metadata: {
            ...aiReply.metadata,
            channel: "site_widget",
            public_session_id: saved.publicSessionId,
            inbound_public_message_id: saved.publicMessageId
          }
        });

        return aiReplySuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          persistedAiReply.publicMessageId,
          persistedAiReply.body
        );
      } catch (error) {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          error instanceof AgentReplyBlockedError
            ? "agent_reply_blocked"
            : "ai_persistence_unconfirmed"
        );
      }
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
  reason:
    | "missing_openai_config"
    | "model_error"
    | "empty_model_response"
    | "unsafe_model_response"
    | "agent_reply_blocked"
    | "ai_persistence_unconfirmed"
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
