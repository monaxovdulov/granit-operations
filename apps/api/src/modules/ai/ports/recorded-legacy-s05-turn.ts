import type {
  LegacyS05PersistReplyInput,
  LegacyS05PersistReplyResult,
  LegacyS05TurnOutcome
} from "../profiles/legacy-s05/legacy-s05-orchestrator.js";
import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";

export type RecordedLegacyS05PersistReplyResult =
  | (Extract<LegacyS05PersistReplyResult, { status: "persisted" }> & {
      completedRun: TerminalAiRunRecord;
    })
  | (Extract<LegacyS05PersistReplyResult, { status: "blocked" }> & {
      completedRun: TerminalAiRunRecord;
    });

export type RecordedLegacyS05ReplyCompletionPlan = {
  allowed: AiRunTerminalCompletion;
  agentReplyBlocked: AiRunTerminalCompletion;
  persistenceUnconfirmed: AiRunTerminalCompletion;
};

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
