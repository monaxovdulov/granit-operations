import type { SiteFormUtm, SiteWidgetUtm } from "@granit/contracts";

import type {
  AiState,
  ConversationContentType,
  CustomerChannel,
  LeadStatus,
  MessageDeliveryStatus,
  NextStepChannel
} from "./lead-conversation-types.js";

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
  senderRole: "visitor" | "ai_assistant" | "manager";
  body: string;
  contentType: ConversationContentType;
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

export type TakeoverConversationByPublicIdInput = {
  publicConversationId: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export interface ManagerLeadRepository {
  listManagerLeads(): Promise<ManagerLeadListItem[]>;
  getManagerLead(leadId: string): Promise<ManagerLeadDetail | null>;
  changeManagerLeadStatus(input: ChangeManagerLeadStatusInput): Promise<ManagerLeadDetail | null>;
  setNextStep(input: SetNextStepInput): Promise<ManagerLeadDetail | null>;
  recordManualContact(input: RecordManualContactInput): Promise<ManagerLeadDetail | null>;
  takeoverConversation(input: TakeoverConversationInput): Promise<ManagerLeadDetail | null>;
  takeoverConversationByPublicId(
    input: TakeoverConversationByPublicIdInput
  ): Promise<ManagerLeadDetail | null>;
  takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null>;
}
