import { describe, expect, it } from "vitest";

import {
  GROUNDED_AI_TURN_DECISION_VERSION,
  type GroundedAiTurnCandidateDecision
} from "../src/modules/ai/ai-dialog-contract.js";
import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import { EmptyCatalogKnowledgeProvider } from "../src/modules/ai/catalog/empty-catalog-knowledge-provider.js";
import { validateGroundedAiDecision } from "../src/modules/ai/grounding/ai-decision-validator.js";
import { validateTextEvidence } from "../src/modules/ai/grounding/ai-slot-evidence-service.js";
import { buildGroundedWidgetAiInstructions } from "../src/modules/ai/prompts/widget-ai-prompt.js";
import {
  GroundedWidgetAiService,
  type GroundedWidgetAiProvider,
  type GroundedWidgetAiProviderInput,
  type GroundedWidgetAiProviderResult
} from "../src/modules/ai/services/grounded-widget-ai-service.js";
import {
  buildWidgetAiVerifierInstructions,
  normalizeWidgetAiVerificationSpans,
  WIDGET_AI_VERIFIER_VERSION,
  type WidgetAiSemanticVerifier,
  type WidgetAiVerification,
  type WidgetAiVerifierInput,
  type WidgetAiVerifierResult
} from "../src/modules/ai/verification/widget-ai-semantic-verifier.js";
import { validateWidgetAiVerification } from "../src/modules/ai/verification/widget-ai-verification-validator.js";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("grounded widget AI core", () => {
  it("does not instruct the model to extract catalog names or questions as fixed slots", () => {
    const instructions = buildGroundedWidgetAiInstructions();

    expect(instructions).toContain("Не извлекай fixed slots из вопроса клиента");
    expect(instructions).toContain("monumentType означает только тип композиции");
    expect(instructions).toContain("никогда не возвращай приблизительные offsets");
    expect(instructions).toContain("Не копируй длинные таблицы целиком");
  });

  it("gives the verifier an exact deep-link and missing-commercial-fact contract", () => {
    const instructions = buildWidgetAiVerifierInstructions();

    expect(instructions).toContain("path=/frontend/url");
    expect(instructions).toContain("никогда не используй path=frontend.url");
    expect(instructions).toContain("systemPolicyId=widget.missing_knowledge");
    expect(instructions).toContain("Не помечай такую фразу unsupported_claim");
  });

  it("anchors verifier claims to one exact reply occurrence", () => {
    const result = normalizeWidgetAiVerificationSpans(
      {
        ...verification("pass", "answer"),
        factualClaimsPresent: true,
        claimVerdicts: [
          {
            text: "Памятник «Арфа»",
            start: 0,
            end: 15,
            kind: "catalog",
            supported: true,
            catalogReference: {
              recordId: "ent_1395cd250bbce644514c7e44",
              revision: 1,
              path: "/title",
              catalogVersion: "catalog.v1"
            },
            messageEvidence: null,
            systemPolicyId: null,
            detail: null
          }
        ]
      },
      "Вот Памятник «Арфа» в каталоге."
    );

    expect(result.claimVerdicts[0]).toMatchObject({ start: 4, end: 19 });
  });

  it("does not guess a claim span when the same text is repeated", () => {
    const original = {
      ...verification("pass", "answer"),
      factualClaimsPresent: true,
      claimVerdicts: [
        {
          text: "Арфа",
          start: 1,
          end: 5,
          kind: "catalog" as const,
          supported: true,
          catalogReference: {
            recordId: "ent_1395cd250bbce644514c7e44",
            revision: 1,
            path: "/title",
            catalogVersion: "catalog.v1"
          },
          messageEvidence: null,
          systemPolicyId: null,
          detail: null
        }
      ]
    };

    expect(normalizeWidgetAiVerificationSpans(original, "Арфа и Арфа"))
      .toEqual(original);
  });

  it("uses an explicit empty catalog without inventing temporary facts", async () => {
    const catalog = new EmptyCatalogKnowledgeProvider();
    const snapshot = await catalog.getSnapshot();

    expect(snapshot).toMatchObject({
      catalogVersion: "empty.v1",
      records: []
    });
    await expect(
      catalog.search(snapshot, {
        query: "двойной памятник",
        at: "2026-07-17T10:00:00.000Z",
        limit: 12
      })
    ).resolves.toEqual([]);
  });

  it("links a slot value to the exact visitor evidence", () => {
    const input = turn("Нужен двойной памятник");
    const decision = decisionWithSlot();

    expect(validateGroundedAiDecision(decision, input)).toEqual({
      valid: true,
      decision
    });

    const invalidOffset = structuredClone(decision);
    invalidOffset.extractedSlots[0]!.evidence.start = 7;
    expect(validateGroundedAiDecision(invalidOffset, input)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["invalid_slot_evidence"])
    });

    const contradictoryValue = structuredClone(decision);
    contradictoryValue.extractedSlots[0]!.value = "одинарный";
    expect(validateGroundedAiDecision(contradictoryValue, input)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["invalid_slot_evidence"])
    });

    const normalizedSynonym = structuredClone(decision);
    normalizedSynonym.extractedSlots[0]!.value = "двухместный";
    expect(validateGroundedAiDecision(normalizedSynonym, input)).toEqual({
      valid: true,
      decision: normalizedSynonym
    });
  });

  it("keeps persisted exact evidence valid after its source message leaves recent context", () => {
    const input = turn("Продолжим выбирать детали");
    const oldEvidence = {
      messageId: "33333333-3333-4333-8333-333333333333",
      quote: "строгий стиль",
      start: 6,
      end: 19
    };
    input.knownRequirements = [
      {
        category: "style",
        mode: "preference",
        value: "строгий стиль",
        source: "ai_extraction",
        sourceMessageId: oldEvidence.messageId,
        evidence: oldEvidence,
        confidence: 0.96,
        updatedAt: "2026-07-17T09:00:00.000Z"
      }
    ];
    input.knownSlots.values.material = {
      value: "чёрный гранит",
      source: "ai_extraction",
      sourceMessageId: "44444444-4444-4444-8444-444444444444",
      evidence: {
        messageId: "44444444-4444-4444-8444-444444444444",
        quote: "чёрный гранит",
        start: 5,
        end: 18
      },
      confidence: 0.99,
      updatedAt: "2026-07-17T09:01:00.000Z"
    };

    expect(validateTextEvidence(oldEvidence, input)).toBeNull();
    expect(validateTextEvidence(input.knownSlots.values.material.evidence!, input)).toBeNull();
  });

  it("rejects a verifier catalog claim when no selected record supports it", async () => {
    const input = turn("Что вы производите?");
    const snapshot = await new EmptyCatalogKnowledgeProvider().getSnapshot();
    const decision = answerDecision("У нас собственное производство.");
    const result = validateWidgetAiVerification({
      turn: input,
      decision,
      snapshot,
      selectedRecords: [],
      verification: verification("pass", "answer", {
        claimVerdicts: [
          {
            text: decision.replyText,
            start: 0,
            end: decision.replyText.length,
            kind: "catalog",
            supported: true,
            catalogReference: {
              recordId: "business.production",
              revision: 1,
              path: "/statement",
              catalogVersion: snapshot.catalogVersion
            },
            messageEvidence: null,
            systemPolicyId: null,
            detail: null
          }
        ]
      })
    });

    expect(result).toEqual(expect.arrayContaining(["invalid_catalog_reference"]));
  });

  it("rejects a reference to an expired published catalog record", async () => {
    const input = turn("Какая действует цена?");
    const empty = await new EmptyCatalogKnowledgeProvider().getSnapshot();
    const snapshot = {
      ...empty,
      catalogVersion: "catalog.test.v1",
      contentHash: "b".repeat(64),
      records: [
        {
          id: "price.monument.base",
          revision: 1,
          kind: "price" as const,
          status: "published" as const,
          catalogVersion: "catalog.test.v1",
          contentHash: "c".repeat(64),
          validUntil: "2026-07-16T23:59:59.000Z",
          aliases: [],
          searchText: "цена памятника",
          qualifiers: {},
          provenance: { source: "test" },
          frontend: null,
          data: { amount: 100000 }
        }
      ]
    };
    const decision = answerDecision("Цена — 100 000 рублей.");
    const result = validateWidgetAiVerification({
      turn: input,
      decision,
      snapshot,
      selectedRecords: snapshot.records,
      verification: verification("pass", "answer", {
        claimVerdicts: [
          {
            text: decision.replyText,
            start: 0,
            end: decision.replyText.length,
            kind: "catalog",
            supported: true,
            catalogReference: {
              recordId: "price.monument.base",
              revision: 1,
              path: "/amount",
              catalogVersion: snapshot.catalogVersion
            },
            messageEvidence: null,
            systemPolicyId: null,
            detail: null
          }
        ]
      })
    });

    expect(result).toEqual(expect.arrayContaining(["invalid_catalog_reference"]));
  });

  it("keeps natural wording when verifier proves full coverage", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Можно связать оформление в единую композицию. Какой стиль вам ближе?")
    ]);
    const verifier = new FakeVerifier([verification("pass", "clarify")]);
    const result = await new GroundedWidgetAiService({ provider, verifier }).generateReply(
      turn("Можно связать оформление памятника с документами на участок?")
    );

    expect(result).toMatchObject({
      decision: "reply_candidate",
      action: "clarify",
      metadata: {
        grounding_verified: true,
        claim_coverage_complete: true,
        verifier_verdict: "pass"
      }
    });
  });

  it("does not send an unsupported draft even when the generator has no claim field", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Мы всегда используем только карельский гранит.")
    ]);
    const verifier = new FakeVerifier([
      verification("block", null, { violations: ["unsupported_claim"] })
    ]);
    const result = await new GroundedWidgetAiService({ provider, verifier }).generateReply(
      turn("Какой гранит вы используете?")
    );

    expect(result).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });
  });

  it("fails closed when a pass verdict omits complete factual coverage", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Мы всегда используем только карельский гранит.")
    ]);
    const incomplete = verification("pass", "clarify");
    incomplete.claimCoverageComplete = false;
    const result = await new GroundedWidgetAiService({
      provider,
      verifier: new FakeVerifier([incomplete])
    }).generateReply(turn("Какой гранит вы используете?"));

    expect(result).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });
  });

  it("requires exactly one matching slot verdict for every extracted slot", async () => {
    const missingCoverage = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decisionWithSlot()]),
      verifier: new FakeVerifier([verification("pass", "clarify")])
    }).generateReply(turn("Нужен двойной памятник"));

    expect(missingCoverage).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });

    const decision = decisionWithSlot();
    const duplicateVerdict = slotVerdict(decision.extractedSlots[0]!);
    const duplicateCoverage = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decision]),
      verifier: new FakeVerifier([
        verification("pass", "clarify", {
          slotVerdicts: [duplicateVerdict, duplicateVerdict]
        })
      ])
    }).generateReply(turn("Нужен двойной памятник"));

    expect(duplicateCoverage).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });

    const covered = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decision]),
      verifier: new FakeVerifier([
        verification("pass", "clarify", {
          slotVerdicts: [slotVerdict(decision.extractedSlots[0]!)]
        })
      ])
    }).generateReply(turn("Нужен двойной памятник"));

    expect(covered).toMatchObject({
      decision: "reply_candidate",
      slotUpdates: [{ name: "monumentType", value: "двойной" }]
    });
  });

  it("requires verifier coverage for flexible requirements", async () => {
    const decision = baseDecision("Понял, вам ближе строгий стиль. Какой размер нужен?");
    decision.extractedRequirements = [
      {
        category: "style",
        mode: "preference",
        value: "строгий стиль",
        confidence: 0.95,
        evidence: {
          messageId: MESSAGE_ID,
          quote: "строгий стиль",
          start: 5,
          end: 18
        }
      }
    ];
    const result = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decision]),
      verifier: new FakeVerifier([verification("pass", "clarify")])
    }).generateReply(turn("Хочу строгий стиль"));

    expect(result).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });

    const covered = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decision]),
      verifier: new FakeVerifier([
        verification("pass", "clarify", {
          requirementVerdicts: [requirementVerdict(decision.extractedRequirements[0]!)]
        })
      ])
    }).generateReply(turn("Хочу строгий стиль"));

    expect(covered).toMatchObject({
      decision: "reply_candidate",
      requirementUpdates: [
        { category: "style", mode: "preference", value: "строгий стиль" }
      ]
    });

    const mismatchedVerdict = requirementVerdict(decision.extractedRequirements[0]!);
    mismatchedVerdict.value = "классический стиль";
    const rejectedMismatch = await new GroundedWidgetAiService({
      provider: new FakeGroundedProvider([decision]),
      verifier: new FakeVerifier([
        verification("pass", "clarify", {
          requirementVerdicts: [mismatchedVerdict]
        })
      ])
    }).generateReply(turn("Хочу строгий стиль"));

    expect(rejectedMismatch).toMatchObject({
      decision: "no_reply",
      reason: "grounding_validation_failed"
    });
  });

  it("repairs once and sends only the second verified decision", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Точная цена 100 000 рублей."),
      baseDecision("Точную стоимость подтвердит менеджер. Какой материал рассматриваете?")
    ]);
    const verifier = new FakeVerifier([
      verification("repair", "clarify", { violations: ["commercial_promise"] }),
      verification("pass", "clarify")
    ]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier,
      minimumRepairBudgetMs: 0
    }).generateReply(turn("Сколько стоит памятник?"));

    expect(result).toMatchObject({
      decision: "reply_candidate",
      text: "Точную стоимость подтвердит менеджер. Какой материал рассматриваете?",
      metadata: {
        repair_applied: true,
        grounding_verified: true
      }
    });
    expect(provider.attempts).toEqual(["initial", "repair"]);
  });

  it("hands off immediately with an app-owned reply and skips repair", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Продолжим консультацию. Какой материал нужен?"),
      baseDecision("Этот draft не должен запрашиваться.")
    ]);
    const verifier = new FakeVerifier([
      verification("handoff", "handoff", { violations: ["missed_manager_request"] })
    ]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier,
      minimumRepairBudgetMs: 0
    }).generateReply(turn("Позовите, пожалуйста, менеджера"));

    expect(result).toMatchObject({
      decision: "reply_candidate",
      action: "handoff",
      handoffReason: "manager_requested",
      agentAllowedToReplyAfterSend: false,
      metadata: {
        safe_handoff_reply: true,
        grounding_verified: true
      }
    });
    expect(provider.attempts).toEqual(["initial"]);
  });

  it("honors a new handoff verdict returned after the single repair", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Я попробую назвать точный срок."),
      baseDecision("Продолжим уточнять заказ.")
    ]);
    const verifier = new FakeVerifier([
      verification("repair", "clarify", { violations: ["commercial_promise"] }),
      verification("handoff", "handoff", { violations: ["commercial_promise"] })
    ]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier,
      minimumRepairBudgetMs: 0
    }).generateReply(turn("Гарантируете установку к пятнице?"));

    expect(result).toMatchObject({
      decision: "reply_candidate",
      action: "handoff",
      handoffReason: "binding_terms",
      metadata: { repair_applied: true, safe_handoff_reply: true }
    });
    expect(provider.attempts).toEqual(["initial", "repair"]);
  });
});

