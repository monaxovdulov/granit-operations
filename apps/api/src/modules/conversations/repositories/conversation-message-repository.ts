import type { SiteWidgetUtm } from "@granit/contracts";

import type { AiTurnExecutionContext, AiTurnInput } from "../../ai/ai-turn.js";
import type {
  AiHandoffReason,
  AiRequirementUpdate,
  AiSlotUpdate,
  AiTurnAction,
  AiTurnIntent
} from "../../ai/ai-dialog-contract.js";
import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../../ai/repositories/ai-run-repository.js";
import type {
  AiState,
  ChannelProvider,
  ConversationContentType,
  CustomerChannel,
  NeedsManagerReason
} from "./lead-conversation-types.js";

export type SiteWidgetStoredAiReply = {
  internalMessageId?: string;
  publicMessageId: string;
  body: string;
  createdAt: string;
};

export type WidgetAiTurnIdentity = {
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
};

export type WidgetAiJobCommitIdentity = {
  jobId: string;
  attemptCount: number;
};

export function buildWidgetAiTurnIdempotencyKey(input: {
  conversationId: string;
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
  runtimeMode: "direct_openai" | "mastra_openai_api";
}): string {
  return [
    "ai-window",
    input.conversationId,
    input.expectedGenerationEpoch,
    input.respondsThroughSequence,
    input.runtimeMode
  ].join(":");
}

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
  serverTimestamped?: boolean;
  enqueueWidgetAiJob?: boolean;
  widgetAiJobMaxAttempts?: number;
  widgetAiRuntimeMode?: "direct_openai" | "mastra_openai_api";
  needsManagerReason?: NeedsManagerReason;
  managerPanelBaseUrl?: string;
  metadata: Record<string, unknown>;
};

export type AcceptInboundMessageResult = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  channelIdentityId: string;
  inboundMessageId?: string;
  publicMessageId: string;
  submittedAt?: string;
  widgetPublicSessionId?: string;
  agentAllowedToReply: boolean;
  aiState: AiState;
  replayed: boolean;
  existingAiReply?: SiteWidgetStoredAiReply;
  aiTurnInput?: AiTurnInput;
  aiTurnExecutionContext?: AiTurnExecutionContext;
  turnIdentity?: WidgetAiTurnIdentity;
  widgetAiJob?: WidgetAiTurnIdentity & {
    id: string;
    status:
      | "pending"
      | "processing"
      | "retrying"
      | "replied"
      | "degraded"
      | "blocked"
      | "failed"
      | "superseded";
    attemptCount: number;
    terminalReason?: string;
  };
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
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  jobCommit?: WidgetAiJobCommitIdentity;
  body: string;
  sourcePageUrl?: string;
  metadata: Record<string, unknown>;
  agentAllowedToReplyAfterSend?: boolean;
  slotUpdates?: AiSlotUpdate[];
  requirementUpdates?: AiRequirementUpdate[];
  aiRun?: {
    inputFingerprint: string;
    action: AiTurnAction;
    intent: AiTurnIntent;
    promptVersion?: string;
    policyVersion?: string;
    knowledgeVersion?: string;
    modelVersion?: string;
    generatorModelName?: string;
    verifierModelName?: string;
    verifierVersion?: string;
    verifierVerdict?: string;
    catalogVersion?: string;
    catalogContentHash?: string;
  };
  handoff?: {
    reason: AiHandoffReason;
    summary: string;
    slotsSnapshot: Record<string, unknown>;
  };
  recordedRun?: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  };
};

export type SaveSiteWidgetAiMessageInput = Omit<
  PersistAiReplyWithSendGateInput,
  "channel" | "provider"
>;

export type SaveSiteWidgetAiMessageResult = SiteWidgetStoredAiReply & {
  internalMessageId?: string;
  completedRun?: TerminalAiRunRecord;
};

export type SiteWidgetAiMessageLookupResult = SiteWidgetStoredAiReply & {
  requestFingerprint: string;
};

export interface ConversationMessageRepository {
  acceptInboundMessage(input: AcceptInboundMessageInput): Promise<AcceptInboundMessageResult>;
  persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult>;
}
