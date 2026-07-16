import type {
  WidgetAiProvider,
  WidgetAiProviderInput,
  WidgetAiProviderResult
} from "../../src/services/widget-ai-service.js";
import {
  AI_TURN_DECISION_VERSION,
  type AiTurnCandidateDecision
} from "../../src/modules/ai/ai-dialog-contract.js";

export class FakeWidgetAiProvider implements WidgetAiProvider {
  private generatedCount = 0;

  constructor(
    private readonly options: {
      text?: string;
      decision?: AiTurnCandidateDecision;
      decisions?: AiTurnCandidateDecision[];
      fail?: boolean;
      onGenerate?: (input: WidgetAiProviderInput) => void | Promise<void>;
    }
  ) {}

  async generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult> {
    await this.options.onGenerate?.(input);

    if (this.options.fail) {
      throw new Error("fake model failure");
    }

    const sequencedDecision = this.options.decisions?.[this.generatedCount];
    this.generatedCount += 1;

    return {
      decision:
        sequencedDecision ??
        this.options.decision ??
        defaultDecision(this.options.text ?? "Могу помочь собрать детали заявки."),
      modelProvider: "fake",
      modelName: "fake-widget-ai",
      responseId: "resp_fake",
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18
      }
    };
  }
}

function defaultDecision(text: string): AiTurnCandidateDecision {
  return {
    version: AI_TURN_DECISION_VERSION,
    action: "answer",
    intent: "general_question",
    replyText: text,
    extractedSlots: [],
    requestedSlots: [],
    riskFlags: [],
    handoffReason: null,
    sourceEvidence: [],
    confidence: 0.9
  };
}
