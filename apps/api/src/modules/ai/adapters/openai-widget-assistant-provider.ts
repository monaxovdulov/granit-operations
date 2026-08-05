import type {
  GroundedWidgetAiProvider,
  GroundedWidgetAiProviderInput,
  GroundedWidgetAiProviderResult
} from "../services/grounded-widget-ai-service.js";
import { GROUNDED_WIDGET_AI_PROMPT_VERSION } from "../prompts/widget-ai-prompt.js";
import {
  GROUNDED_AI_TURN_DECISION_JSON_SCHEMA,
  GroundedAiTurnCandidateDecisionSchema
} from "../ai-dialog-contract.js";
import { requestOpenAiStructuredResponse } from "./openai-structured-response-client.js";
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";

export type OpenAiWidgetAssistantProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiWidgetAssistantProvider implements GroundedWidgetAiProvider {

  constructor(private readonly options: OpenAiWidgetAssistantProviderOptions) {
    if (!isSafeWidgetAiModelName(options.model)) {
      throw new Error("Invalid widget AI model name");
    }
  }

  async generateGroundedReply(
    input: GroundedWidgetAiProviderInput,
    signal?: AbortSignal
  ): Promise<GroundedWidgetAiProviderResult> {
    const response = await requestOpenAiStructuredResponse({
      apiKey: this.options.apiKey,
      model: this.options.model,
      timeoutMs: this.options.timeoutMs ?? 10000,
      instructions: input.instructions,
      input: input.userInput,
      formatName: "granit_grounded_widget_ai_turn_decision",
      schema: GROUNDED_AI_TURN_DECISION_JSON_SCHEMA,
      metadata: {
        channel: "site_widget",
        prompt_version: GROUNDED_WIDGET_AI_PROMPT_VERSION,
        attempt: input.attempt
      },
      maxOutputTokens: 1100,
      signal
    });

    return {
      decision: GroundedAiTurnCandidateDecisionSchema.parse(
        JSON.parse(response.outputText)
      ),
      modelProvider: "openai",
      modelName: response.model,
      responseId: response.id,
      usage: response.usage
    };
  }
}
