import { describe, expect, it } from "vitest";

import { EmptyCatalogKnowledgeProvider } from "../src/modules/ai/catalog/empty-catalog-knowledge-provider.js";
import {
  GROUNDED_AI_TURN_DECISION_VERSION,
  type GroundedAiTurnCandidateDecision
} from "../src/modules/ai/ai-dialog-contract.js";
import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import { validateGroundedAiDecision } from "../src/modules/ai/grounding/ai-decision-validator.js";
import {
  GroundedWidgetAiService,
  type GroundedWidgetAiProvider,
  type GroundedWidgetAiProviderInput,
  type GroundedWidgetAiProviderResult
} from "../src/modules/ai/services/grounded-widget-ai-service.js";
import {
  WIDGET_AI_VERIFIER_VERSION,
  type WidgetAiSemanticVerifier,
  type WidgetAiVerification,
  type WidgetAiVerifierInput,
  type WidgetAiVerifierResult
} from "../src/modules/ai/verification/widget-ai-semantic-verifier.js";

const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("grounded widget AI core", () => {
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

  it("accepts a slot only with an exact visitor quote and offsets", async () => {
    const input = turn("Нужен двойной памятник");
    const catalog = new EmptyCatalogKnowledgeProvider();
    const snapshot = await catalog.getSnapshot();
    const decision = decisionWithSlot();

    expect(validateGroundedAiDecision(decision, input, snapshot, [])).toEqual({
      valid: true,
      decision
    });

    const invalid = structuredClone(decision);
    invalid.extractedSlots[0]!.evidence.start = 7;

    expect(validateGroundedAiDecision(invalid, input, snapshot, [])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["invalid_slot_evidence"])
    });
  });

  it("rejects a catalog claim when the empty provider did not return its record", async () => {
    const input = turn("Что вы производите?");
    const catalog = new EmptyCatalogKnowledgeProvider();
    const snapshot = await catalog.getSnapshot();
    const replyText = "У нас собственное производство.";
    const decision: GroundedAiTurnCandidateDecision = {
      ...baseDecision(replyText),
      claims: [
        {
          text: replyText,
          start: 0,
          end: replyText.length,
          grounding: {
            kind: "catalog",
            catalogReference: {
              recordId: "business.production",
              revision: 1,
              path: "/statement",
              catalogVersion: snapshot.catalogVersion
            },
            messageEvidence: null,
            systemPolicyId: null
          }
        }
      ]
    };

    expect(validateGroundedAiDecision(decision, input, snapshot, [])).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["invalid_catalog_reference"])
    });
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
          validUntil: "2026-07-16T23:59:59.000Z",
          aliases: [],
          searchText: "цена памятника",
          qualifiers: {},
          data: { amount: 100000 }
        }
      ]
    };
    const replyText = "Цена — 100 000 рублей.";
    const decision: GroundedAiTurnCandidateDecision = {
      ...baseDecision(replyText),
      claims: [
        {
          text: replyText,
          start: 0,
          end: replyText.length,
          grounding: {
            kind: "catalog",
            catalogReference: {
              recordId: "price.monument.base",
              revision: 1,
              path: "/amount",
              catalogVersion: snapshot.catalogVersion
            },
            messageEvidence: null,
            systemPolicyId: null
          }
        }
      ]
    };

    expect(
      validateGroundedAiDecision(decision, input, snapshot, snapshot.records)
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining(["invalid_catalog_reference"])
    });
  });

  it("keeps natural wording when semantic verifier passes the full context", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Можно связать оформление в единую композицию. Какой стиль вам ближе?")
    ]);
    const verifier = new FakeVerifier([verification("pass", "clarify")]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier
    }).generateReply(turn("Можно связать оформление памятника с документами на участок?"));

    expect(result).toMatchObject({
      decision: "reply_candidate",
      action: "clarify",
      metadata: {
        grounding_verified: true,
        verifier_verdict: "pass"
      }
    });
  });

  it("does not send an unsupported draft even when the generator reports no claims", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Мы всегда используем только карельский гранит.")
    ]);
    const verifier = new FakeVerifier([
      verification("block", null, ["unsupported_claim"])
    ]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier
    }).generateReply(turn("Какой гранит вы используете?"));

    expect(result).toMatchObject({
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
      verification("repair", "clarify", ["commercial_promise"]),
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

  it("uses an app-owned handoff reply when verifier requires a manager", async () => {
    const provider = new FakeGroundedProvider([
      baseDecision("Продолжим консультацию. Какой материал нужен?")
    ]);
    const verifier = new FakeVerifier([
      verification("handoff", "handoff", ["missed_manager_request"])
    ]);
    const result = await new GroundedWidgetAiService({
      provider,
      verifier,
      minimumRepairBudgetMs: 999999
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
    const verification = this.verifications.shift();

    if (!verification) {
      throw new Error("missing fake verification");
    }

    return {
      verification,
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
    requestedSlots: ["material"],
    claims: [],
    riskFlags: [],
    handoffReason: null,
    confidence: 0.9
  };
}

function decisionWithSlot(): GroundedAiTurnCandidateDecision {
  const replyText = "Понял: двойной памятник. Какой размер рассматриваете?";
  return {
    version: GROUNDED_AI_TURN_DECISION_VERSION,
    action: "clarify",
    intent: "product_selection",
    replyText,
    extractedSlots: [
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
    ],
    requestedSlots: ["size"],
    claims: [
      {
        text: "двойной памятник",
        start: 7,
        end: 23,
        grounding: {
          kind: "visitor_message",
          catalogReference: null,
          messageEvidence: {
            messageId: MESSAGE_ID,
            quote: "двойной памятник",
            start: 6,
            end: 22
          },
          systemPolicyId: null
        }
      }
    ],
    riskFlags: [],
    handoffReason: null,
    confidence: 0.95
  };
}

function verification(
  verdict: WidgetAiVerification["verdict"],
  requiredAction: WidgetAiVerification["requiredAction"],
  violations: Array<WidgetAiVerification["violations"][number]["code"]> = []
): WidgetAiVerification {
  return {
    version: WIDGET_AI_VERIFIER_VERSION,
    verdict,
    requiredAction,
    violations: violations.map((code) => ({
      code,
      detail: code,
      claimStart: null,
      claimEnd: null
    })),
    slotVerdicts: [],
    confidence: 0.97
  };
}
