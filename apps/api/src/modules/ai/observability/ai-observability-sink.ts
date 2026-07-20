export type AiObservabilityPrimitive = string | number | boolean | null;

export type AiObservabilityAttribute =
  | AiObservabilityPrimitive
  | AiObservabilityPrimitive[]
  | { [key: string]: AiObservabilityAttribute };

export type AiObservabilityAttributes = Record<string, AiObservabilityAttribute>;

export type AiTraceInput = {
  traceId: string;
  aiRunId?: string;
  leadId?: string;
  conversationId?: string;
  publicConversationId?: string;
  inboundPublicMessageId?: string;
  name: string;
  startedAt: Date;
  attributes?: AiObservabilityAttributes;
};

export type AiSpanInput = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind:
    | "intake"
    | "send_gate"
    | "generator"
    | "verifier"
    | "grounding"
    | "persistence"
    | "quality"
    | "export";
  status: "ok" | "error" | "blocked" | "degraded";
  startedAt: Date;
  endedAt?: Date;
  attributes?: AiObservabilityAttributes;
};

export type AiModelCallInput = {
  traceId: string;
  spanId: string;
  provider: string;
  modelName?: string;
  status: "ok" | "error" | "timeout" | "blocked";
  latencyMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  attributes?: AiObservabilityAttributes;
};

export interface AiObservabilitySink {
  recordTrace(input: AiTraceInput): Promise<void>;
  recordSpan(input: AiSpanInput): Promise<void>;
  recordModelCall(input: AiModelCallInput): Promise<void>;
}
