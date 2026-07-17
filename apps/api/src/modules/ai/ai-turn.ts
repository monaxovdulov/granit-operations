import type {
  AiHandoffReason,
  AiKnownSlots,
  AiRiskFlag,
  AiSlotName,
  AiSlotUpdate,
  AiTurnAction,
  AiTurnIntent,
  ApprovedSourceEvidence
} from "./ai-dialog-contract.js";
import {
  lookupApprovedWidgetKnowledge,
  type ApprovedWidgetKnowledgeFact
} from "./knowledge/approved-widget-knowledge.js";

export const AI_TURN_INPUT_VERSION = "granit_ai_turn_input.stage_b.v1";

export type AiReplyCapableChannel = "site_widget";

export type AiTurnAiState =
  | "ai_collecting_info"
  | "needs_manager"
  | "manager_active"
  | "watching"
  | "closed";

export type AiTurnPreferredContact = "phone" | "whatsapp" | "telegram" | "email";

export type AiTurnInput = {
  version: typeof AI_TURN_INPUT_VERSION;
  channel: AiReplyCapableChannel;
  replyCapability: "site_widget_sync_reply";
  turn: {
    idempotencyKey: string;
    acceptedRequestFingerprint: string;
    startedAt: string;
    inputFingerprint?: string;
  };
  conversation: {
    publicConversationId: string;
    aiState: AiTurnAiState;
    agentAllowedToReply: boolean;
  };
  gateSnapshot: {
    aiState: AiTurnAiState;
    agentAllowedToReply: boolean;
    capturedAt: string;
  };
  inboundMessage: {
    publicMessageId: string;
    submittedAt: string;
    contentType: "text";
    text: string;
  };
  page: {
    url: string;
    widgetInstanceId: string;
    referrerUrl?: string;
    title?: string;
  };
  customer: {
    name?: string;
    phoneProvided: boolean;
    emailProvided: boolean;
    preferredContact?: AiTurnPreferredContact;
    city?: string;
  };
  visitor: {
    locale?: string;
    timezone?: string;
  };
  compactContext: {
    messages: Array<{
      publicMessageId: string;
      direction: "inbound" | "outbound";
      senderRole: "visitor" | "ai_assistant";
      contentType: "text";
      submittedAt: string;
      text: string;
    }>;
  };
  knownSlots: {
    customerNameProvided: boolean;
    phoneProvided: boolean;
    emailProvided: boolean;
    preferredContact?: AiTurnPreferredContact;
    city?: string;
    values: AiKnownSlots;
  };
  boundaryConfig: {
    replyCapableChannel: AiReplyCapableChannel;
    maxClarifyingQuestions: 1;
    priceOrientationAllowed: false;
    telegramAiOutboundAllowed: false;
  };
  approvedSources: {
    price: null;
    businessFacts: ApprovedWidgetKnowledgeFact[];
  };
  evidence: {
    acceptedRequestFingerprint: string;
    boundary: "stage_a_neutral_ai_turn";
    source: "accept_inbound_message";
  };
};

export type AiReplyCandidateEvidence = {
  businessFacts?: Array<{
    kind: "price" | "business_fact";
    approvedSourceId?: string;
  }>;
};

export type AiUnavailableReason =
  | "missing_openai_config"
  | "model_error"
  | "empty_model_response"
  | "unsafe_model_response"
  | "semantic_verifier_error"
  | "grounding_validation_failed"
  | "turn_timeout";

export type AiReplyCandidateDecision =
  | {
      decision: "reply_candidate";
      text: string;
      agentAllowedToReplyAfterSend?: boolean;
      metadata: Record<string, unknown>;
      evidence?: AiReplyCandidateEvidence;
      action?: AiTurnAction;
      intent?: AiTurnIntent;
      slotUpdates?: AiSlotUpdate[];
      requestedSlots?: AiSlotName[];
      riskFlags?: AiRiskFlag[];
      handoffReason?: AiHandoffReason;
      sourceEvidence?: ApprovedSourceEvidence[];
      confidence?: number;
    }
  | {
      decision: "no_reply";
      reason: AiUnavailableReason;
      metadata: Record<string, unknown>;
    };

export type AiTurnDecision = AiReplyCandidateDecision;

export type AiTurnResult =
  | {
      status: "persisted";
      publicMessageId: string;
      evidence: Record<string, unknown>;
    }
  | {
      status: "blocked" | "handed_off" | "fallback_unavailable";
      reason: string;
      evidence: Record<string, unknown>;
    };

export type BuildStageASiteWidgetAiTurnInput = {
  publicConversationId: string;
  publicMessageId: string;
  requestFingerprint: string;
  submittedAt: string;
  text: string;
  page: {
    url: string;
    widgetInstanceId: string;
    referrerUrl?: string;
    title?: string;
  };
  customer: {
    name?: string;
    phoneProvided: boolean;
    emailProvided: boolean;
    preferredContact?: AiTurnPreferredContact;
    city?: string;
  };
  visitor: {
    locale?: string;
    timezone?: string;
  };
  gate: {
    aiState: AiTurnAiState;
    agentAllowedToReply: boolean;
  };
  recentMessages?: AiTurnInput["compactContext"]["messages"];
  persistedSlots?: AiKnownSlots;
};

export function buildStageASiteWidgetAiTurnInput(
  input: BuildStageASiteWidgetAiTurnInput
): AiTurnInput {
  return {
    version: AI_TURN_INPUT_VERSION,
    channel: "site_widget",
    replyCapability: "site_widget_sync_reply",
    turn: {
      idempotencyKey: `ai-turn:${input.publicMessageId}`,
      acceptedRequestFingerprint: input.requestFingerprint,
      startedAt: input.submittedAt
    },
    conversation: {
      publicConversationId: input.publicConversationId,
      aiState: input.gate.aiState,
      agentAllowedToReply: input.gate.agentAllowedToReply
    },
    gateSnapshot: {
      aiState: input.gate.aiState,
      agentAllowedToReply: input.gate.agentAllowedToReply,
      capturedAt: input.submittedAt
    },
    inboundMessage: {
      publicMessageId: input.publicMessageId,
      submittedAt: input.submittedAt,
      contentType: "text",
      text: input.text
    },
    page: input.page,
    customer: input.customer,
    visitor: input.visitor,
    compactContext: {
      messages: input.recentMessages ?? []
    },
    knownSlots: {
      customerNameProvided: Boolean(input.customer.name),
      phoneProvided: input.customer.phoneProvided,
      emailProvided: input.customer.emailProvided,
      preferredContact: input.customer.preferredContact,
      city: input.customer.city,
      values: {
        ...input.persistedSlots,
        ...(input.customer.name && !input.persistedSlots?.customerName
          ? {
              customerName: {
                value: input.customer.name,
                source: "contact" as const,
                confidence: 1,
                updatedAt: input.submittedAt
              }
            }
          : {}),
        ...(input.customer.city && !input.persistedSlots?.city
          ? {
              city: {
                value: input.customer.city,
                source: "contact" as const,
                confidence: 1,
                updatedAt: input.submittedAt
              }
            }
          : {})
      }
    },
    boundaryConfig: {
      replyCapableChannel: "site_widget",
      maxClarifyingQuestions: 1,
      priceOrientationAllowed: false,
      telegramAiOutboundAllowed: false
    },
    approvedSources: {
      price: null,
      businessFacts: lookupApprovedWidgetKnowledge(input.text)
    },
    evidence: {
      acceptedRequestFingerprint: input.requestFingerprint,
      boundary: "stage_a_neutral_ai_turn",
      source: "accept_inbound_message"
    }
  };
}
