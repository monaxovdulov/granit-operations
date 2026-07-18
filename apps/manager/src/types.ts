export type ManagerRole = "owner" | "manager" | "viewer";

export type ManagerUser = {
  id: string;
  email: string;
  yandexUid: string | null;
  role: ManagerRole;
  status: "active";
  lastLoginAt: string | null;
};

export type ManagerTelegramBindingStatus = {
  bound: boolean;
  username?: string;
  displayName?: string;
  externalChatId?: string;
  boundAt?: string;
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

export type MessageDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "retrying"
  | "blocked_no_destination"
  | "blocked"
  | "uncertain";

export type ManagerConversationMessage = {
  publicMessageId: string;
  direction: "inbound" | "outbound";
  senderRole: "visitor" | "ai_assistant" | "manager";
  body: string;
  contentType: "text" | "voice" | "sticker" | "video_note" | "photo" | "document";
  caption?: string;
  providerFileId?: string;
  delivery?: {
    status: MessageDeliveryStatus;
    attemptCount: number;
    lastError?: string;
    providerMessageId?: string;
    updatedAt: string;
  };
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

export const STRUCTURED_INTAKE_SLOT_NAMES = [
  "monumentType",
  "material",
  "size",
  "city",
  "cemetery",
  "engraving",
  "installation",
  "budgetContext",
  "desiredTiming",
  "customerName",
  "phone",
  "preferredContact",
  "questionSummary"
] as const;

export type StructuredIntakeSlotName = (typeof STRUCTURED_INTAKE_SLOT_NAMES)[number];

export type ManagerStructuredIntakeSlot = {
  publicConversationId: string;
  name: StructuredIntakeSlotName;
  value: string;
  source: "contact" | "visitor_message" | "ai_extraction" | "manager";
  sourceMessageId?: string;
  confidence: number;
  evidence?: { quote: string; start: number; end: number };
  updatedAt: string;
};

export type ManagerStructuredIntake = {
  slots: ManagerStructuredIntakeSlot[];
  requirements: Array<{
    publicConversationId: string;
    category:
      | "style"
      | "color"
      | "shape"
      | "accessory"
      | "decoration"
      | "site_constraint"
      | "other";
    mode: "preference" | "requirement" | "avoidance";
    value: string;
    sourceMessageId: string;
    confidence: number;
    evidence: { quote: string; start: number; end: number };
    updatedAt: string;
  }>;
  conflicts: Array<{
    publicConversationId: string;
    name: StructuredIntakeSlotName;
    candidateValue: string;
    currentValue?: string;
    sourceMessageId?: string;
    evidence?: { quote: string; start: number; end: number };
    applied: boolean;
    createdAt: string;
  }>;
  missingFields: StructuredIntakeSlotName[];
  handoff?: {
    reason: string;
    summary: string;
    status: "active" | "resolved";
    createdAt: string;
  };
  verification?: {
    aiRunId: string;
    status: "replied" | "handoff" | "degraded";
    verdict?: string;
    generatorModelName?: string;
    verifierModelName?: string;
    verifierVersion?: string;
    catalogVersion?: string;
    reviewLabels: Array<{
      label: AiReviewLabel;
      note?: string;
      createdAt: string;
    }>;
    createdAt: string;
  };
};

export const AI_REVIEW_LABELS = [
  "correct",
  "unsupported_fact",
  "wrong_slot",
  "missed_handoff",
  "unnecessary_handoff",
  "poor_tone",
  "other"
] as const;

export type AiReviewLabel = (typeof AI_REVIEW_LABELS)[number];

export type ManagerLeadDetail = ManagerLeadListItem & {
  timeline: ManagerTimelineEvent[];
  conversations: ManagerConversation[];
  structuredIntake: ManagerStructuredIntake;
  internalNotePlaceholder: string;
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUS_VALUES.includes(value as LeadStatus);
}
