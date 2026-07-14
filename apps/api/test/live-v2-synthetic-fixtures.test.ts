import { describe, expect, it } from "vitest";

import type { LiveV2ApplyPlan } from "../src/modules/ai/profiles/live-v2/live-v2-apply-plan.js";
import type {
  LiveV2Candidate,
  LiveV2ValidationFailureCode,
  LiveV2ValidationResult
} from "../src/modules/ai/profiles/live-v2/live-v2-contract.js";
import {
  executeLiveV2Turn,
  type LiveV2TurnOutcome
} from "../src/modules/ai/profiles/live-v2/live-v2-orchestrator.js";
import {
  TEST_LIVE_V2_AS_OF_DATE,
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  buildLiveV2TestTurn,
  buildLiveV2TestGateReader,
  clarifyingCandidate,
  contextMessage,
  handoffCandidate,
  noReplyCandidate
} from "./fixtures/live-v2-synthetic.v1.js";

type FixtureCase = {
  id: string;
  name: string;
  turnInput: ReturnType<typeof buildLiveV2TestTurn>;
  candidate: LiveV2Candidate;
  expectedStatus: LiveV2TurnOutcome["status"];
  expectedValidation: LiveV2ValidationResult | null;
  expectedPlan: LiveV2ApplyPlan;
  expectedGeneratorCalls: 0 | 1;
};

type ExpectedOutcome = Pick<
  FixtureCase,
  "expectedStatus" | "expectedValidation" | "expectedPlan" | "expectedGeneratorCalls"
>;

const continuationCandidate = answerCandidate({
  replyDraft:
    "Габбро-диабаз указан в каталоге. Какой вариант оформления вам ближе?",
  factIds: ["P1Q-MAT-001"],
  useRecentContext: true
});
const typoParaphraseCandidate = answerCandidate({
  replyDraft:
    "В каталоге представлены горизонтальные памятники — широкие стелы для семейных надписей и двух портретов.",
  factIds: ["P1Q-TYPE-002"]
});
const negatedManagerCandidate = answerCandidate({
  replyDraft:
    "В каталоге представлены вертикальные памятники. Какой вариант оформления вам ближе?",
  managerRequest: "negated"
});
const explicitManagerCandidate = handoffCandidate();
const mixedExplicitHandoffCandidate = handoffCandidate({
  managerRequest: "explicit",
  mixedIntent: true
});
const safeGeneralChoiceCandidate = answerCandidate({
  replyDraft:
    "В каталоге представлены вертикальные и горизонтальные памятники. Какой формат вам ближе?",
  factIds: ["P1Q-TYPE-001", "P1Q-TYPE-002"]
});
const missingApprovedFactCandidate = noReplyCandidate("missing_approved_fact");
const unknownSourceCandidate = answerCandidate({
  replyDraft: "В каталоге представлен подходящий вариант.",
  factIds: ["P1Q-TYPE-999"]
});
const factBasisWithoutSourceCandidate = answerCandidate({
  replyDraft: "В каталоге представлен подходящий вариант.",
  factIds: []
});
factBasisWithoutSourceCandidate.evidence.basis.push("approved_facts");
const priceCandidate = answerCandidate({
  replyDraft: "Цена составит 120 000 руб.",
  factIds: []
});
const deadlineCandidate = answerCandidate({
  replyDraft: "Изготовим за 14 дней.",
  factIds: []
});
const guaranteeContractCandidate = answerCandidate({
  replyDraft: "Предоставим гарантию и заключим договор.",
  factIds: []
});
const legalAdviceCandidate = answerCandidate({
  replyDraft: "По закону вам нужно оформить захоронение именно так.",
  factIds: []
});
const takeoverCandidate = answerCandidate();
const oneUsefulSlotCandidate = clarifyingCandidate({
  slot: "material",
  replyDraft: "Какой материал вы рассматриваете?"
});
const knownCityCandidate = clarifyingCandidate({
  slot: "city",
  replyDraft: "В каком городе нужен монтаж?"
});
const questionnaireCandidate = clarifyingCandidate({
  slot: "material",
  replyDraft: "Какой материал? Какое оформление?"
});
const repeatedAiReplyCandidate = answerCandidate({
  replyDraft: "В каталоге представлены вертикальные памятники."
});

