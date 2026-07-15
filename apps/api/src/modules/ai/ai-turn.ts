export const AI_TURN_INPUT_VERSION = "granit_ai_turn_input.stage_a.v1";
export const AI_TURN_EXECUTION_CONTEXT_VERSION = "granit_ai_turn_execution_context.v1";
export const AI_TURN_CONTEXT_CURSOR_VERSION = "conversation_updated_at.v1";
export const AI_TURN_CONTEXT_MAX_MESSAGES = 8;
export const AI_TURN_CONTEXT_MAX_CHARACTERS = 8_000;

export type AiReplyCapableChannel = "site_widget";

export type AiTurnAiState =
  | "ai_collecting_info"
  | "needs_manager"
  | "manager_active"
  | "watching"
  | "closed";

export type AiTurnPreferredContact = "phone" | "whatsapp" | "telegram" | "email";

export type AiTurnContextMessage = {
  publicMessageId: string;
  direction: "inbound" | "outbound";
  senderRole: "visitor" | "ai_assistant";
  contentType: "text";
  submittedAt: string;
  text: string;
};

/**
 * App-only persistence identity for one accepted turn. This context must never be passed to a
 * model or mapped into a public site_widget.v1 response.
 */
export type AiTurnExecutionContext = {
  version: typeof AI_TURN_EXECUTION_CONTEXT_VERSION;
  channel: AiReplyCapableChannel;
  internal: {
    leadId: string;
    conversationId: string;
    inboundMessageId: string;
  };
  public: {
    conversationId: string;
    inboundMessageId: string;
  };
  turn: {
    idempotencyKey: string;
    acceptedRequestFingerprint: string;
    inputFingerprint?: string;
  };
};

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
    messages: AiTurnContextMessage[];
  };
  knownSlots: {
    customerNameProvided: boolean;
    phoneProvided: boolean;
    emailProvided: boolean;
    preferredContact?: AiTurnPreferredContact;
    city?: string;
  };
  boundaryConfig: {
    replyCapableChannel: AiReplyCapableChannel;
    maxClarifyingQuestions: 1;
    priceOrientationAllowed: false;
    telegramAiOutboundAllowed: false;
  };
  approvedSources: {
    price: null;
    businessFacts: [];
  };
  evidence: {
    acceptedRequestFingerprint: string;
    boundary: "stage_a_neutral_ai_turn";
    source: "accept_inbound_message";
  };
};

export function aiTurnExecutionContextMatchesInput(
  context: AiTurnExecutionContext,
  input: AiTurnInput
): boolean {
  return (
    context.channel === input.channel &&
    context.public.conversationId === input.conversation.publicConversationId &&
    context.public.inboundMessageId === input.inboundMessage.publicMessageId &&
    context.turn.idempotencyKey === input.turn.idempotencyKey &&
    context.turn.acceptedRequestFingerprint === input.turn.acceptedRequestFingerprint &&
    context.turn.inputFingerprint === input.turn.inputFingerprint
  );
}

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
  | "unsafe_model_response";

export type AiReplyCandidateDecision =
  | {
      decision: "reply_candidate";
      text: string;
      agentAllowedToReplyAfterSend?: boolean;
      metadata: Record<string, unknown>;
      evidence?: AiReplyCandidateEvidence;
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
  previousMessagesNewestFirst?: AiTurnContextMessage[];
};

export type BuildBoundedAiTurnContextInput = {
  currentInboundMessage: AiTurnContextMessage & {
    direction: "inbound";
    senderRole: "visitor";
  };
  previousMessagesNewestFirst: AiTurnContextMessage[];
  maxMessages?: number;
  maxCharacters?: number;
};

export function buildBoundedAiTurnContext(
  input: BuildBoundedAiTurnContextInput
): AiTurnContextMessage[] {
  const maxMessages = input.maxMessages ?? AI_TURN_CONTEXT_MAX_MESSAGES;
  const maxCharacters = input.maxCharacters ?? AI_TURN_CONTEXT_MAX_CHARACTERS;

  if (!Number.isInteger(maxMessages) || maxMessages < 1) {
    throw new Error("AI turn context maxMessages must be a positive integer");
  }

  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error("AI turn context maxCharacters must be a positive integer");
  }

  if (input.currentInboundMessage.text.length > maxCharacters) {
    throw new Error("accepted inbound message exceeds the AI turn context character limit");
  }

  const selectedNewestFirst: AiTurnContextMessage[] = [input.currentInboundMessage];
  const seenPublicMessageIds = new Set([input.currentInboundMessage.publicMessageId]);
  let characterCount = input.currentInboundMessage.text.length;

  for (const message of input.previousMessagesNewestFirst) {
    if (selectedNewestFirst.length >= maxMessages) {
      break;
    }

    if (seenPublicMessageIds.has(message.publicMessageId)) {
      continue;
    }

    if (characterCount + message.text.length > maxCharacters) {
      break;
    }

    selectedNewestFirst.push(message);
    seenPublicMessageIds.add(message.publicMessageId);
    characterCount += message.text.length;
  }

  return selectedNewestFirst.reverse();
}

export type BuildSiteWidgetAiTurnExecutionContextInput = {
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
  publicConversationId: string;
  publicInboundMessageId: string;
  requestFingerprint: string;
  inputFingerprint?: string;
};

export function buildSiteWidgetAiTurnExecutionContext(
  input: BuildSiteWidgetAiTurnExecutionContextInput
): AiTurnExecutionContext {
  return {
    version: AI_TURN_EXECUTION_CONTEXT_VERSION,
    channel: "site_widget",
    internal: {
      leadId: input.leadId,
      conversationId: input.conversationId,
      inboundMessageId: input.inboundMessageId
    },
    public: {
      conversationId: input.publicConversationId,
      inboundMessageId: input.publicInboundMessageId
    },
    turn: {
      idempotencyKey: `ai-turn:${input.publicInboundMessageId}`,
      acceptedRequestFingerprint: input.requestFingerprint,
      inputFingerprint: input.inputFingerprint
    }
  };
}

export function buildStageASiteWidgetAiTurnInput(
  input: BuildStageASiteWidgetAiTurnInput
): AiTurnInput {
  const currentInboundMessage = {
    publicMessageId: input.publicMessageId,
    direction: "inbound" as const,
    senderRole: "visitor" as const,
    contentType: "text" as const,
    submittedAt: input.submittedAt,
    text: input.text
  };

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
      messages: buildBoundedAiTurnContext({
        currentInboundMessage,
        previousMessagesNewestFirst: input.previousMessagesNewestFirst ?? []
      })
    },
    knownSlots: {
      customerNameProvided: Boolean(input.customer.name),
      phoneProvided: input.customer.phoneProvided,
      emailProvided: input.customer.emailProvided,
      preferredContact: input.customer.preferredContact,
      city: input.customer.city
    },
    boundaryConfig: {
      replyCapableChannel: "site_widget",
      maxClarifyingQuestions: 1,
      priceOrientationAllowed: false,
      telegramAiOutboundAllowed: false
    },
    approvedSources: {
      price: null,
      businessFacts: []
    },
    evidence: {
      acceptedRequestFingerprint: input.requestFingerprint,
      boundary: "stage_a_neutral_ai_turn",
      source: "accept_inbound_message"
    }
  };
}
