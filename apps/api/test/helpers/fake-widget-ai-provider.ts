import type {
  WidgetAiProvider,
  WidgetAiProviderInput,
  WidgetAiProviderResult
} from "../../src/services/widget-ai-service.js";

export class FakeWidgetAiProvider implements WidgetAiProvider {
  readonly providerKind = "fake" as const;

  constructor(
    private readonly options: {
      text?: string;
      fail?: boolean;
      onGenerate?: (input: WidgetAiProviderInput) => void | Promise<void>;
    }
  ) {}

  async generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult> {
    await this.options.onGenerate?.(input);

    if (this.options.fail) {
      throw new Error("fake model failure");
    }

    return {
      text: this.options.text ?? "Могу помочь собрать детали заявки.",
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
