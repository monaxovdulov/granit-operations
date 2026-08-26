import type { WidgetAiUsage } from "../ports/widget-ai-usage.js";
import {
  serializeOpenAiStructuredResponseBody,
  type OpenAiStructuredResponseBodyInput
} from "../ports/openai-structured-response-body.js";

export type OpenAiStructuredResponseRequest = OpenAiStructuredResponseBodyInput & {
  apiKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type OpenAiStructuredResponse = {
  id?: string;
  model: string;
  outputText: string;
  usage?: WidgetAiUsage;
};

export class OpenAiStructuredResponseError extends Error {
  constructor(readonly status: number) {
    super("OpenAI Responses request failed");
    this.name = "OpenAiStructuredResponseError";
  }
}

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
      body: serializeOpenAiStructuredResponseBody(request),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new OpenAiStructuredResponseError(response.status);
    }

    const body = (await response.json()) as OpenAiResponseBody;
    if (typeof body.model !== "string") {
      throw new Error("OpenAI Responses payload is missing model identity");
    }

    return {
      id: typeof body.id === "string" ? body.id : undefined,
      model: body.model,
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
