import type { ApiConfig } from "./config.js";
import type { WidgetAiAssemblyOptions } from "./app-context.js";
import { OpenAiLiveV2DecisionGenerator } from "./modules/ai/adapters/openai-live-v2-decision-generator.js";
import {
  reportLiveV2ObservabilityDiagnostic,
  type LiveV2ObservabilityDiagnostic,
  type LiveV2RuntimeFailureCategory,
  type ObservedLiveV2DecisionGenerator
} from "./modules/ai/ports/live-v2-runtime.js";
import {
  selectLiveV2ApprovedAssets,
  type SelectedLiveV2ApprovedAssets
} from "./modules/ai/assets/approved-ai-assets.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";
import type { CatalogIndexSnapshot } from "./modules/ai/catalog/catalog-index.js";
import { loadPinnedCatalogIndex } from "./modules/ai/catalog/pinned-catalog-index.js";

type RuntimeAssemblyDependencies = {
  selectLiveV2Assets?: () => Promise<SelectedLiveV2ApprovedAssets>;
  loadCatalogIndex?: () => Promise<CatalogIndexSnapshot>;
  createDirectGenerator?: (input: {
    apiKey: string;
    model: string;
    timeoutMs: number;
    onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
    onSanitizedDiagnostic?: (diagnostic: LiveV2ObservabilityDiagnostic) => void;
  }) => ObservedLiveV2DecisionGenerator;
};

export async function buildConfiguredWidgetAiAssembly(input: {
  config: ApiConfig;
  runRepository: AiRunRepository;
  onSanitizedFailure?: (category: LiveV2RuntimeFailureCategory) => void;
  onSanitizedDiagnostic?: (diagnostic: LiveV2ObservabilityDiagnostic) => void;
  dependencies?: RuntimeAssemblyDependencies;
}): Promise<WidgetAiAssemblyOptions> {
  const { config, runRepository } = input;

  const modelIsSafe = isSafeWidgetAiModelName(config.widgetAi.openAiModel);
  const assets = config.widgetAi.enabled
    ? await (input.dependencies?.selectLiveV2Assets ?? selectLiveV2ApprovedAssets)()
    : undefined;
  let catalogSnapshot: CatalogIndexSnapshot | undefined;
  if (config.widgetAi.enabled) {
    try {
      catalogSnapshot = await (
        input.dependencies?.loadCatalogIndex ?? loadPinnedCatalogIndex
      )();
    } catch {
      reportLiveV2ObservabilityDiagnostic(input.onSanitizedDiagnostic, {
        code: "catalog_snapshot_unavailable",
        stage: "startup",
        fieldClass: "catalog_snapshot"
      });
    }
  }
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
            : {}),
          ...(input.onSanitizedDiagnostic
            ? { onSanitizedDiagnostic: input.onSanitizedDiagnostic }
            : {})
        })
      : undefined;

  return {
    enabled: config.widgetAi.enabled,
    runRepository,
    ...(assets
      ? {
          directLiveV2: {
            generator,
            modelName: config.widgetAi.openAiModel,
            approvedFacts: assets.factsSnapshot,
            ...(catalogSnapshot ? { catalogSnapshot } : {})
          }
        }
      : {}),
    jobWorker: config.widgetAi.jobWorker
  };
}
