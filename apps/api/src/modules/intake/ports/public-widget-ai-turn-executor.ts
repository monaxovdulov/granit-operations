import type { AiTurnExecutionContext, AiTurnInput } from "../../ai/ai-turn.js";
import type { RecordedLegacyS05TurnResult } from "../../ai/ports/recorded-legacy-s05-turn.js";
import type { PublicWidgetAiReplyGenerator } from "./public-widget-ai-reply-generator.js";

export type PublicWidgetAiTurnExecutionInput = {
  executionContext: AiTurnExecutionContext;
  turnInput: AiTurnInput;
  generator: PublicWidgetAiReplyGenerator;
  outbound: {
    publicSessionId: string;
    inboundPublicMessageId: string;
    sourcePageUrl: string;
    aiInputFingerprint: string;
  };
};

/** Narrow intake boundary: it exposes neither Drizzle nor provider/runtime adapters. */
export interface PublicWidgetAiTurnExecutor {
  execute(input: PublicWidgetAiTurnExecutionInput): Promise<RecordedLegacyS05TurnResult>;
}
