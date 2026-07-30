import type { ApiConfig } from "./config.js";
import type { WidgetAiAssemblyOptions } from "./app-context.js";
import {
  createMastraOpenAiLiveV2DecisionGenerator,
  type LiveV2RuntimeFailureCategory,
  type ObservedLiveV2DecisionGenerator,
  type RealMastraBoundaryConfig
} from "./modules/ai/adapters/mastra-live-v2-decision-generator.js";
import { OpenAiWidgetAssistantProvider } from "./modules/ai/adapters/openai-widget-assistant-provider.js";
import { OpenAiWidgetSemanticVerifier } from "./modules/ai/adapters/openai-widget-semantic-verifier.js";
import {
  selectLiveV2ApprovedAssets,
  type SelectedLiveV2ApprovedAssets
} from "./modules/ai/assets/approved-ai-assets.js";
import { FileCatalogKnowledgeProvider } from "./modules/ai/catalog/file-catalog-knowledge-provider.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";

type RuntimeAssemblyDependencies = {
  createMastraGenerator?: (input: {
    config: RealMastraBoundaryConfig;
    onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
  }) => Promise<ObservedLiveV2DecisionGenerator>;
  selectLiveV2Assets?: () => Promise<SelectedLiveV2ApprovedAssets>;
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
    const provider = config.widgetAi.openAiApiKey && modelIsSafe
      ? new OpenAiWidgetAssistantProvider({
          apiKey: config.widgetAi.openAiApiKey,
          model: config.widgetAi.openAiModel,
          timeoutMs: config.widgetAi.generatorTimeoutMs
        })
      : undefined;
    const verifier = config.widgetAi.openAiApiKey && modelIsSafe
      ? new OpenAiWidgetSemanticVerifier({
          apiKey: config.widgetAi.openAiApiKey,
          model: config.widgetAi.verifierModel,
          timeoutMs: config.widgetAi.verifierTimeoutMs
        })
      : undefined;

    return {
      enabled: config.widgetAi.enabled,
      runtimeMode: "direct_openai",
      groundedMode: config.widgetAi.groundedMode,
      provider,
      groundedProvider: provider,
      verifier,
      catalog: new FileCatalogKnowledgeProvider(),
      modelName: config.widgetAi.openAiModel,
      verifierModelName: config.widgetAi.verifierModel,
      deadlineMs: config.widgetAi.deadlineMs,
      runRepository,
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
