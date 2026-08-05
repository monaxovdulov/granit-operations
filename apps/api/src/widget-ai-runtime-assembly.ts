import type { ApiConfig } from "./config.js";
import type { WidgetAiAssemblyOptions } from "./app-context.js";
import {
  createMastraOpenAiLiveV2DecisionGenerator,
  type RealMastraBoundaryConfig
} from "./modules/ai/adapters/mastra-live-v2-decision-generator.js";
import { OpenAiLiveV2DecisionGenerator } from "./modules/ai/adapters/openai-live-v2-decision-generator.js";
import type {
  LiveV2RuntimeFailureCategory,
  ObservedLiveV2DecisionGenerator
} from "./modules/ai/ports/live-v2-runtime.js";
import {
  selectLiveV2ApprovedAssets,
  type SelectedLiveV2ApprovedAssets
} from "./modules/ai/assets/approved-ai-assets.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";

type RuntimeAssemblyDependencies = {
  createMastraGenerator?: (input: {
    config: RealMastraBoundaryConfig;
    onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
  }) => Promise<ObservedLiveV2DecisionGenerator>;
  selectLiveV2Assets?: () => Promise<SelectedLiveV2ApprovedAssets>;
  createDirectGenerator?: (input: {
    apiKey: string;
    model: string;
    timeoutMs: number;
    onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
  }) => ObservedLiveV2DecisionGenerator;
};

export async function buildConfiguredWidgetAiAssembly(input: {
  config: ApiConfig;
  runRepository: AiRunRepository;
  onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
  dependencies?: RuntimeAssemblyDependencies;
}): Promise<WidgetAiAssemblyOptions> {
  const { config, runRepository } = input;

  if (config.widgetAi.runtimeMode === "direct_openai") {
    const modelIsSafe = isSafeWidgetAiModelName(config.widgetAi.openAiModel);
    const assets = config.widgetAi.enabled
      ? await (input.dependencies?.selectLiveV2Assets ?? selectLiveV2ApprovedAssets)()
      : undefined;
    const createDirectGenerator =
      input.dependencies?.createDirectGenerator ??
      ((options) => new OpenAiLiveV2DecisionGenerator(options));
    const generator =
      config.widgetAi.openAiApiKey && modelIsSafe
        ? createDirectGenerator({
            apiKey: config.widgetAi.openAiApiKey,
            model: config.widgetAi.openAiModel,
            timeoutMs: config.widgetAi.generatorTimeoutMs,
            ...(input.onSanitizedFailure
              ? { onSanitizedFailure: input.onSanitizedFailure }
              : {})
          })
        : undefined;

    return {
      enabled: config.widgetAi.enabled,
      runtimeMode: "direct_openai",
      modelName: config.widgetAi.openAiModel,
      runRepository,
      ...(assets
        ? {
            directLiveV2: {
              generator,
              modelName: config.widgetAi.openAiModel,
              approvedFacts: assets.factsSnapshot
            }
          }
        : {}),
      jobWorker: config.widgetAi.jobWorker
    };
  }

  const selectAssets = input.dependencies?.selectLiveV2Assets ?? selectLiveV2ApprovedAssets;
  const createGenerator =
    input.dependencies?.createMastraGenerator ?? createMastraOpenAiLiveV2DecisionGenerator;
  const assets = await selectAssets();
  const boundaryConfig: RealMastraBoundaryConfig = {
    deploymentTier: config.deploymentTier,
    runtimeMode: config.widgetAi.runtimeMode,
    mastra: config.widgetAi.mastra
  };
  const generator = await createGenerator({
    config: boundaryConfig,
    ...(input.onSanitizedFailure
      ? { onSanitizedFailure: input.onSanitizedFailure }
      : {})
  });

  return {
    enabled: config.widgetAi.enabled,
    runtimeMode: "mastra_openai_api",
    runRepository,
    stagingOpenAi: {
      generator,
      modelName: config.widgetAi.mastra.model,
      approvedFacts: assets.factsSnapshot
    }
  };
}
