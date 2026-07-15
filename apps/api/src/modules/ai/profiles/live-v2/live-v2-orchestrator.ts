import type { AiTurnInput } from "../../ai-turn.js";
import {
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset,
  type LiveV2FactsSnapshot,
  type LiveV2ModelFactsAsset
} from "./live-v2-assets.js";
import {
  buildLiveV2ApplyPlan,
  liveV2GateSnapshotPlan,
  type LiveV2ApplyPlan
} from "./live-v2-apply-plan.js";
import { buildLiveV2TurnView } from "./live-v2-context.js";
import type {
  LiveV2Gate,
  LiveV2TurnView,
  LiveV2ValidationResult
} from "./live-v2-contract.js";
import { validateLiveV2Candidate } from "./live-v2-validator.js";
import { LIVE_V2_PROMPT_ASSET } from "./assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "./assets/tone.v1.js";

export type LiveV2GeneratorInput = {
  turn: LiveV2TurnView;
  assets: {
    prompt: typeof LIVE_V2_PROMPT_ASSET;
    tone: typeof LIVE_V2_TONE_ASSET;
    facts: LiveV2ModelFactsAsset;
  };
};

export interface LiveV2DecisionGenerator {
  generateDecision(input: LiveV2GeneratorInput): Promise<unknown>;
}

export interface LiveV2GateReader {
  readGate(): Promise<LiveV2Gate>;
}

export type LiveV2TurnOutcome =
  | {
      status: "blocked_before_generation";
      turnView: null;
      validation: null;
      plan: LiveV2ApplyPlan;
    }
  | {
      status: "context_invalid";
      turnView: null;
      validation: null;
      plan: Extract<LiveV2ApplyPlan, { kind: "no_reply" }>;
    }
  | {
      status: "generator_failed";
      turnView: LiveV2TurnView;
      validation: null;
      plan: Extract<LiveV2ApplyPlan, { kind: "no_reply" }>;
    }
  | {
      status: "gate_unavailable";
      turnView: LiveV2TurnView;
      validation: LiveV2ValidationResult;
      plan: Extract<LiveV2ApplyPlan, { kind: "no_reply" }>;
    }
  | {
      status: "assets_invalid";
      turnView: LiveV2TurnView;
      validation: null;
      plan: Extract<LiveV2ApplyPlan, { kind: "no_reply" }>;
    }
  | {
      status: "evaluated";
      turnView: LiveV2TurnView;
      validation: LiveV2ValidationResult;
      plan: LiveV2ApplyPlan;
    };

export async function executeLiveV2Turn(input: {
  turnInput: AiTurnInput;
  approvedFacts: LiveV2FactsSnapshot;
  generator: LiveV2DecisionGenerator;
  gateReader: LiveV2GateReader;
}): Promise<LiveV2TurnOutcome> {
  const gatePlan = liveV2GateSnapshotPlan(input.turnInput.gateSnapshot);

  if (gatePlan) {
    return {
      status: "blocked_before_generation",
      turnView: null,
      validation: null,
      plan: gatePlan
    };
  }

  let turnView: LiveV2TurnView;

  try {
    turnView = buildLiveV2TurnView(input.turnInput);
  } catch {
    return {
      status: "context_invalid",
      turnView: null,
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "context_invalid"
      }
    };
  }

  let approvedFacts: LiveV2FactsSnapshot;

  try {
    approvedFacts = parseLiveV2FactsSnapshot(input.approvedFacts);
  } catch {
    return {
      status: "assets_invalid",
      turnView,
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "assets_invalid"
      }
    };
  }

  let rawCandidate: unknown;

  try {
    rawCandidate = await input.generator.generateDecision({
      turn: turnView,
      assets: {
        prompt: LIVE_V2_PROMPT_ASSET,
        tone: LIVE_V2_TONE_ASSET,
        facts: toLiveV2ModelFactsAsset(approvedFacts)
      }
    });
  } catch {
    return {
      status: "generator_failed",
      turnView,
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "generator_failed"
      }
    };
  }

  const validation = validateLiveV2Candidate({
    value: rawCandidate,
    turnView,
    approvedFacts
  });

  if (!validation.ok || validation.decision.action === "no_reply") {
    return {
      status: "evaluated",
      turnView,
      validation,
      plan: buildLiveV2ApplyPlan({ turnView, validation })
    };
  }

  let freshGate: LiveV2Gate;

  try {
    const readGate = await input.gateReader.readGate();
    freshGate = {
      aiState: readGate.aiState,
      agentAllowedToReply: readGate.agentAllowedToReply
    };
  } catch {
    return {
      status: "gate_unavailable",
      turnView,
      validation,
      plan: {
        kind: "no_reply",
        reason: "gate_unavailable"
      }
    };
  }

  const freshTurnView: LiveV2TurnView = {
    ...turnView,
    gate: freshGate
  };

  return {
    status: "evaluated",
    turnView: freshTurnView,
    validation,
    plan: buildLiveV2ApplyPlan({ turnView: freshTurnView, validation })
  };
}