class FakeGroundedProvider implements GroundedWidgetAiProvider {
  readonly attempts: Array<"initial" | "repair"> = [];

  constructor(private readonly decisions: GroundedAiTurnCandidateDecision[]) {}

  async generateGroundedReply(
    input: GroundedWidgetAiProviderInput
  ): Promise<GroundedWidgetAiProviderResult> {
    this.attempts.push(input.attempt);
    const decision = this.decisions.shift();

    if (!decision) {
      throw new Error("missing fake grounded decision");
    }

    return {
      decision,
      modelProvider: "fake",
      modelName: "fake-grounded-generator"
    };
  }
}

class FakeVerifier implements WidgetAiSemanticVerifier {
  constructor(private readonly verifications: WidgetAiVerification[]) {}

  async verify(_input: WidgetAiVerifierInput): Promise<WidgetAiVerifierResult> {
    const verificationResult = this.verifications.shift();

    if (!verificationResult) {
      throw new Error("missing fake verification");
    }

    return {
      verification: verificationResult,
      modelProvider: "fake",
      modelName: "fake-semantic-verifier"
    };
  }
}

function turn(text: string) {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: CONVERSATION_ID,
    publicMessageId: MESSAGE_ID,
    requestFingerprint: "a".repeat(64),
    submittedAt: "2026-07-17T10:00:00.000Z",
    text,
    page: {
      url: "https://example.test/katalog/",
      widgetInstanceId: "main"
    },
    customer: {
      phoneProvided: false,
      emailProvided: false
    },
    visitor: {},
    gate: {
      aiState: "ai_collecting_info",
      agentAllowedToReply: true
    }
  });
}

