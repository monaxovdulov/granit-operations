import type {
  RecordedAiPersistReplyInput,
  RecordedAiPersistReplyResult,
  RecordedAiReplyCompletionPlan
} from "../ports/recorded-ai-turn.js";
import type { AiTurnAiState } from "../ai-turn.js";
import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "./ai-run-repository.js";

export type PersistRecordedSiteWidgetAiReplyInput = {
  run: RunningAiRunRecord;
  reply: RecordedAiPersistReplyInput;
  completionPlan: RecordedAiReplyCompletionPlan;
  publicMessageId: string;
  inboundPublicMessageId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourcePageUrl: string;
  metadata: Record<string, unknown>;
  expectedGenerationEpoch?: number;
  respondsThroughSequence?: number;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  jobCommit?: {
    jobId: string;
    attemptCount: number;
  };
};

export type CompleteRecordedSiteWidgetAiNoReplyInput = {
  run: RunningAiRunRecord;
  completion: AiRunTerminalCompletion;
  publicConversationId: string;
  inboundPublicMessageId: string;
  expectedGenerationEpoch?: number;
  respondsThroughSequence?: number;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  jobCommit?: {
    jobId: string;
    attemptCount: number;
  };
};

/**
 * Capability implemented only by repositories that can commit the outbound message, send-gate
 * result and reply-bearing AI run completion as one unit.
 */
export interface RecordedSiteWidgetAiReplyRepository {
  persistRecordedSiteWidgetAiReply(
    input: PersistRecordedSiteWidgetAiReplyInput
  ): Promise<RecordedAiPersistReplyResult>;
  completeRecordedSiteWidgetAiNoReply(
    input: CompleteRecordedSiteWidgetAiNoReplyInput
  ): Promise<TerminalAiRunRecord>;
}

export interface RecordedSiteWidgetAiGateRepository {
  readRecordedSiteWidgetAiGate(input: {
    leadId: string;
    conversationId: string;
  }): Promise<{
    aiState: AiTurnAiState;
    agentAllowedToReply: boolean;
  }>;
}

export function isRecordedSiteWidgetAiReplyRepository(
  value: unknown
): value is RecordedSiteWidgetAiReplyRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    "persistRecordedSiteWidgetAiReply" in value &&
    typeof value.persistRecordedSiteWidgetAiReply === "function" &&
    "completeRecordedSiteWidgetAiNoReply" in value &&
    typeof value.completeRecordedSiteWidgetAiNoReply === "function"
  );
}

export function isRecordedSiteWidgetAiGateRepository(
  value: unknown
): value is RecordedSiteWidgetAiGateRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    "readRecordedSiteWidgetAiGate" in value &&
    typeof value.readRecordedSiteWidgetAiGate === "function"
  );
}
