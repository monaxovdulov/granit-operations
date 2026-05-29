import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  SiteWidgetMessageRequestSchema,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";

import type { AiReplyCandidateEvidence, AiTurnInput } from "../../ai/ai-turn.js";
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

      const aiTurnInput = saved.aiTurnInput;

      if (!isReplyCapableSiteWidgetTurn(aiTurnInput)) {
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
      const aiReply = validateAiReplyCandidate(await aiReplyGenerator.generateReply(aiTurnInput));

      if (aiReply.status === "unavailable") {
        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          aiReply.reason
        );
      }

      try {
        const outboundFingerprint = sha256Hex(
          stableStringify({
            outbound_kind: "site_widget_ai_reply",
            inbound_public_message_id: saved.publicMessageId,
            public_conversation_id: saved.publicConversationId,
            body: aiReply.text,
            metadata: aiReply.metadata
          })
        );
        const persistedAiReply = await this.repository.saveSiteWidgetAiMessage({
          leadId: saved.leadId,
          conversationId: saved.conversationId,
          publicMessageId: randomUUID(),
          inboundPublicMessageId: saved.publicMessageId,
          idempotencyKey: `ai:${saved.publicMessageId}`,
          requestFingerprint: outboundFingerprint,
          body: aiReply.text,
          sourcePageUrl: aiTurnInput.page.url,
          agentAllowedToReplyAfterSend: aiReply.agentAllowedToReplyAfterSend,
          metadata: {
            ...aiReply.metadata,
            channel: "site_widget",
            public_session_id: saved.publicSessionId,
            inbound_public_message_id: saved.publicMessageId,
            ai_input_fingerprint: aiInputFingerprint
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

type ValidatedAiReplyCandidate =
  | {
      status: "replied";
      text: string;
      agentAllowedToReplyAfterSend?: boolean;
      metadata: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reason: PublicWidgetAiUnavailableReason;
    };

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

function validateAiReplyCandidate(value: unknown): ValidatedAiReplyCandidate {
  if (!isRecord(value)) {
    return unavailable("unsafe_model_response");
  }

  if (value.decision === "no_reply") {
    return {
      status: "unavailable",
      reason: isPublicWidgetAiUnavailableReason(value.reason)
        ? value.reason
        : "unsafe_model_response"
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

  const evidence = isRecord(value.evidence) ? readCandidateEvidence(value.evidence) : undefined;

  if (hasBusinessFactWithoutApprovedSource(evidence)) {
    return unavailable("unsafe_model_response");
  }

  const unsafeReason = unsafeCandidateReplyReason(text, evidence);

  if (unsafeReason) {
    return unavailable("unsafe_model_response");
  }

  return {
    status: "replied",
    text,
    agentAllowedToReplyAfterSend:
      typeof value.agentAllowedToReplyAfterSend === "boolean"
        ? value.agentAllowedToReplyAfterSend
        : undefined,
    metadata: value.metadata
  };
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
    value === "unsafe_model_response"
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

function hasBusinessFactWithoutApprovedSource(evidence: AiReplyCandidateEvidence | undefined) {
  return Boolean(
    evidence?.businessFacts?.some((fact) => !fact.approvedSourceId || !fact.approvedSourceId.trim())
  );
}

function unsafeCandidateReplyReason(
  text: string,
  evidence: AiReplyCandidateEvidence | undefined
): string | null {
  const normalized = text.toLocaleLowerCase("ru-RU");

  if (/\d[\d\s]*(?:₽|руб|р\.)/i.test(normalized) && !hasApprovedPriceSource(evidence)) {
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

function hasApprovedPriceSource(evidence: AiReplyCandidateEvidence | undefined) {
  return Boolean(
    evidence?.businessFacts?.some(
      (fact) => fact.kind === "price" && fact.approvedSourceId && fact.approvedSourceId.trim()
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
