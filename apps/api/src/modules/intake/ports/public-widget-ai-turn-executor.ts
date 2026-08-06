import type { AiTurnExecutionContext, AiTurnInput } from "../../ai/ai-turn.js";
import type { RecordedAiTurnResult } from "../../ai/ports/recorded-ai-turn.js";

export type PublicWidgetAiTurnExecutionInput = {
  executionContext: AiTurnExecutionContext;
  turnInput: AiTurnInput;
  signal?: AbortSignal;
  outbound: {
    publicSessionId: string;
    inboundPublicMessageId: string;
    sourcePageUrl: string;
    aiInputFingerprint: string;
    idempotencyKey?: string;
    expectedGenerationEpoch?: number;
    respondsThroughSequence?: number;
    runtimeMode?: "direct_openai" | "mastra_openai_api";
    queueWaitMs?: number;
    jobCommit?: {
      jobId: string;
      attemptCount: number;
      maxAttempts: number;
    };
  };
};

/** Narrow intake boundary: it exposes neither Drizzle nor provider/runtime adapters. */
export interface PublicWidgetAiTurnExecutor {
  execute(input: PublicWidgetAiTurnExecutionInput): Promise<RecordedAiTurnResult>;
}
