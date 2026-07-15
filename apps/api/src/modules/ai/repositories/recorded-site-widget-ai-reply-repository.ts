import type { LegacyS05PersistReplyInput } from "../profiles/legacy-s05/legacy-s05-orchestrator.js";
import type {
  RecordedLegacyS05PersistReplyResult,
  RecordedLegacyS05ReplyCompletionPlan
} from "../ports/recorded-legacy-s05-turn.js";
import type { RunningAiRunRecord } from "./ai-run-repository.js";

export type PersistRecordedSiteWidgetAiReplyInput = {
  run: RunningAiRunRecord;
  reply: LegacyS05PersistReplyInput;
  completionPlan: RecordedLegacyS05ReplyCompletionPlan;
  publicMessageId: string;
  inboundPublicMessageId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  sourcePageUrl: string;
  metadata: Record<string, unknown>;
};

/**
 * Capability implemented only by repositories that can commit the outbound message, send-gate
 * result and reply-bearing AI run completion as one unit.
 */
export interface RecordedSiteWidgetAiReplyRepository {
  persistRecordedSiteWidgetAiReply(
    input: PersistRecordedSiteWidgetAiReplyInput
  ): Promise<RecordedLegacyS05PersistReplyResult>;
}

export function isRecordedSiteWidgetAiReplyRepository(
  value: unknown
): value is RecordedSiteWidgetAiReplyRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    "persistRecordedSiteWidgetAiReply" in value &&
    typeof value.persistRecordedSiteWidgetAiReply === "function"
  );
}