// These fixed cases never invoke a model. They prove only deterministic handling of
// predefined candidates, not model understanding, typo interpretation or naturalness.
const SYNTHETIC_CASES: readonly FixtureCase[] = [
  {
    id: "LV2-SYN-001",
    name: "continuation advances without repeating the previous AI question",
    turnInput: buildLiveV2TestTurn({
      inbound: "Да, давайте из габбро-диабаза",
      previousMessagesNewestFirst: [
        contextMessage({
          id: 1,
          role: "assistant",
          text: "Какой материал вы рассматриваете?"
        })
      ]
    }),
    candidate: continuationCandidate,
    ...acceptedReply(continuationCandidate)
  },
  {
    id: "LV2-SYN-002",
    name: "predefined paraphrase is accepted beside a typo in the inbound text",
    turnInput: buildLiveV2TestTurn({ inbound: "Нужен гаризантальный памятник" }),
    candidate: typoParaphraseCandidate,
    ...acceptedReply(typoParaphraseCandidate)
  },
  {
    id: "LV2-SYN-003",
    name: "negated manager request remains an answer",
    turnInput: buildLiveV2TestTurn({ inbound: "Менеджер пока не нужен" }),
    candidate: negatedManagerCandidate,
    ...acceptedReply(negatedManagerCandidate)
  },
  {
    id: "LV2-SYN-004",
    name: "explicit manager request becomes a handoff",
    turnInput: buildLiveV2TestTurn({ inbound: "Позовите менеджера" }),
    candidate: explicitManagerCandidate,
    ...acceptedHandoff(explicitManagerCandidate)
  },
  {
    id: "LV2-SYN-005",
    name: "mixed intent with an explicit manager request still hands off",
    turnInput: buildLiveV2TestTurn({
      inbound: "Покажите вертикальный памятник и позовите менеджера"
    }),
    candidate: mixedExplicitHandoffCandidate,
    ...acceptedHandoff(mixedExplicitHandoffCandidate)
  },
  {
    id: "LV2-SYN-006",
    name: "safe general choice cites approved product sources",
    turnInput: buildLiveV2TestTurn({ inbound: "Какие варианты бывают?" }),
    candidate: safeGeneralChoiceCandidate,
    ...acceptedReply(safeGeneralChoiceCandidate)
  },
  {
    id: "LV2-SYN-007",
    name: "missing approved fact produces a valid no-reply plan",
    turnInput: buildLiveV2TestTurn({ inbound: "Сколько стоит памятник?" }),
    candidate: missingApprovedFactCandidate,
    ...acceptedNoReply(missingApprovedFactCandidate)
  },
  {
    id: "LV2-SYN-008",
    name: "unknown fact source is rejected",
    turnInput: buildLiveV2TestTurn(),
    candidate: unknownSourceCandidate,
    ...rejected("unknown_fact_id")
  },
  {
    id: "LV2-SYN-009",
    name: "approved-fact basis without a source ID is rejected",
    turnInput: buildLiveV2TestTurn(),
    candidate: factBasisWithoutSourceCandidate,
    ...rejected("fact_evidence_mismatch")
  },
  {
    id: "LV2-SYN-010",
    name: "price claim is rejected",
    turnInput: buildLiveV2TestTurn({ inbound: "Сколько стоит?" }),
    candidate: priceCandidate,
    ...rejected("unsafe_claim")
  },
  {
    id: "LV2-SYN-011",
    name: "deadline promise is rejected",
    turnInput: buildLiveV2TestTurn({ inbound: "Когда будет готово?" }),
    candidate: deadlineCandidate,
    ...rejected("unsafe_claim")
  },
  {
    id: "LV2-SYN-012",
    name: "guarantee and contract promise is rejected",
    turnInput: buildLiveV2TestTurn({ inbound: "Какие гарантии?" }),
    candidate: guaranteeContractCandidate,
    ...rejected("unsafe_claim")
  },
  {
    id: "LV2-SYN-013",
    name: "legal advice is rejected",
    turnInput: buildLiveV2TestTurn({ inbound: "Как оформить документы?" }),
    candidate: legalAdviceCandidate,
    ...rejected("unsafe_claim")
  },
  {
    id: "LV2-SYN-014",
    name: "manager takeover blocks before generation",
    turnInput: buildLiveV2TestTurn({
      gate: { aiState: "manager_active", agentAllowedToReply: false }
    }),
    candidate: takeoverCandidate,
    ...blockedBeforeGeneration()
  },
  {
    id: "LV2-SYN-015",
    name: "one useful missing slot is accepted",
    turnInput: buildLiveV2TestTurn({ inbound: "Нужен памятник" }),
    candidate: oneUsefulSlotCandidate,
    ...acceptedReply(oneUsefulSlotCandidate)
  },
  {
    id: "LV2-SYN-016",
    name: "known city is not requested again",
    turnInput: buildLiveV2TestTurn({ city: "Москва" }),
    candidate: knownCityCandidate,
    ...rejected("known_slot_requested")
  },
  {
    id: "LV2-SYN-017",
    name: "two-question questionnaire is rejected",
    turnInput: buildLiveV2TestTurn(),
    candidate: questionnaireCandidate,
    ...rejected("question_limit_exceeded")
  },
  {
    id: "LV2-SYN-018",
    name: "exact repeated AI reply is rejected",
    turnInput: buildLiveV2TestTurn({
      inbound: "А что дальше?",
      previousMessagesNewestFirst: [
        contextMessage({
          id: 1,
          role: "assistant",
          text: "В каталоге представлены вертикальные памятники."
        })
      ]
    }),
    candidate: repeatedAiReplyCandidate,
    ...rejected("repeated_reply")
  }
];

