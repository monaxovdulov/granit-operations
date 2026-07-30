import type {
  WidgetAiProvider,
  WidgetAiProviderInput,
  WidgetAiProviderResult
} from "../../src/services/widget-ai-service.js";
import type { AiTurnCandidateDecision } from "../../src/modules/ai/ai-dialog-contract.js";

export class FakeWidgetAiProvider implements WidgetAiProvider {
  readonly providerKind = "fake" as const;

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

    const decision = this.options.decisions?.shift() ?? this.options.decision;

    return {
      text: this.options.text ?? decision?.replyText ?? "Могу помочь собрать детали заявки.",
      modelProvider: "fake",
      modelName: "fake-widget-ai",
      responseId: "resp_fake",
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18
      },
      decision
    };
  }
}