function baseDecision(replyText: string): GroundedAiTurnCandidateDecision {
  return {
    version: GROUNDED_AI_TURN_DECISION_VERSION,
    action: "clarify",
    intent: "product_selection",
    replyText,
    extractedSlots: [],
    extractedRequirements: [],
    requestedSlots: ["material"],
    riskFlags: [],
    handoffReason: null,
    confidence: 0.9
  };
}

function answerDecision(replyText: string): GroundedAiTurnCandidateDecision {
  return {
    ...baseDecision(replyText),
    action: "answer",
    requestedSlots: []
  };
}

function decisionWithSlot(): GroundedAiTurnCandidateDecision {
  const decision = baseDecision("Понял: двойной памятник. Какой размер рассматриваете?");
  decision.requestedSlots = ["size"];
  decision.extractedSlots = [
    {
      name: "monumentType",
      value: "двойной",
      confidence: 0.99,
      evidence: {
        messageId: MESSAGE_ID,
        quote: "двойной памятник",
        start: 6,
        end: 22
      }
    }
  ];
  return decision;
}

function slotVerdict(
  slot: GroundedAiTurnCandidateDecision["extractedSlots"][number]
): WidgetAiVerification["slotVerdicts"][number] {
  return {
    name: slot.name,
    value: slot.value,
    evidence: slot.evidence,
    valueSupportedByEvidence: true,
    valid: true,
    detail: null
  };
}