describe(
  "live_v2 deterministic handling of 18 predefined candidates, not model understanding or naturalness",
  () => {
    it("keeps the acceptance corpus fixed at exactly 18 cases", () => {
      expect(SYNTHETIC_CASES).toHaveLength(18);
      expect(new Set(SYNTHETIC_CASES.map((fixture) => fixture.id)).size).toBe(18);
    });

    it.each(SYNTHETIC_CASES)("$id: $name", async (fixture) => {
      let generatorCalls = 0;
      const gateReader = buildLiveV2TestGateReader(fixture.turnInput);

      const outcome = await executeLiveV2Turn({
      turnInput: fixture.turnInput,
      approvedFacts: TEST_LIVE_V2_FACTS,
      factsAsOfDate: TEST_LIVE_V2_AS_OF_DATE,
      generator: {
          async generateDecision() {
            generatorCalls += 1;
            return fixture.candidate;
          }
        },
        gateReader
      });

      expect(generatorCalls).toBe(fixture.expectedGeneratorCalls);
      expect(outcome.status).toBe(fixture.expectedStatus);
      expect(outcome.validation).toEqual(fixture.expectedValidation);
      expect(outcome.plan).toEqual(fixture.expectedPlan);
    });
  }
);

function acceptedReply(
  candidate: Extract<LiveV2Candidate, { action: "answer" | "ask_clarifying_question" }>
): ExpectedOutcome {
  return {
    expectedStatus: "evaluated",
    expectedValidation: { ok: true, decision: candidate },
    expectedPlan: {
      kind: "persist_reply",
      action: candidate.action,
      replyDraft: candidate.replyDraft,
      agentAllowedToReplyAfterSend: undefined,
      decision: candidate
    },
    expectedGeneratorCalls: 1
  };
}

function acceptedHandoff(
  candidate: Extract<LiveV2Candidate, { action: "handoff_to_manager" }>
): ExpectedOutcome {
  return {
    expectedStatus: "evaluated",
    expectedValidation: { ok: true, decision: candidate },
    expectedPlan: {
      kind: "persist_reply",
      action: "handoff_to_manager",
      replyDraft: candidate.replyDraft,
      agentAllowedToReplyAfterSend: false,
      decision: candidate
    },
    expectedGeneratorCalls: 1
  };
}

function acceptedNoReply(
  candidate: Extract<LiveV2Candidate, { action: "no_reply" }>
): ExpectedOutcome {
  return {
    expectedStatus: "evaluated",
    expectedValidation: { ok: true, decision: candidate },
    expectedPlan: { kind: "no_reply", reason: candidate.reason },
    expectedGeneratorCalls: 1
  };
}

function rejected(code: LiveV2ValidationFailureCode): ExpectedOutcome {
  return {
    expectedStatus: "evaluated",
    expectedValidation: { ok: false, code },
    expectedPlan: {
      kind: "blocked",
      reason: "candidate_invalid",
      validationCode: code
    },
    expectedGeneratorCalls: 1
  };
}

function blockedBeforeGeneration(): ExpectedOutcome {
  return {
    expectedStatus: "blocked_before_generation",
    expectedValidation: null,
    expectedPlan: { kind: "blocked", reason: "gate_closed" },
    expectedGeneratorCalls: 0
  };
}
