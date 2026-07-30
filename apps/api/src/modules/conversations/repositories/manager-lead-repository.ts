import type { SiteFormUtm, SiteWidgetUtm } from "@granit/contracts";

import type {
  AiRequirementCategory,
  AiRequirementMode,
  AiSlotName
} from "../../ai/ai-dialog-contract.js";
import type {
  AiQualityEventType,
  AiQualityReasonCode,
  AiQualitySeverity,
  AiRunStatus
} from "../../ai/repositories/ai-run-repository.js";

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

export type ManagerAiQualitySummary = {
  eventType: AiQualityEventType;
  reasonCode: AiQualityReasonCode;
  severity: AiQualitySeverity;
  runStatus: AiRunStatus;
  createdAt: string;
};

export type ManagerConversation = {
  publicConversationId: string;
  channel: CustomerChannel;
  channelIdentity: ManagerChannelIdentity;
  status: "open";
  aiState: AiState;
  agentAllowedToReply: boolean;
  latestUnresolvedAiQuality?: ManagerAiQualitySummary;
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

export type ManagerStructuredIntakeSlot = {
  publicConversationId: string;
  name: AiSlotName;
  value: string;
  source: "contact" | "visitor_message" | "ai_extraction" | "manager";
  sourceMessageId?: string;
  confidence: number;
  evidence?: {
    quote: string;
    start: number;
    end: number;
  };
  updatedAt: string;
};

export type ManagerStructuredIntake = {
  slots: ManagerStructuredIntakeSlot[];
  requirements: Array<{
    publicConversationId: string;
    category: AiRequirementCategory;
    mode: AiRequirementMode;
    value: string;
    sourceMessageId: string;
    confidence: number;
    evidence: {
      quote: string;
      start: number;
      end: number;
    };
    updatedAt: string;
  }>;
  conflicts: Array<{
    publicConversationId: string;
    name: AiSlotName;
    candidateValue: string;
    currentValue?: string;
    sourceMessageId?: string;
    evidence?: {
      quote: string;
      start: number;
      end: number;
    };
    applied: boolean;
    createdAt: string;
  }>;
  missingFields: AiSlotName[];
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

export type RecordAiReviewLabelInput = {
  leadId: string;
  aiRunId: string;
  label: AiReviewLabel;
  note?: string;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type ManagerAiControl = {
  enabled: boolean;
  version: number;
  changedByManagerEmail?: string;
  changedAt: string;
};

export class AiControlVersionConflictError extends Error {
  constructor() {
    super("manager AI control version conflict");
    this.name = "AiControlVersionConflictError";
  }
}

export type SetManagerAiControlInput = {
  enabled: boolean;
  expectedVersion: number;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type SetConversationAiControlInput = {
  leadId: string;
  publicConversationId: string;
  enabled: boolean;
  changedByManagerId: string;
  changedByManagerEmail: string;
  changedByManagerRole: string;
};

export type ManagerLeadDetail = ManagerLeadListItem & {
  timeline: ManagerTimelineEvent[];
  conversations: ManagerConversation[];
  structuredIntake: ManagerStructuredIntake;
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
  getManagerAiControl?(): Promise<ManagerAiControl>;
  setManagerAiControl?(input: SetManagerAiControlInput): Promise<ManagerAiControl>;
  setConversationAiControl?(
    input: SetConversationAiControlInput
  ): Promise<ManagerLeadDetail | null>;
  listManagerLeads(): Promise<ManagerLeadListItem[]>;
  getManagerLead(leadId: string): Promise<ManagerLeadDetail | null>;
  recordAiReviewLabel(input: RecordAiReviewLabelInput): Promise<ManagerLeadDetail | null>;
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