function requirementVerdict(
  requirement: GroundedAiTurnCandidateDecision["extractedRequirements"][number]
): WidgetAiVerification["requirementVerdicts"][number] {
  return {
    category: requirement.category,
    mode: requirement.mode,
    value: requirement.value,
    evidence: requirement.evidence,
    valueSupportedByEvidence: true,
    valid: true,
    detail: null
  };
}

function verification(
  verdict: WidgetAiVerification["verdict"],
  requiredAction: WidgetAiVerification["requiredAction"],
  options: {
    violations?: Array<WidgetAiVerification["violations"][number]["code"]>;
    claimVerdicts?: WidgetAiVerification["claimVerdicts"];
    slotVerdicts?: WidgetAiVerification["slotVerdicts"];
    requirementVerdicts?: WidgetAiVerification["requirementVerdicts"];
  } = {}
): WidgetAiVerification {
  const claimVerdicts = options.claimVerdicts ?? [];
  return {
    version: WIDGET_AI_VERIFIER_VERSION,
    verdict,
    requiredAction,
    violations: (options.violations ?? []).map((code) => ({
      code,
      detail: code,
      claimStart: null,
      claimEnd: null
    })),
    factualClaimsPresent: claimVerdicts.length > 0,
    claimCoverageComplete: true,
    claimVerdicts,
    slotVerdicts: options.slotVerdicts ?? [],
    requirementVerdicts: options.requirementVerdicts ?? [],
    confidence: 0.97
  };
}
