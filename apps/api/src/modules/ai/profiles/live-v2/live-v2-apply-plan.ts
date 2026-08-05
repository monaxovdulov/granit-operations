import type {
  LiveV2Candidate,
  LiveV2Gate,
  LiveV2TurnView,
  LiveV2ValidationFailureCode,
  LiveV2ValidationResult
} from "./live-v2-contract.js";

export type LiveV2BlockedApplyPlan = {
  kind: "blocked";
  reason: "gate_closed" | "candidate_invalid";
  validationCode?: LiveV2ValidationFailureCode;
};

export type LiveV2ApplyPlan =
  | {
      kind: "persist_reply";
      action: "answer" | "ask_clarifying_question";
      replyDraft: string;
      agentAllowedToReplyAfterSend: undefined;
      decision: Extract<
        LiveV2Candidate,
        { action: "answer" | "ask_clarifying_question" }
      >;
    }
  | {
      kind: "persist_reply";
      action: "handoff_to_manager";
      replyDraft: string;
      agentAllowedToReplyAfterSend: false;
      decision: Extract<LiveV2Candidate, { action: "handoff_to_manager" }>;
    }
  | {
      kind: "no_reply";
      reason:
        | "no_safe_answer"
        | "missing_approved_fact"
        | "generator_failed"
        | "assets_invalid"
        | "context_invalid"
        | "gate_unavailable";
    }
  | LiveV2BlockedApplyPlan;

export function liveV2GatePlan(turnView: LiveV2TurnView): LiveV2BlockedApplyPlan | null {
  return liveV2GateSnapshotPlan(turnView.gate);
}

export function liveV2GateSnapshotPlan(gate: LiveV2Gate): LiveV2BlockedApplyPlan | null {
  if (
    !gate.agentAllowedToReply ||
    (gate.aiState !== "ai_collecting_info" && gate.aiState !== "watching")
  ) {
    return {
      kind: "blocked",
      reason: "gate_closed"
    };
  }

  return null;
}

export function buildLiveV2ApplyPlan(input: {
  turnView: LiveV2TurnView;
  validation: LiveV2ValidationResult;
}): LiveV2ApplyPlan {
  const gatePlan = liveV2GatePlan(input.turnView);

  if (gatePlan) {
    return gatePlan;
  }

  if (!input.validation.ok) {
    return {
      kind: "blocked",
      reason: "candidate_invalid",
      validationCode: input.validation.code
    };
  }

  const decision = input.validation.decision;

  if (decision.action === "no_reply") {
    return {
      kind: "no_reply",
      reason: decision.reason
    };
  }

  if (decision.action === "handoff_to_manager") {
    return {
      kind: "persist_reply",
      action: decision.action,
      replyDraft: decision.replyDraft,
      agentAllowedToReplyAfterSend: false,
      decision
    };
  }

  return {
    kind: "persist_reply",
    action: decision.action,
    replyDraft: decision.replyDraft,
    agentAllowedToReplyAfterSend: undefined,
    decision
  };
}
