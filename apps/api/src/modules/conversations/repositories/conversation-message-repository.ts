import type { SiteWidgetUtm } from "@granit/contracts";

import type {
  AiState,
  ChannelProvider,
  ConversationContentType,
  CustomerChannel,
  NeedsManagerReason
} from "./lead-conversation-types.js";

export type SiteWidgetStoredAiReply = {
  publicMessageId: string;
  body: string;
  createdAt: string;
};

export type AcceptInboundMessageInput = {
  publicMessageId: string;
  channel: CustomerChannel;
  provider: ChannelProvider;
  providerAccountId?: string;
  externalChatId?: string;
  externalUserId?: string;
  providerMessageId?: string;
  providerUpdateId?: string;
  providerSentAt?: string;
  widgetPublicSessionId?: string;
  widgetInstanceId?: string;
  sourcePageUrl?: string;
  referrerUrl?: string;
  pageTitle?: string;
  utm?: SiteWidgetUtm | null;
  visitorContext?: Record<string, unknown>;
  displayName?: string;
  username?: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
    preferredContact?: "phone" | "whatsapp" | "telegram" | "email";
    city?: string;
    username?: string;
  };
  message: {
    role: "visitor";
    text: string;
    submittedAt: string;
    contentType?: ConversationContentType;
    providerFileId?: string;
    providerFileUniqueId?: string;
    mimeType?: string;
    fileSize?: number;
    durationSeconds?: number;
    caption?: string;
    metadata?: Record<string, unknown>;
  };
  idempotencyKey: string;
  requestFingerprint: string;
  automationRequested: boolean;
  needsManagerReason?: NeedsManagerReason;
  managerPanelBaseUrl?: string;
  metadata: Record<string, unknown>;
};

export type AcceptInboundMessageResult = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  channelIdentityId: string;
  publicMessageId: string;
  widgetPublicSessionId?: string;
  agentAllowedToReply: boolean;
  aiState: AiState;
  replayed: boolean;
  existingAiReply?: SiteWidgetStoredAiReply;
};

export type PersistAiReplyWithSendGateInput = {
  leadId: string;
  conversationId: string;
  publicConversationId?: string;
  channel: CustomerChannel;
  provider?: ChannelProvider;
  publicMessageId: string;
  inboundPublicMessageId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  body: string;
  sourcePageUrl?: string;
  metadata: Record<string, unknown>;
  agentAllowedToReplyAfterSend?: boolean;
};

export type SaveSiteWidgetAiMessageInput = Omit<
  PersistAiReplyWithSendGateInput,
  "channel" | "provider"
>;

export type SaveSiteWidgetAiMessageResult = SiteWidgetStoredAiReply;

export type SiteWidgetAiMessageLookupResult = SiteWidgetStoredAiReply & {
  requestFingerprint: string;
};

export interface ConversationMessageRepository {
  acceptInboundMessage(input: AcceptInboundMessageInput): Promise<AcceptInboundMessageResult>;
  persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult>;
}
