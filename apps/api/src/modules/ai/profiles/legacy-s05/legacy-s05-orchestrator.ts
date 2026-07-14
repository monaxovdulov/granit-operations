import type { AiTurnExecutionContext, AiTurnInput, AiTurnResult } from "../../ai-turn.js";
import {
  LEGACY_S05_DECISION_PROFILE,
  mapLegacyS05Decision,
  type LegacyS05MappedDecision
} from "./legacy-s05-decision.js";
import { validateLegacyS05Candidate } from "./legacy-s05-validator.js";

export interface LegacyS05DecisionGenerator {
  generateReply(input: AiTurnInput): Promise<unknown>;
}

export type LegacyS05PersistReplyInput = {
  executionContext: AiTurnExecutionContext;
  action: "answer" | "handoff_to_manager";
  replyDraft: string;
  metadata: Record<string, unknown>;
};

export type LegacyS05PersistReplyResult =
  | {
      status: "persisted";
      internalMessageId: string;
      publicMessageId: string;
      body: string;
    }
  | {
      status: "blocked";
      reason: "agent_reply_blocked" | "ai_persistence_unconfirmed";
    };

export interface LegacyS05ReplyApplier {
  persistReply(input: LegacyS05PersistReplyInput): Promise<LegacyS05PersistReplyResult>;
}

export type LegacyS05TurnOutcome = {
  decision: LegacyS05MappedDecision;
  result: AiTurnResult;
  persistedReply?: {
    internalMessageId: string;
    publicMessageId: string;
    body: string;
  };
};

export async function executeLegacyS05Turn(input: {
  executionContext: AiTurnExecutionContext;
  turnInput: AiTurnInput;
  generator: LegacyS05DecisionGenerator;
  applier: LegacyS05ReplyApplier;
}): Promise<LegacyS05TurnOutcome> {
  if (!executionContextMatchesTurnInput(input.executionContext, input.turnInput)) {
    const decision = mapLegacyS05Decision(
      validateLegacyS05Candidate({
        decision: "no_reply",
        reason: "unsafe_model_response",
        metadata: {
          error_type: "execution_context_mismatch"
        }
      })
    );

    return {
      decision,
      result: {
        status: "fallback_unavailable",
        reason: "unsafe_model_response",
        evidence: decisionEvidence(decision)
      }
    };
  }

  const decision = mapLegacyS05Decision(
    validateLegacyS05Candidate(await input.generator.generateReply(input.turnInput))
  );

  if (decision.action === "no_reply") {
    return {
      decision,
      result: {
        status: "fallback_unavailable",
        reason: decision.reason,
        evidence: decisionEvidence(decision)
      }
    };
  }

  const applied = await input.applier.persistReply({
    executionContext: input.executionContext,
    action: decision.action,
    replyDraft: decision.replyDraft,
    metadata: {
      ...decision.metadata,
      normalized_action: decision.action
    }
  });

  if (applied.status === "blocked") {
    return {
      decision,
      result: {
        status: "blocked",
        reason: applied.reason,
        evidence: decisionEvidence(decision)
      }
    };
  }

  const persistedReply = {
    internalMessageId: applied.internalMessageId,
    publicMessageId: applied.publicMessageId,
    body: applied.body
  };

  if (decision.action === "handoff_to_manager") {
    return {
      decision,
      result: {
        status: "handed_off",
        reason: "legacy_s05_handoff_to_manager",
        evidence: {
          ...decisionEvidence(decision),
          outbound_internal_message_id: applied.internalMessageId,
          outbound_public_message_id: applied.publicMessageId
        }
      },
      persistedReply
    };
  }

  return {
    decision,
    result: {
      status: "persisted",
      publicMessageId: applied.publicMessageId,
      evidence: {
        ...decisionEvidence(decision),
        outbound_internal_message_id: applied.internalMessageId
      }
    },
    persistedReply
  };
}

function executionContextMatchesTurnInput(
  context: AiTurnExecutionContext,
  input: AiTurnInput
): boolean {
  return (
    context.channel === input.channel &&
    context.public.conversationId === input.conversation.publicConversationId &&
    context.public.inboundMessageId === input.inboundMessage.publicMessageId &&
    context.turn.idempotencyKey === input.turn.idempotencyKey &&
    context.turn.acceptedRequestFingerprint === input.turn.acceptedRequestFingerprint &&
    context.turn.inputFingerprint === input.turn.inputFingerprint
  );
}

function decisionEvidence(decision: LegacyS05MappedDecision): Record<string, unknown> {
  return {
    decision_profile: LEGACY_S05_DECISION_PROFILE,
    normalized_action: decision.action
  };
}
