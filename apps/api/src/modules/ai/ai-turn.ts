export type AiReplyCapableChannel = "site_widget";

export type AiTurnInput = {
  channel: AiReplyCapableChannel;
  replyCapability: "site_widget_sync_reply";
  conversation: {
    publicConversationId: string;
    aiState: "ai_collecting_info" | "needs_manager" | "manager_active" | "watching" | "closed";
    agentAllowedToReply: boolean;
  };
  inboundMessage: {
    publicMessageId: string;
    submittedAt: string;
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
    preferredContact?: "phone" | "whatsapp" | "telegram" | "email";
    city?: string;
  };
  visitor: {
    locale?: string;
    timezone?: string;
  };
  compactContext: {
    messages: Array<{
      publicMessageId: string;
      senderRole: "visitor";
      text: string;
    }>;
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
