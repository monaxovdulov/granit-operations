export type TimelineCustomerChannel = "site_widget" | "telegram";

export type TimelineConversationContentType =
  | "text"
  | "voice"
  | "sticker"
  | "video_note"
  | "photo"
  | "document";

export type TimelineLeadStatus =
  | "new"
  | "in_progress"
  | "waiting_response"
  | "closed"
  | "duplicate"
  | "spam";

export type TimelineNeedsManagerReason =
  | "telegram_new_inbound"
  | "telegram_media"
  | "telegram_urgent"
  | "telegram_human_requested"
  | "ai_tool_failure";

export type TimelineNextStepChannel =
  | "manager_call"
  | "phone"
  | "whatsapp"
  | "telegram"
  | "site_widget"
  | "email";

export type SiteFormLeadCreatedTimelineInput = {
  leadId: string;
  publicSubmissionId: string;
  sourcePageUrl: string;
  sourceFormKind: string;
};

export type InboundLeadCreatedTimelineInput = {
  leadId: string;
  channel: TimelineCustomerChannel;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ConversationMessageReceivedTimelineInput = {
  leadId: string;
  channel: TimelineCustomerChannel;
  publicMessageId: string;
  publicConversationId: string;
  channelIdentityId: string;
  contentType: TimelineConversationContentType;
  automationStatus: "enabled" | "disabled";
  publicSessionId?: string;
  sourcePageUrl?: string;
  widgetInstanceId?: string;
  providerMessageId?: string;
  providerUpdateId?: string;
  createdAt: Date;
};

export type AiMessageSentTimelineInput = {
  leadId: string;
  channel: TimelineCustomerChannel;
  publicMessageId: string;
  inboundPublicMessageId: string;
  publicConversationId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type LeadStatusChangedTimelineInput = {
  leadId: string;
  fromStatus: TimelineLeadStatus;
  toStatus: TimelineLeadStatus;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
  createdAt: Date;
};

export type NextStepUpdatedTimelineInput = {
  leadId: string;
  nextStepAt: string;
  nextStepSummary?: string;
  nextStepChannel?: TimelineNextStepChannel;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
  createdAt: Date;
};

export type ManualContactRecordedTimelineInput = {
  leadId: string;
  contactChannel: "phone" | "whatsapp";
  contactedAt: string;
  summary: string;
  nextStepAt?: string;
  nextStepSummary?: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
  createdAt: Date;
};

export type ManagerTakeoverTimelineInput = {
  leadId: string;
  publicConversationId: string;
  channel: TimelineCustomerChannel;
  previousAgentAllowedToReply: boolean;
  previousAiState: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
  createdAt: Date;
};

export type ManagerMessageQueuedTimelineInput = {
  leadId: string;
  publicConversationId: string;
  publicMessageId: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
  createdAt: Date;
};

export type ManagerNotificationEnqueuedTimelineInput = {
  leadId: string;
  notificationIds?: string[];
  notificationId?: string | null;
  publicConversationId: string;
  publicMessageId: string;
  status: "pending" | "blocked_no_destination";
  destinationCount?: number;
  needsManagerReason: TimelineNeedsManagerReason;
  createdAt: Date;
};

export type ManagerNotificationSentTimelineInput = {
  leadId: string;
  notificationId: string;
  publicConversationId?: string;
  publicMessageId?: string;
  providerMessageId: string;
  attemptCount: number;
  sentAt: Date;
};

export type ManagerNotificationFailureTimelineInput = {
  leadId: string;
  notificationId: string;
  publicConversationId?: string;
  publicMessageId?: string;
  status: "retrying" | "failed" | "blocked_no_destination";
  attemptCount: number;
  lastError: string;
  failedAt: Date;
};

export type DeliverySentTimelineInput = {
  leadId: string;
  deliveryId: string;
  publicConversationId: string;
  publicMessageId: string;
  attemptCount: number;
  providerMessageId: string;
  createdAt: Date;
};

export type DeliveryFailureTimelineInput = {
  deliveryId: string;
  leadId: string;
  publicConversationId: string;
  publicMessageId: string;
  status: "retrying" | "failed" | "blocked_no_destination" | "blocked" | "uncertain";
  attemptCount: number;
  lastError: string;
  failedAt: Date;
};

export type DeliveryUncertainTimelineInput = {
  leadId: string;
  deliveryId: string;
  publicConversationId: string;
  publicMessageId: string;
  attemptCount: number;
  lastError: string;
  createdAt: Date;
};

export type DeliveryUncertainResolutionTimelineInput = {
  leadId: string;
  deliveryId: string;
  publicConversationId: string;
  publicMessageId: string;
  resolution: "confirmed_sent" | "confirmed_not_sent" | "requeued" | "ignored";
  resolvedByManagerEmail?: string;
  evidenceNote?: string;
  createdAt: Date;
};
