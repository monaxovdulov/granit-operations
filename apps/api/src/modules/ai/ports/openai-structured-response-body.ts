export type OpenAiStructuredResponseBodyInput = {
  model: string;
  instructions: string;
  input: string;
  formatName?: string;
  schema?: Record<string, unknown>;
  metadata: Record<string, string>;
  maxOutputTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export function serializeOpenAiStructuredResponseBody(
  request: OpenAiStructuredResponseBodyInput,
): string {
  return JSON.stringify({
    model: request.model,
    store: false,
    instructions: request.instructions,
    input: request.input,
    max_output_tokens: request.maxOutputTokens,
    reasoning: {
      effort: request.reasoningEffort ?? 'low',
    },
    text:
      request.schema && request.formatName
        ? {
            verbosity: 'low',
            format: {
              type: 'json_schema',
              name: request.formatName,
              strict: true,
              schema: request.schema,
            },
          }
        : {
            verbosity: 'low',
          },
    metadata: request.metadata,
  });
}
