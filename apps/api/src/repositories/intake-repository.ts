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
  request: SiteWidgetMessageRequest;
  requestFingerprint: string;
};

export type SaveAcceptedSiteWidgetMessageResult = {
  leadId: string;
  publicSessionId: string;
  publicMessageId: string;
  replayed: boolean;
};

export type ManagerLeadSource = {
  channel: "site_form" | "site_widget";
  pageUrl: string;
  formKind: string;
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

export type ManagerTimelineEvent = {
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ManagerConversationMessage = {
  publicMessageId: string;
  direction: "inbound";
  senderRole: "visitor";
  body: string;
  createdAt: string;
};

export type ManagerConversation = {
  channel: "site_widget";
  publicSessionId: string;
  status: "open";
  agentAllowedToReply: boolean;
  sourcePageUrl: string;
  widgetInstanceId: string;
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
  createdAt: string;
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

export interface IntakeRepository {
  saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult>;
  saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult>;
  listManagerLeads(): Promise<ManagerLeadListItem[]>;
  getManagerLead(leadId: string): Promise<ManagerLeadDetail | null>;
  changeManagerLeadStatus(input: ChangeManagerLeadStatusInput): Promise<ManagerLeadDetail | null>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used for a different submission");
    this.name = "IdempotencyConflictError";
  }
}

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === "string" && LEAD_STATUSES.includes(value as LeadStatus);
}
