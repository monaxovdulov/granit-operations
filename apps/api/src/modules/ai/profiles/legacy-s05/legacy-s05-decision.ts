import type {
  AiReplyCandidateDecision,
  AiReplyCandidateEvidence,
  AiUnavailableReason
} from "../../ai-turn.js";

export const LEGACY_S05_DECISION_PROFILE = "legacy_s05" as const;

type LegacyS05MappedDecisionBase = {
  decisionProfile: typeof LEGACY_S05_DECISION_PROFILE;
  metadata: Record<string, unknown> & {
    decision_profile: typeof LEGACY_S05_DECISION_PROFILE;
  };
};

export type LegacyS05MappedDecision =
  | (LegacyS05MappedDecisionBase & {
      action: "answer";
      replyDraft: string;
      reason: null;
      evidence?: AiReplyCandidateEvidence;
    })
  | (LegacyS05MappedDecisionBase & {
      action: "handoff_to_manager";
      replyDraft: string;
      reason: null;
      evidence?: AiReplyCandidateEvidence;
    })
  | (LegacyS05MappedDecisionBase & {
      action: "no_reply";
      replyDraft: null;
      reason: AiUnavailableReason;
    });

export function mapLegacyS05Decision(
  candidate: AiReplyCandidateDecision
): LegacyS05MappedDecision {
  const metadata = {
    ...candidate.metadata,
    decision_profile: LEGACY_S05_DECISION_PROFILE
  };

  if (candidate.decision === "no_reply") {
    return {
      decisionProfile: LEGACY_S05_DECISION_PROFILE,
      action: "no_reply",
      replyDraft: null,
      reason: candidate.reason,
      metadata
    };
  }

  const shouldStopAi = candidate.agentAllowedToReplyAfterSend === false;

  return {
    decisionProfile: LEGACY_S05_DECISION_PROFILE,
    action: shouldStopAi ? "handoff_to_manager" : "answer",
    replyDraft: candidate.text,
    reason: null,
    metadata,
    ...(candidate.evidence ? { evidence: candidate.evidence } : {})
  };
}
