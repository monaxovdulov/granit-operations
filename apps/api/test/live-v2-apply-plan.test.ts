import { describe, expect, it, vi } from "vitest";

import { buildLiveV2ApplyPlan } from "../src/modules/ai/profiles/live-v2/live-v2-apply-plan.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import {
  executeLiveV2Turn,
  type LiveV2GeneratorInput
} from "../src/modules/ai/profiles/live-v2/live-v2-orchestrator.js";
import {
  LIVE_V2_PROMPT_ASSET,
  LIVE_V2_PROMPT_VERSION
} from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import {
  LIVE_V2_TONE_ASSET,
  LIVE_V2_TONE_VERSION
} from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { LIVE_V2_FACTS_VERSION } from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import {
  TEST_LIVE_V2_AS_OF_DATE,
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  buildLiveV2TestGateReader,
  buildLiveV2TestTurn,
  contextMessage,
  handoffCandidate,
  noReplyCandidate
} from "./fixtures/live-v2-synthetic.v1.js";

describe("live_v2 deterministic apply plan", () => {
  it("maps a valid answer to persistence without closing the AI gate", () => {
    const turnView = buildLiveV2TurnView(buildLiveV2TestTurn());
    const decision = answerCandidate();

    expect(
      buildLiveV2ApplyPlan({
        turnView,
        validation: { ok: true, decision }
      })
    ).toEqual({
      kind: "persist_reply",
      action: "answer",
      replyDraft: decision.replyDraft,
      agentAllowedToReplyAfterSend: undefined,
      decision
    });
  });

  it("maps an explicit handoff to persistence with the AI gate closed after send", () => {
    const turnView = buildLiveV2TurnView(buildLiveV2TestTurn());
    const decision = handoffCandidate();

    expect(
      buildLiveV2ApplyPlan({
        turnView,
        validation: { ok: true, decision }
      })
    ).toEqual({
      kind: "persist_reply",
      action: "handoff_to_manager",
      replyDraft: decision.replyDraft,
      agentAllowedToReplyAfterSend: false,
      decision
    });
  });

  it("keeps valid no_reply terminal and blocks an invalid candidate", () => {
    const turnView = buildLiveV2TurnView(buildLiveV2TestTurn());

    expect(
      buildLiveV2ApplyPlan({
        turnView,
        validation: {
          ok: true,
          decision: noReplyCandidate("missing_approved_fact")
        }
      })
    ).toEqual({
      kind: "no_reply",
      reason: "missing_approved_fact"
    });

    expect(
      buildLiveV2ApplyPlan({
        turnView,
        validation: { ok: false, code: "invalid_shape" }
      })
    ).toEqual({
      kind: "blocked",
      reason: "candidate_invalid",
      validationCode: "invalid_shape"
    });
  });
});

