import type { PublicWidgetAiReplyGenerator } from "../../intake/ports/public-widget-ai-reply-generator.js";
import type {
  RecordedAiTurnResult,
  RecordedAiTurnService
} from "../ports/recorded-ai-turn.js";
import { RecordedLegacyS05TurnService } from "./recorded-legacy-s05-turn-service.js";

/** Keeps the frozen legacy generator inside the direct runtime assembly. */
export class BoundRecordedLegacyS05TurnService implements RecordedAiTurnService {
  constructor(
    private readonly service: RecordedLegacyS05TurnService,
    private readonly generator: PublicWidgetAiReplyGenerator
  ) {}

  async execute(
    input: Parameters<RecordedAiTurnService["execute"]>[0]
  ): Promise<RecordedAiTurnResult> {
    return this.service.execute({
      executionContext: input.executionContext,
      turnInput: input.turnInput,
      signal: input.signal,
      generator: this.generator,
      replyApplier: {
        persistReplyAndCompleteRun: ({ run, reply, completionPlan }) =>
          input.replyApplier.persistReplyAndCompleteRun({
            run,
            reply: {
              executionContext: reply.executionContext,
              action: reply.action,
              replyDraft: reply.replyDraft,
              metadata: reply.metadata,
              ...(reply.action === "handoff_to_manager"
                ? { agentAllowedToReplyAfterSend: false }
                : {})
            },
            completionPlan
          })
      },
      noReplyApplier: input.noReplyApplier
    });
  }
}
