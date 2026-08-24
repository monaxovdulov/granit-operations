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
  SiteWidgetStoredAiReply,
  WidgetAiCurrentResponseWindow,
  WidgetAiTurnIdentity
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
  aiJobRuntimeMode?: "direct_openai" | "mastra_openai_api";
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
  turnIdentity?: WidgetAiTurnIdentity;
  currentWidgetAiWindow?: WidgetAiCurrentResponseWindow;
  aiRuntimeEnabled?: boolean;
  widgetAiJob?: SiteWidgetAiJobSummary;
  latestWidgetAiJob?: SiteWidgetAiJobSummary;
};

export type SiteWidgetAiJobStatus =
  | "pending"
  | "processing"
  | "retrying"
  | "replied"
  | "degraded"
  | "blocked"
  | "failed"
  | "superseded";

export type SiteWidgetAiJobSummary = WidgetAiTurnIdentity & {
  id: string;
  inboundPublicMessageId: string;
  status: SiteWidgetAiJobStatus;
  attemptCount: number;
  maxAttempts: number;
  terminalReason?: string;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  queueWaitMs?: number;
};

export type ClaimedSiteWidgetAiJob = SiteWidgetAiJobSummary & {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  publicSessionId: string;
  inboundPublicMessageId: string;
  maxAttempts: number;
  runtimeMode: "direct_openai" | "mastra_openai_api";
  queueWaitMs: number;
  aiTurnInput: AiTurnInput;
  aiTurnExecutionContext: AiTurnExecutionContext;
};

export type FinishSiteWidgetAiJobInput = {
  jobId: string;
  attemptCount: number;
  status: "replied" | "degraded" | "blocked" | "failed" | "retrying" | "superseded";
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
  expectedGenerationEpoch?: number;
  respondsThroughSequence?: number;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  jobCommit?: {
    jobId: string;
    attemptCount: number;
    maxAttempts: number;
  };
};

export type SiteWidgetHistoryResult = {
  publicSessionId: string;
  publicConversationId: string;
  state: "ai_active" | "manager_pending" | "manager_active" | "closed";
  agentAllowedToReply: boolean;
  runtimeEnabled: boolean;
  currentWidgetAiWindow?: WidgetAiCurrentResponseWindow;
  messages: Array<{
    publicMessageId: string;
    senderRole: "visitor" | "ai_assistant" | "manager";
    text: string;
    submittedAt: string;
    catalogReferences?: WidgetCatalogReference[];
    automation?: {
      status: SiteWidgetAiJobStatus;
      reason?: string;
      expectedGenerationEpoch: number;
      respondsThroughSequence: number;
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
  findSiteWidgetAiReply?(inboundPublicMessageId: string): Promise<SiteWidgetStoredAiReply | null>;
  recordSiteWidgetAiDegradation?(input: RecordSiteWidgetAiDegradationInput): Promise<void>;
  getSiteWidgetHistory?(publicSessionId: string): Promise<SiteWidgetHistoryResult | null>;
  claimSiteWidgetAiJob?(input: {
    leaseMs: number;
    now: Date;
  }): Promise<ClaimedSiteWidgetAiJob | null>;
  isSiteWidgetAiJobCurrent?(input: { jobId: string; attemptCount: number }): Promise<boolean>;
  finishSiteWidgetAiJob?(input: FinishSiteWidgetAiJobInput): Promise<void>;
}
