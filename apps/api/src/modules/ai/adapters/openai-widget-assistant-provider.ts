import {
  type WidgetAiProvider,
  type WidgetAiProviderInput,
  type WidgetAiProviderResult,
  type WidgetAiUsage
} from "../services/widget-ai-service.js";
import { WIDGET_AI_POLICY_VERSION } from "../policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../prompts/widget-ai-prompt.js";
import {
  AI_TURN_DECISION_JSON_SCHEMA,
  AiTurnCandidateDecisionSchema
} from "../ai-dialog-contract.js";

export type OpenAiWidgetAssistantProviderOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
};

export class OpenAiWidgetAssistantProvider implements WidgetAiProvider {
  constructor(private readonly options: OpenAiWidgetAssistantProviderOptions) {}

  async generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify({
          model: this.options.model,
          store: false,
          instructions: input.instructions,
          input: input.userInput,
          max_output_tokens: 700,
          reasoning: {
            effort: "low"
          },
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "granit_widget_ai_turn_decision",
              strict: true,
              schema: AI_TURN_DECISION_JSON_SCHEMA
            }
          },
          metadata: {
            channel: "site_widget",
            prompt_version: WIDGET_AI_PROMPT_VERSION,
            policy_version: WIDGET_AI_POLICY_VERSION
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`openai_responses_api_${response.status}`);
      }

      const body = (await response.json()) as OpenAiResponseBody;
      const outputText = extractOutputText(body);
      const decision = AiTurnCandidateDecisionSchema.parse(JSON.parse(outputText));

      return {
        decision,
        modelProvider: "openai",
        modelName: typeof body.model === "string" ? body.model : this.options.model,
        responseId: typeof body.id === "string" ? body.id : undefined,
        usage: readUsage(body.usage)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

type OpenAiResponseBody = {
  id?: unknown;
  model?: unknown;
  output?: unknown;
  usage?: unknown;
};

function extractOutputText(body: OpenAiResponseBody): string {
  const output = Array.isArray(body.output) ? body.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = (item as { content?: unknown }).content;

    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const typedPart = part as { type?: unknown; text?: unknown };

      if (typedPart.type === "output_text" && typeof typedPart.text === "string") {
        chunks.push(typedPart.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function readUsage(usage: unknown): WidgetAiUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const value = usage as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };

  return {
    inputTokens: typeof value.input_tokens === "number" ? value.input_tokens : undefined,
    outputTokens: typeof value.output_tokens === "number" ? value.output_tokens : undefined,
    totalTokens: typeof value.total_tokens === "number" ? value.total_tokens : undefined
  };
}
