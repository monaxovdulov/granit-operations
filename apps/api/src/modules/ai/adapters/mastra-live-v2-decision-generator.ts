import type { AgentExecutionOptionsBase } from "@mastra/core/agent";

import {
  MASTRA_OPENAI_MODEL,
  MASTRA_OPENAI_REASONING_EFFORT,
  type ApiConfig
} from "../../../config.js";
import type { LiveV2GeneratorInput } from "../profiles/live-v2/live-v2-orchestrator.js";
import { liveV2CandidateSchema } from "../profiles/live-v2/live-v2-validator.js";
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";

export const MASTRA_LIVE_V2_MAX_INPUT_CHARACTERS = 64_000;
export const MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS = 4_000;

export type LiveV2RuntimeProvider = "openai" | "fake";

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
};

export interface ObservedLiveV2DecisionGenerator {
  generateDecision(
    input: LiveV2GeneratorInput,
    invocation: LiveV2RuntimeInvocation
  ): Promise<LiveV2RuntimeGeneration>;
}

type MastraLiveV2Message = {
  role: "user";
  content: string;
};

export type MastraLiveV2GenerateOptions = AgentExecutionOptionsBase<unknown> & {
  runId: string;
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
    schema: typeof liveV2CandidateSchema;
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

export class MastraLiveV2GenerationError extends Error {
  constructor(readonly observation?: RejectedLiveV2RuntimeObservation) {
    super("Mastra live_v2 generation failed");
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
      const content = serializeModelInput(input);
      const result = await this.agent.generate(
        [{ role: "user", content }],
        buildGenerateOptions(input, invocation)
      );

      const rejectedObservation = toRejectedObservation(result);

      if (
        result.modelProvider !== this.expectedProvider ||
        !isSafeWidgetAiModelName(result.providerModelName) ||
        result.providerModelName !== this.expectedModelName
      ) {
        throw new MastraLiveV2GenerationError(rejectedObservation);
      }

      const runtimeRunId = toSafeRuntimeRunId(result.runtimeRunId);
      const usage = toTrustedUsage(result.usage);

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

      throw new MastraLiveV2GenerationError();
    }
  }
}

function toRejectedObservation(
  result: MastraLiveV2AgentResult
): RejectedLiveV2RuntimeObservation {
  const provider =
    result.modelProvider === "openai" || result.modelProvider === "fake"
      ? result.modelProvider
      : "none";
  const modelName = isSafeWidgetAiModelName(result.providerModelName)
    ? result.providerModelName
    : undefined;
  const runtimeRunId = toSafeRuntimeRunId(result.runtimeRunId);
  const usage = toTrustedUsage(result.usage);

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

export async function createMastraOpenAiLiveV2DecisionGenerator(input: {
  config: ApiConfig["widgetAi"]["mastra"];
}): Promise<MastraLiveV2DecisionGenerator> {
  assertRealMastraBoundary(input.config, process.env);

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
      apiKey: input.config.openAiApiKey
    },
    maxRetries: 0
  });
  agent.__registerPrimitives({ logger: noopLogger });
  const port: MastraLiveV2AgentPort = {
    async generate(messages, options) {
      let finishProvider: string | undefined;
      let finishModelName: string | undefined;
      let finishRunId: string | undefined;
      const result = await agent.generate(messages, {
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

      if (result.error) {
        throw new MastraLiveV2GenerationError();
      }

      return {
        candidate: result.object,
        modelProvider: finishProvider,
        providerModelName: result.response.modelId ?? finishModelName,
        runtimeRunId: result.runId ?? finishRunId,
        usage: result.totalUsage
      };
    }
  };

  return new MastraLiveV2DecisionGenerator(port, "openai", input.config.model);
}

function buildGenerateOptions(
  input: LiveV2GeneratorInput,
  invocation: LiveV2RuntimeInvocation
): MastraLiveV2GenerateOptions {
  if (!isSafeRuntimeRunId(invocation.appTraceId)) {
    throw new MastraLiveV2GenerationError();
  }

  return {
    runId: invocation.appTraceId,
    instructions: input.assets.prompt.instructions.join("\n"),
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
      schema: liveV2CandidateSchema
    }
  };
}

function serializeModelInput(input: LiveV2GeneratorInput): string {
  const content = JSON.stringify({
    decisionProfile: "live_v2",
    turn: input.turn,
    tone: input.assets.tone,
    facts: input.assets.facts
  });

  if (content.length > MASTRA_LIVE_V2_MAX_INPUT_CHARACTERS) {
    throw new MastraLiveV2GenerationError();
  }

  return content;
}

function assertRealMastraBoundary(
  config: ApiConfig["widgetAi"]["mastra"],
  env: NodeJS.ProcessEnv
): asserts config is ApiConfig["widgetAi"]["mastra"] & { openAiApiKey: string } {
  if (
    !config.openAiApiKey ||
    config.model !== MASTRA_OPENAI_MODEL ||
    config.reasoningEffort !== MASTRA_OPENAI_REASONING_EFFORT ||
    config.traceExportEnabled !== false ||
    config.telemetryDisabled !== true ||
    config.autoRefreshProviders !== false ||
    env.MASTRA_TELEMETRY_DISABLED !== "true" ||
    env.MASTRA_AUTO_REFRESH_PROVIDERS !== "false" ||
    env.MASTRA_LICENSE_KEY !== undefined ||
    env.MASTRA_EE_LICENSE !== undefined
  ) {
    throw new Error("Mastra provider boundary is not safely configured");
  }
}

function toSafeRuntimeRunId(value: string | undefined): string | undefined {
  return value && isSafeRuntimeRunId(value) ? value : undefined;
}

function isSafeRuntimeRunId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,120}$/.test(value);
}

function toTrustedUsage(value: unknown): LiveV2RuntimeUsage | undefined {
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

function toTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
