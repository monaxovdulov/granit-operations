import type { SiteFormIntakeRequest, SiteWidgetMessageRequest } from "@granit/contracts";

import type {
  AiTurnExecutionContext,
  AiTurnInput,
  WidgetCatalogReference
} from "../../ai/ai-turn.js";
import type { AiState } from "./lead-conversation-types.js";
import type {
  SaveSiteWidgetAiMessageInput,
  SaveSiteWidgetAiMessageResult,
  SiteWidgetStoredAiReply
} from "./conversation-message-repository.js";

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
  enqueueAiJob?: boolean;
  aiJobMaxAttempts?: number;
};

export type SaveAcceptedSiteWidgetMessageResult = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  channelIdentityId: string;
  inboundMessageId?: string;
  publicSessionId: string;
  publicMessageId: string;
  submittedAt: string;
  agentAllowedToReply: boolean;
  aiState: AiState;
  replayed: boolean;
  aiReply?: SiteWidgetStoredAiReply;
  aiTurnInput?: AiTurnInput;
  aiTurnExecutionContext?: AiTurnExecutionContext;
  widgetAiJob?: SiteWidgetAiJobSummary;
};

export type SiteWidgetAiJobStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "replied"
  | "degraded"
  | "blocked"
  | "failed";

export type SiteWidgetAiJobSummary = {
  id: string;
  status: SiteWidgetAiJobStatus;
  attemptCount: number;
  terminalReason?: string;
};

export type ClaimedSiteWidgetAiJob = SiteWidgetAiJobSummary & {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  publicSessionId: string;
  inboundPublicMessageId: string;
  maxAttempts: number;
  aiTurnInput: AiTurnInput;
};

export type FinishSiteWidgetAiJobInput = {
  jobId: string;
  attemptCount: number;
  status: "replied" | "degraded" | "blocked" | "failed" | "retrying";
  terminalReason?: string;
  outputPublicMessageId?: string;
  lastError?: string;
  retryAt?: Date;
  completedAt: Date;
};

export type RecordSiteWidgetAiDegradationInput = {
  leadId: string;
  conversationId: string;
  inboundPublicMessageId: string;
  inputFingerprint: string;
  reason: string;
  metadata: Record<string, unknown>;
};

export type RecordSiteWidgetAiShadowComparisonInput = {
  version: string;
  publicConversationId: string;
  inboundPublicMessageId: string;
  inputFingerprint?: string;
  startedAt: string;
  completedAt: string;
  legacyLatencyMs: number;
  groundedLatencyMs: number;
  legacyResult: Record<string, unknown>;
  groundedResult?: Record<string, unknown>;
  groundedErrorCode?: string;
};

export type SiteWidgetHistoryResult = {
  publicSessionId: string;
  publicConversationId: string;
  state: "ai_active" | "manager_pending" | "manager_active" | "closed";
  messages: Array<{
    publicMessageId: string;
    senderRole: "visitor" | "ai_assistant" | "manager";
    text: string;
    submittedAt: string;
    catalogReferences?: WidgetCatalogReference[];
    automation?: {
      status: SiteWidgetAiJobStatus;
      reason?: string;
    };
  }>;
};

export interface PublicIntakeRepository {
  saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult>;
  saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult>;
  saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult>;
  findSiteWidgetAiReply?(
    inboundPublicMessageId: string
  ): Promise<SiteWidgetStoredAiReply | null>;
  recordSiteWidgetAiDegradation?(input: RecordSiteWidgetAiDegradationInput): Promise<void>;
  recordSiteWidgetAiShadowComparison?(
    input: RecordSiteWidgetAiShadowComparisonInput
  ): Promise<void>;
  getSiteWidgetHistory?(publicSessionId: string): Promise<SiteWidgetHistoryResult | null>;
  claimSiteWidgetAiJob?(input: {
    leaseMs: number;
    now: Date;
  }): Promise<ClaimedSiteWidgetAiJob | null>;
  finishSiteWidgetAiJob?(input: FinishSiteWidgetAiJobInput): Promise<void>;
}
