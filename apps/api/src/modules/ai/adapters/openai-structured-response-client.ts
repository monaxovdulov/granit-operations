import type { WidgetAiUsage } from "../services/widget-ai-service.js";

export type OpenAiStructuredResponseRequest = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  instructions: string;
  input: string;
  formatName?: string;
  schema?: Record<string, unknown>;
  metadata: Record<string, string>;
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type OpenAiStructuredResponse = {
  id?: string;
  model: string;
  outputText: string;
  usage?: WidgetAiUsage;
};

export async function requestOpenAiStructuredResponse(
  request: OpenAiStructuredResponseRequest
): Promise<OpenAiStructuredResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  const abortFromParent = () => controller.abort();

  if (request.signal?.aborted) {
    controller.abort();
  } else {
    request.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`
      },
      body: JSON.stringify({
        model: request.model,
        store: false,
        instructions: request.instructions,
        input: request.input,
        max_output_tokens: request.maxOutputTokens,
        reasoning: {
          effort: "low"
        },
        text: request.schema && request.formatName
          ? {
              verbosity: "low",
              format: {
                type: "json_schema",
                name: request.formatName,
                strict: true,
                schema: request.schema
              }
            }
          : {
              verbosity: "low"
            },
        metadata: request.metadata
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`openai_responses_api_${response.status}`);
    }

    const body = (await response.json()) as OpenAiResponseBody;

    return {
      id: typeof body.id === "string" ? body.id : undefined,
      model: typeof body.model === "string" ? body.model : request.model,
      outputText: extractOutputText(body),
      usage: readUsage(body.usage)
    };
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abortFromParent);
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
