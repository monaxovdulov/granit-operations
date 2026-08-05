import type { AgentExecutionOptionsBase } from "@mastra/core/agent";

import {
  MASTRA_OPENAI_MODEL,
  MASTRA_OPENAI_REASONING_EFFORT,
  type AiRuntimeMode,
  type ApiConfig,
  type DeploymentTier
} from "../../../config.js";
import type { LiveV2GeneratorInput } from "../profiles/live-v2/live-v2-orchestrator.js";
import { liveV2ProviderCandidateSchema } from "../profiles/live-v2/live-v2-validator.js";
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
  type LiveV2RuntimeProvider,
  type ObservedLiveV2DecisionGenerator,
  type RejectedLiveV2RuntimeObservation
} from "../ports/live-v2-runtime.js";
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";

export const MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS = LIVE_V2_MAX_OUTPUT_TOKENS;
export const MASTRA_LIVE_V2_PROVIDER_TIMEOUT_MS = LIVE_V2_PROVIDER_TIMEOUT_MS;

export {
  classifyLiveV2RuntimeFailure,
  type LiveV2RuntimeFailureCategory,
  type LiveV2RuntimeProvider,
  type ObservedLiveV2DecisionGenerator,
  type RejectedLiveV2RuntimeObservation
} from "../ports/live-v2-runtime.js";

export type RealMastraBoundaryConfig = {
  deploymentTier: DeploymentTier;
  runtimeMode: AiRuntimeMode;
  mastra: ApiConfig["widgetAi"]["mastra"];
};

const PINNED_MASTRA_OPENAI_RESPONSES_PROVIDERS = new Set(["openai", "openai.responses"]);

type MastraLiveV2Message = {
  role: "user";
  content: string;
};

export type MastraLiveV2GenerateOptions = AgentExecutionOptionsBase<unknown> & {
  runId: string;
  abortSignal: AbortSignal;
  maxSteps: 1;
  maxProcessorRetries: 0;
  modelSettings: {
    maxRetries: 0;
    maxOutputTokens: typeof MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS;
  };
  providerOptions: {
    openai: {
      reasoningEffort: typeof MASTRA_OPENAI_REASONING_EFFORT;
      store: false;
      transport: "fetch";
    };
  };
  structuredOutput: {
    schema: typeof liveV2ProviderCandidateSchema;
  };
};

export type MastraLiveV2AgentResult = {
  candidate: unknown;
  modelProvider: string | undefined;
  providerModelName: string | undefined;
  runtimeRunId: string | undefined;
  usage: unknown;
};

export interface MastraLiveV2AgentPort {
  generate(
    messages: MastraLiveV2Message[],
    options: MastraLiveV2GenerateOptions
  ): Promise<MastraLiveV2AgentResult>;
}

export class MastraLiveV2GenerationError extends LiveV2GenerationError {
  constructor(
    readonly observation?: RejectedLiveV2RuntimeObservation,
    readonly failureCategory?: LiveV2RuntimeFailureCategory
  ) {
    super(observation, failureCategory);
    this.name = "MastraLiveV2GenerationError";
  }
}

export class MastraLiveV2DecisionGenerator implements ObservedLiveV2DecisionGenerator {
  constructor(
    private readonly agent: MastraLiveV2AgentPort,
    private readonly expectedProvider: LiveV2RuntimeProvider,
    private readonly expectedModelName: string
  ) {}

  async generateDecision(
    input: LiveV2GeneratorInput,
    invocation: LiveV2RuntimeInvocation
  ): Promise<LiveV2RuntimeGeneration> {
    try {
      const modelRequest = buildLiveV2ModelRequest(input);
      const result = await this.agent.generate(
        [{ role: "user", content: modelRequest.serializedInput }],
        buildGenerateOptions(modelRequest.instructions, invocation)
      );

      const rejectedObservation = toRejectedLiveV2RuntimeObservation(result);

      if (
        result.modelProvider !== this.expectedProvider ||
        !isSafeWidgetAiModelName(result.providerModelName) ||
        result.providerModelName !== this.expectedModelName
      ) {
        throw new MastraLiveV2GenerationError(rejectedObservation, "identity_mismatch");
      }

      const runtimeRunId = toSafeLiveV2RuntimeRunId(result.runtimeRunId);
      const usage = toLiveV2RuntimeUsage(result.usage);

      return {
        candidate: result.candidate,
        observation: {
          observedModelProvider: this.expectedProvider,
          observedModelName: result.providerModelName,
          ...(runtimeRunId ? { runtimeRunId } : {}),
          ...(usage ? { usage } : {})
        }
      };
    } catch (error) {
      if (error instanceof MastraLiveV2GenerationError) {
        throw error;
      }
      if (error instanceof LiveV2GenerationError) {
        throw new MastraLiveV2GenerationError(
          error.observation,
          error.failureCategory
        );
      }

      throw new MastraLiveV2GenerationError();
    }
  }
}

