import type {
  SiteFormIntakeRequest,
  SiteFormUtm,
  SiteWidgetMessageRequest,
  SiteWidgetUtm
} from "@granit/contracts";

export const LEAD_STATUSES = [
  "new",
  "in_progress",
  "waiting_response",
  "closed",
  "duplicate",
  "spam"
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const AI_STATES = [
  "ai_collecting_info",
  "needs_manager",
  "manager_active",
  "watching",
  "closed"
] as const;

export type AiState = (typeof AI_STATES)[number];

export type CustomerChannel = "site_widget" | "telegram";

export type ChannelProvider = "site_widget" | "telegram_bot";

export type ConversationContentType =
  | "text"
  | "voice"
  | "sticker"
  | "video_note"
  | "photo"
  | "document";

export type NextStepChannel =
  | "manager_call"
  | "phone"
  | "whatsapp"
  | "telegram"
  | "site_widget"
  | "email";

export type SaveAcceptedSiteFormSubmissionInput = {
  publicSubmissionId: string;
  request: SiteFormIntakeRequest;
  requestFingerprint: string;
};

export type SaveAcceptedSiteFormSubmissionResult = {
  leadId: string;
  publicSubmissionId: string;
  replayed: boolean;
};

export type SaveAcceptedSiteWidgetMessageInput = {
  publicMessageId: string;
  publicSessionId: string;
  agentAllowedToReply: boolean;
  request: SiteWidgetMessageRequest;
  requestFingerprint: string;
};

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

export type SaveAcceptedSiteWidgetMessageResult = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  channelIdentityId: string;
  publicSessionId: string;
  publicMessageId: string;
  agentAllowedToReply: boolean;
  aiState: AiState;
  replayed: boolean;
  aiReply?: SiteWidgetStoredAiReply;
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

export type ManagerLeadSource = {
  channel: "site_form" | CustomerChannel;
  pageUrl?: string;
  formKind?: string;
  referrerUrl?: string;
  utm?: SiteFormUtm | SiteWidgetUtm;
  widgetInstanceId?: string;
};

export type ManagerLeadContact = {
  name: string;
  phone?: string;
  email?: string;
  preferredContact?: "phone" | "whatsapp" | "telegram" | "email";
  city?: string;
};

export type ManagerLeadRequest = {
  text?: string;
  productInterest?: string;
};

export type ManagerNextStep = {
  at: string;
  summary?: string;
  channel?: NextStepChannel;
};

export type ManagerTimelineEvent = {
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ManagerConversationMessage = {
  publicMessageId: string;
  direction: "inbound" | "outbound";
  senderRole: "visitor" | "ai_assistant";
  body: string;
  contentType: ConversationContentType;
  caption?: string;
  providerFileId?: string;
  createdAt: string;
};

export type ManagerChannelIdentity = {
  provider: string;
  displayName?: string;
  username?: string;
  externalChatId?: string;
  externalUserId?: string;
  widgetPublicSessionId?: string;
  widgetInstanceId?: string;
};

export type ManagerConversation = {
  publicConversationId: string;
  channel: CustomerChannel;
  channelIdentity: ManagerChannelIdentity;
  status: "open";
  aiState: AiState;
  agentAllowedToReply: boolean;
  sourcePageUrl?: string;
  createdAt: string;
  updatedAt: string;
  messages: ManagerConversationMessage[];
};

export type ManagerLeadListItem = {
  leadId: string;
  publicSubmissionId: string;
  status: LeadStatus;
  source: ManagerLeadSource;
  contact: ManagerLeadContact;
  request: ManagerLeadRequest;
  submittedAt: string;
  nextStep?: ManagerNextStep;
  createdAt: string;
  updatedAt: string;
};

export type ManagerLeadDetail = ManagerLeadListItem & {
  timeline: ManagerTimelineEvent[];
  conversations: ManagerConversation[];
  internalNotePlaceholder: string;
};

export type ChangeManagerLeadStatusInput = {
  leadId: string;
  status: LeadStatus;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type SetNextStepInput = {
  leadId: string;
  nextStepAt: string;
  nextStepSummary?: string;
  nextStepChannel?: NextStepChannel;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type RecordManualContactInput = {
  leadId: string;
  contactChannel: "phone" | "whatsapp";
  summary: string;
  contactedAt: string;
  nextStepAt?: string;
  nextStepSummary?: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type TakeoverSiteWidgetConversationInput = {
  leadId: string;
  publicSessionId: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type TakeoverConversationInput = {
  leadId: string;
  publicConversationId: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export interface IntakeRepository {
  saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult>;
  acceptInboundMessage(input: AcceptInboundMessageInput): Promise<AcceptInboundMessageResult>;
  saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult>;
  persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult>;
  saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult>;
  listManagerLeads(): Promise<ManagerLeadListItem[]>;
  getManagerLead(leadId: string): Promise<ManagerLeadDetail | null>;
  changeManagerLeadStatus(input: ChangeManagerLeadStatusInput): Promise<ManagerLeadDetail | null>;
  setNextStep(input: SetNextStepInput): Promise<ManagerLeadDetail | null>;
  recordManualContact(input: RecordManualContactInput): Promise<ManagerLeadDetail | null>;
  takeoverConversation(input: TakeoverConversationInput): Promise<ManagerLeadDetail | null>;
  takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used for a different submission");
    this.name = "IdempotencyConflictError";
  }
}

export class AgentReplyBlockedError extends Error {
  constructor() {
    super("agent is not allowed to reply to this conversation");
    this.name = "AgentReplyBlockedError";
  }
}

export class TelegramIdentityRequiredError extends Error {
  constructor() {
    super("telegram inbound requires provider account id and external chat id");
    this.name = "TelegramIdentityRequiredError";
  }
}

export class TelegramOutboundBlockedError extends Error {
  constructor() {
    super("telegram outbound is blocked until app-owned delivery worker is implemented");
    this.name = "TelegramOutboundBlockedError";
  }
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUSES.includes(value as LeadStatus);
}

export function isAiState(value: unknown): value is AiState {
  return typeof value === "string" && AI_STATES.includes(value as AiState);
}
