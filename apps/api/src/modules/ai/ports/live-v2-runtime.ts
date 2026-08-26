import {
  DIRECT_LIVE_V2_OPENAI_MODEL,
  DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT
} from "../../../config.js";
import {
  FINAL_TURN_RESULT_JSON_SCHEMA,
  MODEL_TURN_ACTION_JSON_SCHEMA
} from "../profiles/live-v2/model-turn-validator.js";
import type { LiveV2GeneratorInput } from "../profiles/live-v2/live-v2-orchestrator.js";
import { LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA } from "../profiles/live-v2/live-v2-validator.js";
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";
import { serializeOpenAiStructuredResponseBody } from "./openai-structured-response-body.js";

// App-owned circuit breaker sized for short consultations; the provider window
// is deliberately not the application budget.
export const LIVE_V2_MAX_INPUT_CHARACTERS = 256_000;
export const LIVE_V2_MAX_OUTPUT_TOKENS = 4_000;
export const LIVE_V2_PROVIDER_TIMEOUT_MS = 15_000;

export type LiveV2RuntimeProvider = "openai" | "fake";

export type LiveV2RuntimeFailureCategory =
  | "auth_or_entitlement"
  | "identity_mismatch"
  | "invalid_request"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_sdk_error"
  | "runtime_error"
  | "timeout_or_abort";

export type LiveV2ObservabilityDiagnostic =
  | {
      code: "optional_evidence_dropped";
      stage: "provider_response";
      fieldClass: "runtime_identifier";
    }
  | {
      code: "catalog_snapshot_unavailable";
      stage: "startup";
      fieldClass: "catalog_snapshot";
    };

export type LiveV2RuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export type TrustedLiveV2RuntimeObservation = {
  observedModelProvider: LiveV2RuntimeProvider;
  observedModelName: string;
  runtimeRunId?: string;
  usage?: LiveV2RuntimeUsage;
};

export type RejectedLiveV2RuntimeObservation = {
  observedModelProvider: LiveV2RuntimeProvider | "none";
  observedModelName?: string;
  runtimeRunId?: string;
  usage?: LiveV2RuntimeUsage;
};

export type LiveV2RuntimeGeneration = {
  candidate: unknown;
  observation: TrustedLiveV2RuntimeObservation;
};

export type LiveV2RuntimeInvocation = {
  appTraceId: string;
  signal?: AbortSignal;
};

export interface ObservedLiveV2DecisionGenerator {
  generateDecision(
    input: LiveV2GeneratorInput,
    invocation: LiveV2RuntimeInvocation
  ): Promise<LiveV2RuntimeGeneration>;
}

export class LiveV2GenerationError extends Error {
  constructor(
    readonly observation?: RejectedLiveV2RuntimeObservation,
    readonly failureCategory?: LiveV2RuntimeFailureCategory
  ) {
    super("live_v2 generation failed");
    this.name = "LiveV2GenerationError";
  }
}

export function buildLiveV2ModelRequest(input: LiveV2GeneratorInput): {
  model: string;
  instructions: string;
  serializedInput: string;
  formatName: string;
  schema: Record<string, unknown>;
  metadata: Record<string, string>;
  maxOutputTokens: number;
  reasoningEffort: "low" | "medium" | "high";
  requestCharacters: number;
} {
  const request = serializeLiveV2ModelRequest(input);

  if (request.requestCharacters > LIVE_V2_MAX_INPUT_CHARACTERS) {
    throw new LiveV2GenerationError(undefined, "invalid_request");
  }

  return request;
}

export function measureLiveV2ModelRequestCharacters(
  input: LiveV2GeneratorInput
): number {
  return serializeLiveV2ModelRequest(input).requestCharacters;
}

function serializeLiveV2ModelRequest(input: LiveV2GeneratorInput) {
  const instructions = input.assets.prompt.instructions.join("\n");
  const serializedInput = JSON.stringify({
    decisionProfile: "live_v2",
    turn: input.turn,
    responseMode: input.responseMode ?? "legacy_candidate",
    ...(input.catalogTool ? { catalogTool: input.catalogTool } : {}),
    ...(input.catalogSearch ? { catalogSearch: input.catalogSearch } : {}),
    tone: input.assets.tone,
    facts: input.assets.facts
  });
  const responseContract = selectResponseContract(input.responseMode);
  const request = {
    model: DIRECT_LIVE_V2_OPENAI_MODEL,
    instructions,
    input: serializedInput,
    formatName: responseContract.formatName,
    schema: responseContract.schema,
    metadata: {
      channel: "site_widget",
      decision_profile: "live_v2",
      turn_contract: "granit_model_turn.v2",
      call_phase: responseContract.callPhase
    },
    maxOutputTokens: LIVE_V2_MAX_OUTPUT_TOKENS,
    reasoningEffort: DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT
  };

  return {
    model: request.model,
    instructions,
    serializedInput,
    formatName: request.formatName,
    schema: request.schema,
    metadata: request.metadata,
    maxOutputTokens: request.maxOutputTokens,
    reasoningEffort: request.reasoningEffort,
    requestCharacters: serializeOpenAiStructuredResponseBody(request).length
  };
}

