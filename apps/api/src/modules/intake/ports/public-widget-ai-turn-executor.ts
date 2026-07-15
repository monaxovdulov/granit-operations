import type { AiTurnExecutionContext, AiTurnInput } from "../../ai/ai-turn.js";
import type { RecordedAiTurnResult } from "../../ai/ports/recorded-ai-turn.js";

export type PublicWidgetAiTurnExecutionInput = {
  executionContext: AiTurnExecutionContext;
  turnInput: AiTurnInput;
  outbound: {
    publicSessionId: string;
    inboundPublicMessageId: string;
    sourcePageUrl: string;
    aiInputFingerprint: string;
  };
};

/** Narrow intake boundary: it exposes neither Drizzle nor provider/runtime adapters. */
export interface PublicWidgetAiTurnExecutor {
  execute(input: PublicWidgetAiTurnExecutionInput): Promise<RecordedAiTurnResult>;
}
