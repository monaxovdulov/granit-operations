import type { SiteFormIntakeRequest, SiteFormUtm } from "@granit/contracts";

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

export type ManagerLeadSource = {
  channel: "site_form";
  pageUrl: string;
  formKind: string;
  referrerUrl?: string;
  utm?: SiteFormUtm;
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
  createdAt: string;
};

export type ManagerLeadListItem = {
  leadId: string;
  publicSubmissionId: string;
  status: "new";
  source: ManagerLeadSource;
  contact: ManagerLeadContact;
  request: ManagerLeadRequest;
  submittedAt: string;
  createdAt: string;
};

export type ManagerLeadDetail = ManagerLeadListItem & {
  timeline: ManagerTimelineEvent[];
  internalNotePlaceholder: string;
};

export interface IntakeRepository {
  saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult>;
  listManagerLeads(): Promise<ManagerLeadListItem[]>;
  getManagerLead(leadId: string): Promise<ManagerLeadDetail | null>;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("idempotency key was already used for a different submission");
    this.name = "IdempotencyConflictError";
  }
}
