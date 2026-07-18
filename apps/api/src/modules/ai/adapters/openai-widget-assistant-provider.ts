import {
  type WidgetAiProvider,
  type WidgetAiProviderInput,
  type WidgetAiProviderResult
} from "../services/widget-ai-service.js";
import type {
  GroundedWidgetAiProvider,
  GroundedWidgetAiProviderInput,
  GroundedWidgetAiProviderResult
} from "../services/grounded-widget-ai-service.js";
import { WIDGET_AI_POLICY_VERSION } from "../policy/widget-ai-policy.js";
import {
  GROUNDED_WIDGET_AI_PROMPT_VERSION,
  WIDGET_AI_PROMPT_VERSION
} from "../prompts/widget-ai-prompt.js";
import {
  AI_TURN_DECISION_JSON_SCHEMA,
  AiTurnCandidateDecisionSchema,
  GROUNDED_AI_TURN_DECISION_JSON_SCHEMA,
  GroundedAiTurnCandidateDecisionSchema
} from "../ai-dialog-contract.js";
import { requestOpenAiStructuredResponse } from "./openai-structured-response-client.js";

export type OpenAiWidgetAssistantProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiWidgetAssistantProvider
  implements WidgetAiProvider, GroundedWidgetAiProvider
{
  constructor(private readonly options: OpenAiWidgetAssistantProviderOptions) {}

  async generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult> {
    const response = await requestOpenAiStructuredResponse({
      apiKey: this.options.apiKey,
      model: this.options.model,
      timeoutMs: this.options.timeoutMs ?? 15000,
      instructions: input.instructions,
      input: input.userInput,
      formatName: "granit_widget_ai_turn_decision",
      schema: AI_TURN_DECISION_JSON_SCHEMA,
      metadata: {
        channel: "site_widget",
        prompt_version: WIDGET_AI_PROMPT_VERSION,
        policy_version: WIDGET_AI_POLICY_VERSION
      },
      maxOutputTokens: 700
    });

    return {
      decision: AiTurnCandidateDecisionSchema.parse(JSON.parse(response.outputText)),
      modelProvider: "openai",
      modelName: response.model,
      responseId: response.id,
      usage: response.usage
    };
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
