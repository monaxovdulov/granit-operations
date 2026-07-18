import {
  WIDGET_AI_VERIFICATION_JSON_SCHEMA,
  WidgetAiVerificationSchema,
  type WidgetAiSemanticVerifier,
  type WidgetAiVerifierInput,
  type WidgetAiVerifierResult
} from "../verification/widget-ai-semantic-verifier.js";
import { requestOpenAiStructuredResponse } from "./openai-structured-response-client.js";

export type OpenAiWidgetSemanticVerifierOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiWidgetSemanticVerifier implements WidgetAiSemanticVerifier {
  constructor(private readonly options: OpenAiWidgetSemanticVerifierOptions) {}

  async verify(
    input: WidgetAiVerifierInput,
    signal?: AbortSignal
  ): Promise<WidgetAiVerifierResult> {
    const response = await requestOpenAiStructuredResponse({
      apiKey: this.options.apiKey,
      model: this.options.model,
      timeoutMs: this.options.timeoutMs ?? 6000,
      instructions: input.instructions,
      input: input.userInput,
      formatName: "granit_widget_ai_verification",
      schema: WIDGET_AI_VERIFICATION_JSON_SCHEMA,
      metadata: {
        channel: "site_widget",
        role: "semantic_verifier"
      },
      maxOutputTokens: 1600,
      signal
    });

    return {
      verification: WidgetAiVerificationSchema.parse(JSON.parse(response.outputText)),
      modelProvider: "openai",
      modelName: response.model,
      responseId: response.id,
      usage: response.usage
    };
  }
}
