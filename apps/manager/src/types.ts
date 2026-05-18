export type ManagerRole = "owner" | "manager" | "viewer";

export type ManagerUser = {
  id: string;
  email: string;
  yandexUid: string | null;
  role: ManagerRole;
  status: "active";
  lastLoginAt: string | null;
};

export type ManagerLeadSource = {
  channel: "site_form" | "site_widget" | "telegram";
  pageUrl?: string;
  formKind?: string;
  referrerUrl?: string;
  utm?: Record<string, string | undefined>;
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
  channel?: "manager_call" | "phone" | "whatsapp" | "telegram" | "site_widget" | "email";
};

export const LEAD_STATUS_VALUES = [
  "new",
  "in_progress",
  "waiting_response",
  "closed",
  "duplicate",
  "spam"
] as const;

export type LeadStatus = (typeof LEAD_STATUS_VALUES)[number];

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
  contentType: "text" | "voice" | "sticker" | "video_note" | "photo" | "document";
  caption?: string;
  providerFileId?: string;
  createdAt: string;
};

export type AiState =
  | "ai_collecting_info"
  | "needs_manager"
  | "manager_active"
  | "watching"
  | "closed";

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
  channel: "site_widget" | "telegram";
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

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUS_VALUES.includes(value as LeadStatus);
}