function selectResponseContract(
  responseMode: LiveV2GeneratorInput["responseMode"]
): {
  formatName: string;
  schema: Record<string, unknown>;
  callPhase: string;
} {
  if (responseMode === "legacy_candidate") {
    return {
      formatName: "granit_live_v2_candidate",
      schema: LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA,
      callPhase: "legacy_candidate"
    };
  }
  if (responseMode === "final_result") {
    return {
      formatName: "granit_final_turn_result",
      schema: FINAL_TURN_RESULT_JSON_SCHEMA,
      callPhase: "final"
    };
  }
  return {
    formatName: "granit_model_turn_action",
    schema: MODEL_TURN_ACTION_JSON_SCHEMA,
    callPhase: "decision"
  };
}

export function classifyLiveV2RuntimeFailure(
  error: unknown
): LiveV2RuntimeFailureCategory {
  const status = findHttpStatus(error);

  if (status === 400 || status === 422) return "invalid_request";
  if (status === 401 || status === 403 || status === 404) {
    return "auth_or_entitlement";
  }
  if (status === 408) return "timeout_or_abort";
  if (status === 429) return "provider_rate_limited";
  if (status !== undefined && status >= 500 && status <= 599) {
    return "provider_unavailable";
  }

  const name = findErrorName(error);
  if (name === "AbortError" || name === "TimeoutError") return "timeout_or_abort";
  if (name === "APICallError") return "provider_sdk_error";

  return "runtime_error";
}

export function reportLiveV2SanitizedFailure(
  callback: ((category: LiveV2RuntimeFailureCategory) => void) | undefined,
  category: LiveV2RuntimeFailureCategory
): void {
  try {
    callback?.(category);
  } catch {
    // Diagnostic reporting cannot change the fail-closed runtime outcome.
  }
}

export function reportLiveV2ObservabilityDiagnostic(
  callback: ((diagnostic: LiveV2ObservabilityDiagnostic) => void) | undefined,
  diagnostic: LiveV2ObservabilityDiagnostic
): void {
  try {
    callback?.(diagnostic);
  } catch {
    // Optional diagnostics cannot change the runtime outcome.
  }
}

export function toRejectedLiveV2RuntimeObservation(input: {
  modelProvider: unknown;
  providerModelName: unknown;
  runtimeRunId: unknown;
  usage: unknown;
}): RejectedLiveV2RuntimeObservation {
  const provider =
    input.modelProvider === "openai" || input.modelProvider === "fake"
      ? input.modelProvider
      : "none";
  const modelName = isSafeWidgetAiModelName(input.providerModelName)
    ? input.providerModelName
    : undefined;
  const runtimeRunId = toSafeLiveV2RuntimeRunId(input.runtimeRunId);
  const usage = toLiveV2RuntimeUsage(input.usage);

  if (provider === "none" || !modelName) {
    return {
      observedModelProvider: "none",
      ...(runtimeRunId ? { runtimeRunId } : {}),
      ...(usage ? { usage } : {})
    };
  }

  return {
    observedModelProvider: provider,
    observedModelName: modelName,
    ...(runtimeRunId ? { runtimeRunId } : {}),
    ...(usage ? { usage } : {})
  };
}

export function toSafeLiveV2RuntimeRunId(value: unknown): string | undefined {
  return typeof value === "string" && isSafeLiveV2RuntimeRunId(value)
    ? value
    : undefined;
}

export function isSafeLiveV2RuntimeRunId(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    ) ||
    (/^[A-Za-z0-9._:-]{1,120}$/.test(value) && !/\d{7,}/.test(value))
  );
}

export function toLiveV2RuntimeUsage(value: unknown): LiveV2RuntimeUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage = {
    inputTokens: toTokenCount(value.inputTokens),
    outputTokens: toTokenCount(value.outputTokens),
    totalTokens: toTokenCount(value.totalTokens),
    reasoningTokens: toTokenCount(value.reasoningTokens),
    cachedInputTokens: toTokenCount(value.cachedInputTokens)
  };
  const presentUsage = Object.fromEntries(
    Object.entries(usage).filter((entry): entry is [string, number] => entry[1] !== undefined)
  ) as LiveV2RuntimeUsage;

  return Object.keys(presentUsage).length > 0 ? presentUsage : undefined;
}

function findHttpStatus(value: unknown, depth = 0): number | undefined {
  if (!isRecord(value) || depth > 4) return undefined;

  for (const key of ["status", "statusCode"]) {
    const candidate = value[key];
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 100 &&
      candidate <= 599
    ) {
      return candidate;
    }
  }

  for (const key of ["cause", "details", "error", "originalError"]) {
    const nested = findHttpStatus(value[key], depth + 1);
    if (nested !== undefined) return nested;
  }

  return undefined;
}

function findErrorName(value: unknown, depth = 0): string | undefined {
  if (!isRecord(value) || depth > 4) return undefined;
  if (typeof value.name === "string") return value.name;

  for (const key of ["cause", "details", "error", "originalError"]) {
    const nested = findErrorName(value[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

function toTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
