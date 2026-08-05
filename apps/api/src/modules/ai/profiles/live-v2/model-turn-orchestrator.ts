import type { AiTurnInput } from "../../ai-turn.js";
import type { LiveV2FactsSnapshot } from "./live-v2-assets.js";
import {
  parseLiveV2FactsSnapshot,
  toLiveV2ModelFactsAsset
} from "./live-v2-assets.js";
import { buildLiveV2TurnView } from "./live-v2-context.js";
import type { LiveV2Gate, LiveV2TurnView } from "./live-v2-contract.js";
import { liveV2GateSnapshotPlan } from "./live-v2-apply-plan.js";
import type {
  LiveV2DecisionGenerator,
  LiveV2GeneratorInput,
  LiveV2GateReader
} from "./live-v2-orchestrator.js";
import { MODEL_TURN_PROMPT_ASSET } from "./assets/model-turn-prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "./assets/tone.v1.js";
import type {
  ModelTurnValidationResult,
  ValidatedTurnPlan
} from "./model-turn-contract.js";
import { validateModelTurnOutput } from "./model-turn-validator.js";

export type ModelTurnApplyPlan =
  | {
      kind: "persist_reply";
      action: ValidatedTurnPlan["action"];
      replyDraft: string;
      finalTextHash: string;
      agentAllowedToReplyAfterSend?: false;
      validatedPlan: ValidatedTurnPlan;
    }
  | {
      kind: "blocked";
      reason: "gate_closed" | "candidate_invalid";
      validationCode?: string;
    }
  | {
      kind: "no_reply";
      reason:
        | "generator_failed"
        | "assets_invalid"
        | "context_invalid"
        | "gate_unavailable";
    };

export type ModelTurnOutcome = {
  status:
    | "blocked_before_generation"
    | "context_invalid"
    | "generator_failed"
    | "gate_unavailable"
    | "assets_invalid"
    | "evaluated";
  turnView: LiveV2TurnView | null;
  validation: ModelTurnValidationResult | null;
  plan: ModelTurnApplyPlan;
};

export async function executeModelTurn(input: {
  turnInput: AiTurnInput;
  approvedFacts: LiveV2FactsSnapshot;
  generator: LiveV2DecisionGenerator;
  gateReader: LiveV2GateReader;
}): Promise<ModelTurnOutcome> {
  if (gateClosed(input.turnInput.gateSnapshot)) {
    return {
      status: "blocked_before_generation",
      turnView: null,
      validation: null,
      plan: { kind: "blocked", reason: "gate_closed" }
    };
  }

  let turnView: LiveV2TurnView;
  try {
    turnView = buildLiveV2TurnView(input.turnInput);
  } catch {
    return terminalNoReply("context_invalid", null);
  }

  let facts: LiveV2FactsSnapshot;
  try {
    facts = parseLiveV2FactsSnapshot(input.approvedFacts);
  } catch {
    return terminalNoReply("assets_invalid", turnView);
  }

  let rawOutput: unknown;
  try {
    const generatorInput: LiveV2GeneratorInput = {
      turn: turnView,
      assets: {
        prompt: MODEL_TURN_PROMPT_ASSET,
        tone: LIVE_V2_TONE_ASSET,
        facts: toLiveV2ModelFactsAsset(facts)
      }
    };
    rawOutput = await input.generator.generateDecision(generatorInput);
  } catch {
    return terminalNoReply("generator_failed", turnView);
  }

  const validation = validateModelTurnOutput({ value: rawOutput, turnInput: input.turnInput });

  if (!validation.ok) {
    return {
      status: "evaluated",
      turnView,
      validation,
      plan: {
        kind: "blocked",
        reason: "candidate_invalid",
        validationCode: validation.code
      }
    };
  }

  let freshGate: LiveV2Gate;
  try {
    freshGate = await input.gateReader.readGate();
  } catch {
    return {
      status: "gate_unavailable",
      turnView,
      validation,
      plan: { kind: "no_reply", reason: "gate_unavailable" }
    };
  }

  if (gateClosed(freshGate)) {
    return {
      status: "evaluated",
      turnView: { ...turnView, gate: freshGate },
      validation,
      plan: { kind: "blocked", reason: "gate_closed" }
    };
  }

  const plan = validation.plan;
  return {
    status: "evaluated",
    turnView: { ...turnView, gate: freshGate },
    validation,
    plan: {
      kind: "persist_reply",
      action: plan.action,
      replyDraft: plan.finalText,
      finalTextHash: plan.finalTextHash,
      ...(plan.handoffAction ? { agentAllowedToReplyAfterSend: false as const } : {}),
      validatedPlan: plan
    }
  };
}

function gateClosed(gate: LiveV2Gate): boolean {
  return liveV2GateSnapshotPlan(gate) !== null;
}

function terminalNoReply(
  reason: "context_invalid" | "assets_invalid" | "generator_failed",
  turnView: LiveV2TurnView | null
): ModelTurnOutcome {
  return {
    status: reason,
    turnView,
    validation: null,
    plan: { kind: "no_reply", reason }
  };
}
