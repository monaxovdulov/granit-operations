import {
  DIRECT_LIVE_V2_OPENAI_MODEL,
  DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT
} from "../../../config.js";
import {
  FINAL_TURN_RESULT_JSON_SCHEMA,
  MODEL_TURN_ACTION_JSON_SCHEMA
} from "../profiles/live-v2/model-turn-validator.js";
import { LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA } from "../profiles/live-v2/live-v2-validator.js";
import type { LiveV2GeneratorInput } from "../profiles/live-v2/live-v2-orchestrator.js";
import {
  LIVE_V2_MAX_OUTPUT_TOKENS,
  LIVE_V2_PROVIDER_TIMEOUT_MS,
  LiveV2GenerationError,
  buildLiveV2ModelRequest,
  classifyLiveV2RuntimeFailure,
  isSafeLiveV2RuntimeRunId,
  reportLiveV2ObservabilityDiagnostic,
  reportLiveV2SanitizedFailure,
  toLiveV2RuntimeUsage,
  toRejectedLiveV2RuntimeObservation,
  toSafeLiveV2RuntimeRunId,
  type LiveV2RuntimeFailureCategory,
  type LiveV2ObservabilityDiagnostic,
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
  onSanitizedDiagnostic?: (diagnostic: LiveV2ObservabilityDiagnostic) => void;
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
      options.model !== DIRECT_LIVE_V2_OPENAI_MODEL
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
      const responseContract = selectResponseContract(input.responseMode);
      const response = await this.requestClient({
        apiKey: this.options.apiKey,
        model: this.options.model,
        timeoutMs: this.options.timeoutMs ?? LIVE_V2_PROVIDER_TIMEOUT_MS,
        instructions: modelRequest.instructions,
        input: modelRequest.serializedInput,
        formatName: responseContract.formatName,
        schema: responseContract.schema,
        metadata: {
          channel: "site_widget",
          decision_profile: "live_v2",
          turn_contract: "granit_model_turn.v2",
          call_phase: responseContract.callPhase
        },
        maxOutputTokens: LIVE_V2_MAX_OUTPUT_TOKENS,
        reasoningEffort: DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT,
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
      if (response.id !== undefined && !runtimeRunId) {
        reportLiveV2ObservabilityDiagnostic(this.options.onSanitizedDiagnostic, {
          code: "optional_evidence_dropped",
          stage: "provider_response",
          fieldClass: "runtime_identifier"
        });
      }
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
