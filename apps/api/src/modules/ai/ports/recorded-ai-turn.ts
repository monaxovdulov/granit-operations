import type { AiTurnExecutionContext, AiTurnInput, AiTurnResult } from "../ai-turn.js";
import type { AiHandoffReason, AiRequirementUpdate, AiSlotUpdate } from "../ai-dialog-contract.js";
import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";

export type RecordedAiReplyAction = "answer" | "ask_clarifying_question" | "handoff_to_manager";

export type RecordedAiPersistReplyInput = {
  executionContext: AiTurnExecutionContext;
  action: RecordedAiReplyAction;
  replyDraft: string;
  finalTextHash?: string;
  metadata: Record<string, unknown>;
  agentAllowedToReplyAfterSend?: boolean;
  slotUpdates?: AiSlotUpdate[];
  requirementUpdates?: AiRequirementUpdate[];
  handoff?: {
    reason: AiHandoffReason;
    summary: string;
    slotsSnapshot: Record<string, unknown>;
  };
};

export type RecordedAiPersistReplyResult =
  | {
      status: "persisted";
      internalMessageId: string;
      publicMessageId: string;
      body: string;
      completedRun: TerminalAiRunRecord;
    }
  | {
      status: "blocked";
      reason: "agent_reply_blocked" | "ai_persistence_unconfirmed";
      completedRun: TerminalAiRunRecord;
    };

export type RecordedAiReplyCompletionPlan = {
  allowed: AiRunTerminalCompletion;
  agentReplyBlocked: AiRunTerminalCompletion;
  persistenceUnconfirmed: AiRunTerminalCompletion;
};

/**
 * App-owned atomic boundary. The runtime can propose a reply, but only this boundary can check
 * the current send gate, persist the outbound message and complete the run in one unit.
 */
export interface RecordedAiReplyApplier {
  persistReplyAndCompleteRun(input: {
    run: RunningAiRunRecord;
    reply: RecordedAiPersistReplyInput;
    completionPlan: RecordedAiReplyCompletionPlan;
  }): Promise<RecordedAiPersistReplyResult>;
}

/**
 * App-owned terminal boundary for a recorded turn that produces no outbound reply. Queued
 * executions use it to fence the live lease attempt and commit the run, manager handoff and job
 * terminal state together.
 */
export interface RecordedAiNoReplyApplier {
  completeWithoutReply(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<TerminalAiRunRecord>;
  failAttempt?(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void>;
  fenceAttempt?(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void>;
}

export type RecordedAiTurnOutcome = {
  decision: {
    action: RecordedAiReplyAction | "no_reply";
    reason: string | null;
  };
  result: AiTurnResult;
  persistedReply?: {
    internalMessageId: string;
    publicMessageId: string;
    body: string;
  };
};

export type RecordedAiTurnResult =
  | {
      kind: "executed";
      run: TerminalAiRunRecord;
      outcome: RecordedAiTurnOutcome;
    }
  | {
      kind: "terminal_replay";
      run: TerminalAiRunRecord;
    }
  | {
      kind: "running_replay";
      run: RunningAiRunRecord;
    };

/** Runtime-neutral service selected by the app assembly. It has no delivery or repository API. */
export interface RecordedAiTurnService {
  execute(input: {
    executionContext: AiTurnExecutionContext;
    turnInput: AiTurnInput;
    signal?: AbortSignal;
    attempt?: {
      attemptNumber: number;
      idempotencyKey: string;
      jobId?: string;
      jobAttemptCount: number;
      maxAttempts?: number;
    };
    replyApplier: RecordedAiReplyApplier;
    noReplyApplier?: RecordedAiNoReplyApplier;
  }): Promise<RecordedAiTurnResult>;
}
