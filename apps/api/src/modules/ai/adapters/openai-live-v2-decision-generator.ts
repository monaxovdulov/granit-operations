import {
  LIVE_V2_OPENAI_MODEL,
  LIVE_V2_OPENAI_REASONING_EFFORT
} from "../../../config.js";
import {
  LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA
} from "../profiles/live-v2/live-v2-validator.js";
import type { LiveV2GeneratorInput } from "../profiles/live-v2/live-v2-orchestrator.js";
import {
  LIVE_V2_MAX_OUTPUT_TOKENS,
  LIVE_V2_PROVIDER_TIMEOUT_MS,
  LiveV2GenerationError,
  buildLiveV2ModelRequest,
  classifyLiveV2RuntimeFailure,
  isSafeLiveV2RuntimeRunId,
  reportLiveV2SanitizedFailure,
  toLiveV2RuntimeUsage,
  toRejectedLiveV2RuntimeObservation,
  toSafeLiveV2RuntimeRunId,
  type LiveV2RuntimeFailureCategory,
  type LiveV2RuntimeGeneration,
  type LiveV2RuntimeInvocation,
  type ObservedLiveV2DecisionGenerator
} from "../ports/live-v2-runtime.js";
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";
import {
  requestOpenAiStructuredResponse,
  type OpenAiStructuredResponseRequest,
  type OpenAiStructuredResponse
} from "./openai-structured-response-client.js";

export type OpenAiLiveV2DecisionGeneratorOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
};

export type OpenAiLiveV2ResponseClient = (
  request: OpenAiStructuredResponseRequest
) => Promise<OpenAiStructuredResponse>;

export class OpenAiLiveV2DecisionGenerator implements ObservedLiveV2DecisionGenerator {
  constructor(
    private readonly options: OpenAiLiveV2DecisionGeneratorOptions,
    private readonly requestClient: OpenAiLiveV2ResponseClient = requestOpenAiStructuredResponse
  ) {
    if (
      !options.apiKey ||
      !isSafeWidgetAiModelName(options.model) ||
      options.model !== LIVE_V2_OPENAI_MODEL
    ) {
      throw new Error("Direct live_v2 OpenAI boundary is not safely configured");
    }
  }

  async generateDecision(
    input: LiveV2GeneratorInput,
    invocation: LiveV2RuntimeInvocation
  ): Promise<LiveV2RuntimeGeneration> {
    try {
      if (!isSafeLiveV2RuntimeRunId(invocation.appTraceId)) {
        throw new LiveV2GenerationError(undefined, "invalid_request");
      }

      const modelRequest = buildLiveV2ModelRequest(input);
      const response = await this.requestClient({
        apiKey: this.options.apiKey,
        model: this.options.model,
        timeoutMs: this.options.timeoutMs ?? LIVE_V2_PROVIDER_TIMEOUT_MS,
        instructions: modelRequest.instructions,
        input: modelRequest.serializedInput,
        formatName: "granit_live_v2_candidate",
        schema: LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA,
        metadata: {
          channel: "site_widget",
          decision_profile: "live_v2"
        },
        maxOutputTokens: LIVE_V2_MAX_OUTPUT_TOKENS,
        reasoningEffort: LIVE_V2_OPENAI_REASONING_EFFORT,
        signal: invocation.signal
      });
      const rejectedObservation = toRejectedLiveV2RuntimeObservation({
        modelProvider: "openai",
        providerModelName: response.model,
        runtimeRunId: response.id,
        usage: response.usage
      });

      if (
        !isSafeWidgetAiModelName(response.model) ||
        response.model !== this.options.model
      ) {
        throw new LiveV2GenerationError(rejectedObservation, "identity_mismatch");
      }

      let candidate: unknown;

      try {
        candidate = JSON.parse(response.outputText);
      } catch {
        throw new LiveV2GenerationError(rejectedObservation, "runtime_error");
      }

      const runtimeRunId = toSafeLiveV2RuntimeRunId(response.id);
      const usage = toLiveV2RuntimeUsage(response.usage);

      return {
        candidate,
        observation: {
          observedModelProvider: "openai",
          observedModelName: response.model,
          ...(runtimeRunId ? { runtimeRunId } : {}),
          ...(usage ? { usage } : {})
        }
      };
    } catch (error) {
      if (error instanceof LiveV2GenerationError) {
        reportLiveV2SanitizedFailure(
          this.options.onSanitizedFailure,
          error.failureCategory ?? "runtime_error"
        );
        throw error;
      }

      const category = classifyLiveV2RuntimeFailure(error);
      reportLiveV2SanitizedFailure(this.options.onSanitizedFailure, category);
      throw new LiveV2GenerationError(undefined, category);
    }
  }
}
