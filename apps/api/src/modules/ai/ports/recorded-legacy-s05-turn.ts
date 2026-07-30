import type {
  LegacyS05PersistReplyInput,
  LegacyS05TurnOutcome
} from "../profiles/legacy-s05/legacy-s05-orchestrator.js";
import type {
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";
import type {
  RecordedAiPersistReplyResult,
  RecordedAiReplyCompletionPlan
} from "./recorded-ai-turn.js";

export type RecordedLegacyS05PersistReplyResult = RecordedAiPersistReplyResult;

export type RecordedLegacyS05ReplyCompletionPlan = RecordedAiReplyCompletionPlan;

/**
 * Neutral orchestration boundary. Implementations select one completion inside the same
 * transaction that checks the send gate and, when allowed, persists the outbound reply.
 */
export interface RecordedLegacyS05ReplyApplier {
  persistReplyAndCompleteRun(input: {
    run: RunningAiRunRecord;
    reply: LegacyS05PersistReplyInput;
    completionPlan: RecordedLegacyS05ReplyCompletionPlan;
  }): Promise<RecordedLegacyS05PersistReplyResult>;
}

export type RecordedLegacyS05TurnResult =
  | {
      kind: "executed";
      run: TerminalAiRunRecord;
      outcome: LegacyS05TurnOutcome;
    }
  | {
      kind: "terminal_replay";
      run: TerminalAiRunRecord;
    }
  | {
      kind: "running_replay";
      run: RunningAiRunRecord;
    };
