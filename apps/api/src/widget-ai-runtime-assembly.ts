import type { ApiConfig } from "./config.js";
import type { WidgetAiAssemblyOptions } from "./app-context.js";
import {
  createMastraOpenAiLiveV2DecisionGenerator,
  type ObservedLiveV2DecisionGenerator,
  type RealMastraBoundaryConfig
} from "./modules/ai/adapters/mastra-live-v2-decision-generator.js";
import { OpenAiWidgetAssistantProvider } from "./modules/ai/adapters/openai-widget-assistant-provider.js";
import {
  selectLiveV2ApprovedAssets,
  type SelectedLiveV2ApprovedAssets
} from "./modules/ai/assets/approved-ai-assets.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";

type RuntimeAssemblyDependencies = {
  createMastraGenerator?: (input: {
    config: RealMastraBoundaryConfig;
  }) => Promise<ObservedLiveV2DecisionGenerator>;
  selectLiveV2Assets?: () => Promise<SelectedLiveV2ApprovedAssets>;
};

export async function buildConfiguredWidgetAiAssembly(input: {
  config: ApiConfig;
  runRepository: AiRunRepository;
  dependencies?: RuntimeAssemblyDependencies;
}): Promise<WidgetAiAssemblyOptions> {
  const { config, runRepository } = input;

  if (config.widgetAi.runtimeMode === "direct_openai") {
    const modelIsSafe = isSafeWidgetAiModelName(config.widgetAi.openAiModel);
    const provider = config.widgetAi.openAiApiKey && modelIsSafe
      ? new OpenAiWidgetAssistantProvider({
          apiKey: config.widgetAi.openAiApiKey,
          model: config.widgetAi.openAiModel
        })
      : undefined;

    return {
      enabled: config.widgetAi.enabled,
      runtimeMode: "direct_openai",
      provider,
      modelName: config.widgetAi.openAiModel,
      runRepository
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
  const generator = await createGenerator({ config: boundaryConfig });

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
