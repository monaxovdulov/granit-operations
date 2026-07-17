import { randomUUID } from "node:crypto";

import {
  SITE_WIDGET_CONTRACT_VERSION,
  SUPPORTED_SITE_WIDGET_VERSIONS,
  SiteWidgetMessageRequestSchema,
  type SiteWidgetResponse,
  type SiteWidgetValidationIssue
} from "@granit/contracts";
import { sha256Hex, stableStringify } from "@granit/shared";
import { z } from "zod";

import type { AiReplyCandidateEvidence, AiTurnInput } from "../../ai/ai-turn.js";
import {
  AI_SLOT_NAMES,
  AI_HANDOFF_REASONS,
  AI_TURN_ACTIONS,
  AI_TURN_INTENTS,
  type AiHandoffReason,
  type AiSlotName,
  type AiTextEvidence,
  type AiSlotUpdate
} from "../../ai/ai-dialog-contract.js";
import { validateSlotEvidence } from "../../ai/grounding/ai-slot-evidence-service.js";
import { APPROVED_WIDGET_KNOWLEDGE_VERSION } from "../../ai/knowledge/approved-widget-knowledge.js";
import { WIDGET_AI_POLICY_VERSION } from "../../ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../../ai/prompts/widget-ai-prompt.js";
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
    | { ok: false; error: { code: "widget_history_not_found" } };
};

export type PublicWidgetIntakeServiceOptions = {
  ai?: {
    enabled: boolean;
    replyGenerator?: PublicWidgetAiReplyGenerator;
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

  async getSiteWidgetHistory(rawPublicSessionId: string): Promise<PublicWidgetHistoryServiceResult> {
    const parsed = z.string().uuid().safeParse(rawPublicSessionId);

    if (!parsed.success || !this.repository.getSiteWidgetHistory) {
      return widgetHistoryNotFound();
    }

    const history = await this.repository.getSiteWidgetHistory(parsed.data);

    if (!history) {
      return widgetHistoryNotFound();
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
          saved.aiReply.body,
          saved.aiState === "needs_manager" || saved.aiState === "manager_active"
            ? "manager_pending"
            : "ai_active"
        );
      }

      if (!this.options.ai?.enabled) {
        return disabledSuccess(saved.replayed, saved.publicSessionId, saved.publicMessageId);
      }

      if (!aiReplyGenerator) {
        await recordDegradationIfPossible(this.repository, saved, "missing_openai_config");
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
      const aiTurnInputWithFingerprint: AiTurnInput = {
        ...aiTurnInput,
        turn: {
          ...aiTurnInput.turn,
          inputFingerprint: aiInputFingerprint
        }
      };
      const aiReply = validateAiReplyCandidate(
        await aiReplyGenerator.generateReply(aiTurnInputWithFingerprint),
        aiTurnInputWithFingerprint
      );

      if (aiReply.status === "unavailable") {
        await this.repository.recordSiteWidgetAiDegradation?.({
          leadId: saved.leadId,
          conversationId: saved.conversationId,
          inboundPublicMessageId: saved.publicMessageId,
          inputFingerprint: aiInputFingerprint,
          reason: aiReply.reason,
          metadata: {
            prompt_version: WIDGET_AI_PROMPT_VERSION,
            policy_version: WIDGET_AI_POLICY_VERSION,
            knowledge_version: APPROVED_WIDGET_KNOWLEDGE_VERSION,
            ...aiReply.metadata
          }
        }).catch(() => undefined);
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
            metadata: aiReply.metadata,
            slot_updates: aiReply.slotUpdates
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
          sourcePageUrl: aiTurnInputWithFingerprint.page.url,
          agentAllowedToReplyAfterSend: aiReply.agentAllowedToReplyAfterSend,
          slotUpdates: aiReply.slotUpdates,
          aiRun:
            aiReply.action && aiReply.intent
              ? {
                  inputFingerprint: aiInputFingerprint,
                  action: aiReply.action,
                  intent: aiReply.intent,
                  promptVersion: readOptionalMetadataString(aiReply.metadata, "prompt_version"),
                  policyVersion: readOptionalMetadataString(aiReply.metadata, "policy_version"),
                  knowledgeVersion:
                    readOptionalMetadataString(aiReply.metadata, "catalog_version") ??
                    readOptionalMetadataString(aiReply.metadata, "knowledge_version") ??
                    APPROVED_WIDGET_KNOWLEDGE_VERSION,
                  modelVersion: readOptionalMetadataString(aiReply.metadata, "model_name"),
                  generatorModelName: readOptionalMetadataString(
                    aiReply.metadata,
                    "model_name"
                  ),
                  verifierModelName: readOptionalMetadataString(
                    aiReply.metadata,
                    "verifier_model_name"
                  ),
                  verifierVersion: readOptionalMetadataString(
                    aiReply.metadata,
                    "verifier_version"
                  ),
                  verifierVerdict: readOptionalMetadataString(
                    aiReply.metadata,
                    "verifier_verdict"
                  ),
                  catalogVersion: readOptionalMetadataString(
                    aiReply.metadata,
                    "catalog_version"
                  ),
                  catalogContentHash: readOptionalMetadataString(
                    aiReply.metadata,
                    "catalog_content_hash"
                  )
                }
              : undefined,
          handoff:
            aiReply.action === "handoff" && aiReply.handoffReason
              ? {
                  reason: aiReply.handoffReason,
                  summary: buildHandoffSummary(aiTurnInputWithFingerprint, aiReply.slotUpdates),
                  slotsSnapshot: buildSlotSnapshot(
                    aiTurnInputWithFingerprint,
                    aiReply.slotUpdates
                  )
                }
              : undefined,
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
          persistedAiReply.body,
          aiReply.action === "handoff" ? "manager_pending" : "ai_active"
        );
      } catch (error) {
        const fallbackReason =
          error instanceof AgentReplyBlockedError
            ? "agent_reply_blocked"
            : "ai_persistence_unconfirmed";

        if (fallbackReason === "ai_persistence_unconfirmed") {
          await this.repository.recordSiteWidgetAiDegradation?.({
            leadId: saved.leadId,
            conversationId: saved.conversationId,
            inboundPublicMessageId: saved.publicMessageId,
            inputFingerprint: aiInputFingerprint,
            reason: fallbackReason,
            metadata: {
              prompt_version: WIDGET_AI_PROMPT_VERSION,
              policy_version: WIDGET_AI_POLICY_VERSION,
              knowledge_version: APPROVED_WIDGET_KNOWLEDGE_VERSION
            }
          }).catch(() => undefined);
        }

        return fallbackSuccess(
          saved.replayed,
          saved.publicSessionId,
          saved.publicMessageId,
          fallbackReason
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
  if (reason !== "agent_reply_blocked") {
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
      slotUpdates?: AiSlotUpdate[];
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
  const sourceEvidenceIsValid = hasValidTypedSourceEvidence(value.sourceEvidence, input);
  const handoffReason = readEnumValue(value.handoffReason, AI_HANDOFF_REASONS);

  if (
    ("action" in value && value.action !== undefined && !action) ||
    ("intent" in value && value.intent !== undefined && !intent) ||
    ("handoffReason" in value && value.handoffReason !== undefined && !handoffReason) ||
    requestedSlots === null ||
    slotUpdates === null ||
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
  updates: AiSlotUpdate[] | undefined
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
      !validateSlotEvidence(candidate.name as AiSlotName, evidence, input);

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