export async function createMastraOpenAiLiveV2DecisionGenerator(input: {
  config: RealMastraBoundaryConfig;
  onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
}): Promise<MastraLiveV2DecisionGenerator> {
  assertRealMastraBoundary(input.config, process.env);
  const mastraConfig = input.config.mastra;

  const [{ Agent }, { noopLogger }] = await Promise.all([
    import("@mastra/core/agent"),
    import("@mastra/core/logger")
  ]);
  const agent = new Agent({
    id: "granit-widget-live-v2",
    name: "Granit Widget live_v2",
    instructions:
      "Use only the per-run app-owned instructions and return the requested structured candidate.",
    model: {
      id: `openai/${MASTRA_OPENAI_MODEL}`,
      apiKey: mastraConfig.openAiApiKey
    },
    maxRetries: 0
  });
  agent.__registerPrimitives({ logger: noopLogger });
  const port: MastraLiveV2AgentPort = {
    async generate(messages, options) {
      let finishProvider: string | undefined;
      let finishModelName: string | undefined;
      let finishRunId: string | undefined;
      let result: Awaited<ReturnType<typeof agent.generate>>;

      try {
        result = await agent.generate(messages, {
          ...options,
          structuredOutput: {
            ...options.structuredOutput,
            logger: noopLogger
          },
          onFinish(event) {
            finishProvider = event.model?.provider;
            finishModelName = event.model?.modelId;
            finishRunId = event.runId;
          }
        });
      } catch (error) {
        const category = classifyLiveV2RuntimeFailure(error);
        reportLiveV2SanitizedFailure(input.onSanitizedFailure, category);
        throw new MastraLiveV2GenerationError(undefined, category);
      }

      if (result.error) {
        const category = classifyLiveV2RuntimeFailure(result.error);
        reportLiveV2SanitizedFailure(input.onSanitizedFailure, category);
        throw new MastraLiveV2GenerationError(undefined, category);
      }

      return {
        candidate: result.object,
        modelProvider: canonicalizePinnedMastraOpenAiProvider(finishProvider),
        providerModelName: result.response.modelId ?? finishModelName,
        runtimeRunId: result.runId ?? finishRunId,
        usage: result.totalUsage
      };
    }
  };

  return new MastraLiveV2DecisionGenerator(port, "openai", mastraConfig.model);
}

export function canonicalizePinnedMastraOpenAiProvider(
  provider: string | undefined
): "openai" | undefined {
  return provider && PINNED_MASTRA_OPENAI_RESPONSES_PROVIDERS.has(provider)
    ? "openai"
    : undefined;
}

function buildGenerateOptions(
  instructions: string,
  invocation: LiveV2RuntimeInvocation
): MastraLiveV2GenerateOptions {
  if (!isSafeLiveV2RuntimeRunId(invocation.appTraceId)) {
    throw new MastraLiveV2GenerationError();
  }

  return {
    runId: invocation.appTraceId,
    abortSignal: invocation.signal
      ? AbortSignal.any([
          invocation.signal,
          AbortSignal.timeout(MASTRA_LIVE_V2_PROVIDER_TIMEOUT_MS)
        ])
      : AbortSignal.timeout(MASTRA_LIVE_V2_PROVIDER_TIMEOUT_MS),
    instructions,
    maxSteps: 1,
    maxProcessorRetries: 0,
    modelSettings: {
      maxRetries: 0,
      maxOutputTokens: MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS
    },
    providerOptions: {
      openai: {
        reasoningEffort: MASTRA_OPENAI_REASONING_EFFORT,
        store: false,
        transport: "fetch"
      }
    },
    structuredOutput: {
      schema: liveV2ProviderCandidateSchema
    }
  };
}

function assertRealMastraBoundary(
  config: RealMastraBoundaryConfig,
  env: NodeJS.ProcessEnv
): asserts config is RealMastraBoundaryConfig & {
  runtimeMode: "mastra_openai_api";
  mastra: ApiConfig["widgetAi"]["mastra"] & { openAiApiKey: string };
} {
  const mastra = config.mastra;

  if (
    config.deploymentTier !== "staging" ||
    config.runtimeMode !== "mastra_openai_api" ||
    !mastra.openAiApiKey ||
    mastra.model !== MASTRA_OPENAI_MODEL ||
    mastra.reasoningEffort !== MASTRA_OPENAI_REASONING_EFFORT ||
    mastra.traceExportEnabled !== false ||
    mastra.telemetryDisabled !== true ||
    mastra.autoRefreshProviders !== false ||
    env.MASTRA_TELEMETRY_DISABLED !== "true" ||
    env.MASTRA_AUTO_REFRESH_PROVIDERS !== "false" ||
    env.OPENAI_BASE_URL !== undefined ||
    env.MASTRA_LICENSE_KEY !== undefined ||
    env.MASTRA_EE_LICENSE !== undefined
  ) {
    throw new Error("Mastra provider boundary is not safely configured");
  }
}