describe("live_v2 provider-neutral orchestration", () => {
  it("passes only the model-safe turn and versioned assets to the generator", async () => {
    const generateDecision = vi.fn(async (_input: LiveV2GeneratorInput) => answerCandidate());
    const turnInput = buildLiveV2TestTurn({
      inbound: "Нужен спокойный вертикальный вариант",
      city: "Москва",
      phoneProvided: true,
      previousMessagesNewestFirst: [
        contextMessage({
          id: 1,
          role: "assistant",
          text: "Какой стиль оформления вам ближе?"
        })
      ]
    });
    const gateReader = buildLiveV2TestGateReader(turnInput);

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "evaluated",
      validation: { ok: true, decision: { action: "answer" } },
      plan: {
        kind: "persist_reply",
        action: "answer",
        agentAllowedToReplyAfterSend: undefined
      }
    });
    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(gateReader.readGate).toHaveBeenCalledTimes(1);

    const generatorInput = generateDecision.mock.calls[0]![0];
    const serializedTurn = JSON.stringify(generatorInput.turn);

    expect(Object.keys(generatorInput.turn).sort()).toEqual([
      "gate",
      "knownSlots",
      "lastAiQuestion",
      "messages",
      "version"
    ]);
    expect(serializedTurn).not.toContain("publicMessageId");
    expect(serializedTurn).not.toContain("submittedAt");
    expect(serializedTurn).not.toContain("https://");
    expect(serializedTurn).not.toContain("00000000-");
    expect(generatorInput.assets).toEqual({
      prompt: LIVE_V2_PROMPT_ASSET,
      tone: LIVE_V2_TONE_ASSET,
      facts: {
        version: LIVE_V2_FACTS_VERSION,
        facts: TEST_LIVE_V2_FACTS.facts.map((fact) => ({
          id: fact.id,
          category: fact.category,
          allowedCustomerWording: fact.allowedCustomerWording,
          forbiddenExtrapolations: fact.forbiddenExtrapolations
        }))
      }
    });
    expect(generatorInput.assets.prompt.version).toBe(LIVE_V2_PROMPT_VERSION);
    expect(generatorInput.assets.tone.version).toBe(LIVE_V2_TONE_VERSION);
    expect(generatorInput.assets.facts.version).toBe(LIVE_V2_FACTS_VERSION);
    expect(JSON.stringify(generatorInput.assets.facts)).not.toContain("blobSha");
    expect(JSON.stringify(generatorInput.assets.facts)).not.toContain("ownerApproved");
  });

  it("blocks before generation when the incoming context is too long and gate is closed", async () => {
    const generateDecision = vi.fn(async () => answerCandidate());
    const turnInput = buildLiveV2TestTurn({
      inbound: "a".repeat(6001),
      gate: {
        aiState: "manager_active",
        agentAllowedToReply: false
      }
    });
    const gateReader = buildLiveV2TestGateReader(turnInput);

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "blocked_before_generation",
      turnView: null,
      validation: null,
      plan: {
        kind: "blocked",
        reason: "gate_closed"
      }
    });
    expect(generateDecision).not.toHaveBeenCalled();
    expect(gateReader.readGate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "manager state",
      aiState: "manager_active" as const,
      agentAllowedToReply: true
    },
    {
      name: "takeover gate",
      aiState: "ai_collecting_info" as const,
      agentAllowedToReply: false
    }
  ])("blocks before generation for $name", async ({ aiState, agentAllowedToReply }) => {
    const turnInput = buildLiveV2TestTurn({
      gate: { aiState, agentAllowedToReply }
    });
    const generateDecision = vi.fn(async () => answerCandidate());
    const gateReader = buildLiveV2TestGateReader(turnInput);

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "blocked_before_generation",
      validation: null,
      plan: {
        kind: "blocked",
        reason: "gate_closed"
      }
    });
    expect(generateDecision).not.toHaveBeenCalled();
    expect(gateReader.readGate).not.toHaveBeenCalled();
  });

  it("reads a fresh manager_active gate after a valid generated answer and returns evaluated gate_closed", async () => {
    const turnInput = buildLiveV2TestTurn({
      inbound: "Нужен спокойный вариант",
      gate: {
        aiState: "ai_collecting_info",
        agentAllowedToReply: true
      }
    });
    const generateDecision = vi.fn(async () => answerCandidate());
    const gateReader = buildLiveV2TestGateReader(turnInput, {
      aiState: "manager_active",
      agentAllowedToReply: false
    });

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "evaluated",
      validation: { ok: true, decision: { action: "answer" } },
      plan: {
        kind: "blocked",
        reason: "gate_closed"
      }
    });
    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(gateReader.readGate).toHaveBeenCalledTimes(1);
    expect(outcome.turnView?.gate).toEqual({
      aiState: "manager_active",
      agentAllowedToReply: false
    });
  });

  it("maps gate-reader failure after valid generation to gate_unavailable no_reply", async () => {
    const turnInput = buildLiveV2TestTurn({
      inbound: "Нужен спокойный вариант"
    });
    const generateDecision = vi.fn(async () => answerCandidate());
    const gateReader = buildLiveV2TestGateReader(turnInput);
    gateReader.readGate.mockRejectedValue(new Error("synthetic gate-reader outage"));

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "gate_unavailable",
      validation: { ok: true, decision: { action: "answer" } },
      plan: {
        kind: "no_reply",
        reason: "gate_unavailable"
      }
    });
    expect(generateDecision).toHaveBeenCalledTimes(1);
    expect(gateReader.readGate).toHaveBeenCalledTimes(1);
  });

  it("returns context_invalid and skips generator and gate reader for 6001-char inbound", async () => {
    const turnInput = buildLiveV2TestTurn({
      inbound: "a".repeat(6001),
      gate: {
        aiState: "ai_collecting_info",
        agentAllowedToReply: true
      }
    });
    const generateDecision = vi.fn(async () => answerCandidate());
    const gateReader = buildLiveV2TestGateReader(turnInput);

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader
    });

    expect(outcome).toMatchObject({
      status: "context_invalid",
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "context_invalid"
      }
    });
    expect(generateDecision).not.toHaveBeenCalled();
    expect(gateReader.readGate).not.toHaveBeenCalled();
  });

  it("blocks an invalid generated candidate before any apply step", async () => {
    const generateDecision = vi.fn(async () => ({
      action: "answer",
      replyDraft: "candidate without the required envelope"
    }));
    const turnInput = buildLiveV2TestTurn();

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader: buildLiveV2TestGateReader(turnInput)
    });

    expect(outcome).toMatchObject({
      status: "evaluated",
      validation: {
        ok: false,
        code: "invalid_shape"
      },
      plan: {
        kind: "blocked",
        reason: "candidate_invalid",
        validationCode: "invalid_shape"
      }
    });
    expect(generateDecision).toHaveBeenCalledTimes(1);
  });

  it("maps a generator failure to controlled no_reply", async () => {
    const generateDecision = vi.fn(async () => {
      throw new Error("synthetic generator failure");
    });
    const turnInput = buildLiveV2TestTurn();

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader: buildLiveV2TestGateReader(turnInput)
    });

    expect(outcome).toMatchObject({
      status: "generator_failed",
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "generator_failed"
      }
    });
    expect(generateDecision).toHaveBeenCalledTimes(1);
  });

  it("fails closed before generation when the facts asset is not owner-approved", async () => {
    const generateDecision = vi.fn(async () => answerCandidate());
    const invalidFacts = structuredClone(TEST_LIVE_V2_FACTS) as any;
    invalidFacts.facts[0].ownerApproved = false;
    const turnInput = buildLiveV2TestTurn();

    const outcome = await executeLiveV2Turn({
      turnInput,
      approvedFacts: invalidFacts,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: { generateDecision },
      gateReader: buildLiveV2TestGateReader(turnInput)
    });

    expect(outcome).toEqual({
      status: "assets_invalid",
      turnView: buildLiveV2TurnView(turnInput),
      validation: null,
      plan: {
        kind: "no_reply",
        reason: "assets_invalid"
      }
    });
    expect(generateDecision).not.toHaveBeenCalled();
  });
});
