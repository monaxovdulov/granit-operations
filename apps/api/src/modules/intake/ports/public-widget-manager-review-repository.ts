export const PUBLIC_WIDGET_MANAGER_REVIEW_REASONS = [
  "ai_executor_unavailable",
  "ai_execution_context_invalid",
  "ai_execution_failed",
  "ai_run_in_progress",
  "ai_no_reply",
  "ai_reply_persistence_unconfirmed",
  "ai_send_gate_blocked"
] as const;

export type PublicWidgetManagerReviewReason =
  (typeof PUBLIC_WIDGET_MANAGER_REVIEW_REASONS)[number];

export type TransitionSiteWidgetConversationToManagerReviewInput = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  inboundMessageId: string;
  inboundPublicMessageId: string;
  reason: PublicWidgetManagerReviewReason;
  expectedGenerationEpoch?: number;
  respondsThroughSequence?: number;
  runtimeMode?: "direct_openai" | "mastra_openai_api";
  jobCommit?: {
    jobId: string;
    attemptCount: number;
  };
};

export interface PublicWidgetManagerReviewRepository {
  transitionSiteWidgetConversationToManagerReview(
    input: TransitionSiteWidgetConversationToManagerReviewInput
  ): Promise<void>;
}

export function isPublicWidgetManagerReviewRepository(
  value: unknown
): value is PublicWidgetManagerReviewRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    "transitionSiteWidgetConversationToManagerReview" in value &&
    typeof value.transitionSiteWidgetConversationToManagerReview === "function"
  );
}
