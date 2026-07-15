import { createManagerAuth, type ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import {
  loadApprovedAiAssetManifest,
  type ApprovedAiAssetManifest
} from "./modules/ai/assets/approved-ai-assets.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import {
  isRecordedSiteWidgetAiGateRepository,
  isRecordedSiteWidgetAiReplyRepository,
  type RecordedSiteWidgetAiReplyRepository
} from "./modules/ai/repositories/recorded-site-widget-ai-reply-repository.js";
import {
  MastraLiveV2DecisionGenerator,
  type MastraLiveV2AgentPort,
  type ObservedLiveV2DecisionGenerator
} from "./modules/ai/adapters/mastra-live-v2-decision-generator.js";
import {
  MASTRA_OPENAI_MODEL,
  MASTRA_OPENAI_REASONING_EFFORT
} from "./config.js";
import {
  parseLiveV2FactsSnapshot,
  type LiveV2FactsSnapshot
} from "./modules/ai/profiles/live-v2/live-v2-assets.js";
import { RecordedLegacyS05TurnService } from "./modules/ai/services/recorded-legacy-s05-turn-service.js";
import { BoundRecordedLegacyS05TurnService } from "./modules/ai/services/bound-recorded-legacy-s05-turn-service.js";
import { RecordedLiveV2TurnService } from "./modules/ai/services/recorded-live-v2-turn-service.js";
import { RecordedPublicWidgetAiTurnExecutor } from "./modules/ai/services/recorded-public-widget-ai-turn-executor.js";
import { WidgetAiService, type WidgetAiProvider } from "./modules/ai/services/widget-ai-service.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";
import type { IntakeRepository } from "./modules/conversations/repositories/intake-repository.js";
import { PublicIntakeService } from "./modules/intake/use-cases/public-intake-service.js";
import type { PublicWidgetAiReplyGenerator } from "./modules/intake/ports/public-widget-ai-reply-generator.js";
import { isPublicWidgetManagerReviewRepository } from "./modules/intake/ports/public-widget-manager-review-repository.js";
import { PublicWidgetIntakeService } from "./modules/intake/use-cases/public-widget-intake-service.js";
import { ManagerLeadUseCases } from "./modules/manager/use-cases/manager-lead-use-cases.js";
import { ManagerTelegramBindingUseCases } from "./modules/manager/use-cases/manager-telegram-use-cases.js";
import {
  TelegramBotService,
  type TelegramBotServiceOptions
} from "./modules/telegram/inbound/telegram-bot-service.js";
import { RepositoryTelegramInboundUseCases } from "./modules/telegram/inbound/use-cases/telegram-inbound-use-cases.js";

export type AppContextOptions = {
  repository: IntakeRepository;
  widgetAi?: WidgetAiAssemblyOptions;
  managerAuth?: ManagerAuthOptions;
  telegramBot?: TelegramBotServiceOptions;
};

type DirectWidgetAiAssemblyOptions = {
  enabled: boolean;
  runtimeMode?: "direct_openai";
  provider?: WidgetAiProvider;
  modelName?: string;
  replyGenerator?: PublicWidgetAiReplyGenerator;
  runRepository?: AiRunRepository;
};

type MastraLocalFakeWidgetAiAssemblyOptions = {
  enabled: boolean;
  runtimeMode: "mastra_openai_api";
  runRepository?: AiRunRepository;
  localFake: {
    agent: MastraLiveV2AgentPort;
    modelName: string;
    approvedFacts: LiveV2FactsSnapshot;
  };
};

type MastraStagingOpenAiWidgetAiAssemblyOptions = {
  enabled: boolean;
  runtimeMode: "mastra_openai_api";
  runRepository?: AiRunRepository;
  stagingOpenAi: {
    generator: ObservedLiveV2DecisionGenerator;
    modelName: typeof MASTRA_OPENAI_MODEL;
    approvedFacts: LiveV2FactsSnapshot;
  };
};

export type WidgetAiAssemblyOptions =
  | DirectWidgetAiAssemblyOptions
  | MastraLocalFakeWidgetAiAssemblyOptions
  | MastraStagingOpenAiWidgetAiAssemblyOptions;

export function buildAppContext(options: AppContextOptions) {
  const approvedAiAssets = loadApprovedAiAssetManifest();
  const managerAuth = createManagerAuth(options.managerAuth);
  const widgetAiReplyGenerator = buildWidgetAiReplyGenerator(options.widgetAi);
  const widgetAiTurnExecutor = buildWidgetAiTurnExecutor(
    options.repository,
    options.widgetAi,
    widgetAiReplyGenerator,
    approvedAiAssets
  );
  const publicIntake = {
    siteForm: new PublicIntakeService(options.repository),
    siteWidget: new PublicWidgetIntakeService(options.repository, {
      managerReviewRepository: isPublicWidgetManagerReviewRepository(options.repository)
        ? options.repository
        : undefined,
      ai: options.widgetAi
        ? {
            enabled: options.widgetAi.enabled,
            replyGenerator: widgetAiReplyGenerator,
            turnExecutor: widgetAiTurnExecutor
          }
        : undefined
    })
  };
  const managerLeads = new ManagerLeadUseCases(options.repository);
  const managerTelegram = new ManagerTelegramBindingUseCases(options.repository);
  const telegramInboundUseCases = new RepositoryTelegramInboundUseCases(options.repository);
  const telegramWebhook = new TelegramBotService(
    telegramInboundUseCases,
    options.telegramBot ?? { enabled: false }
  );

  return {
    repository: options.repository,
    managerAuth,
    publicIntake,
    managerLeads,
    managerTelegram,
    telegramInboundUseCases,
    telegramWebhook
  };
}

export type AppContext = ReturnType<typeof buildAppContext>;

function buildWidgetAiReplyGenerator(
  options?: WidgetAiAssemblyOptions
): PublicWidgetAiReplyGenerator | undefined {
  if (!options?.enabled || options.runtimeMode === "mastra_openai_api") {
    return undefined;
  }

  if (options.modelName !== undefined && !isSafeWidgetAiModelName(options.modelName)) {
    return undefined;
  }

  if (options.replyGenerator) {
    return options.replyGenerator;
  }

  return new WidgetAiService({
    provider: options.provider,
    modelName: options.modelName
  });
}

function buildWidgetAiTurnExecutor(
  repository: IntakeRepository,
  options: WidgetAiAssemblyOptions | undefined,
  generator: PublicWidgetAiReplyGenerator | undefined,
  approvedAiAssets: ApprovedAiAssetManifest
) {
  if (!options?.enabled || !isRecordedSiteWidgetAiReplyRepository(repository)) {
    return undefined;
  }

  const runRepository = options.runRepository ?? asAiRunRepository(repository);

  if (!runRepository) {
    if (
      options.runtimeMode === "mastra_openai_api" &&
      "stagingOpenAi" in options
    ) {
      throw new Error("M3 staging Mastra runtime requires an app-owned run repository");
    }
    return undefined;
  }

  switch (options.runtimeMode) {
    case undefined:
    case "direct_openai":
      return buildDirectWidgetAiTurnExecutor(
        repository,
        options,
        generator,
        runRepository,
        approvedAiAssets
      );
    case "mastra_openai_api":
      return buildMastraLiveV2WidgetAiTurnExecutor(
        repository,
        options,
        runRepository,
        approvedAiAssets
      );
    default:
      return assertNeverRuntime(options);
  }
}

function buildDirectWidgetAiTurnExecutor(
  repository: IntakeRepository & RecordedSiteWidgetAiReplyRepository,
  options: DirectWidgetAiAssemblyOptions,
  generator: PublicWidgetAiReplyGenerator | undefined,
  runRepository: AiRunRepository,
  approvedAiAssets: ApprovedAiAssetManifest
) {
  if (!generator) {
    return undefined;
  }

  const requestedModelName =
    options.modelName ?? (options.replyGenerator ? "injected_generator" : "gpt-5.5");

  if (!isSafeWidgetAiModelName(requestedModelName)) {
    return undefined;
  }
  const configuredModelProvider = options.replyGenerator
    ? "fake"
    : options.provider?.providerKind ?? "openai";
  const legacyAssets = approvedAiAssets.legacyS05;
  const turnService = new RecordedLegacyS05TurnService({
    repository: runRepository,
    versions: {
      policyVersion: legacyAssets.policyVersion,
      promptVersion: legacyAssets.promptVersion,
      toolVersion: legacyAssets.toolVersion,
      assetVersion: legacyAssets.assetVersion,
      disclosureVersion: legacyAssets.disclosureVersion,
      modelProfileVersion: legacyAssets.modelProfileVersion,
      runtimeVersion: `node.v${process.versions.node}`
    },
    model: {
      modelProvider: configuredModelProvider,
      requestedModelName,
      reasoningEffort: configuredModelProvider === "openai" ? "low" : "none"
    }
  });

  return new RecordedPublicWidgetAiTurnExecutor(
    new BoundRecordedLegacyS05TurnService(turnService, generator),
    repository
  );
}

function buildMastraLiveV2WidgetAiTurnExecutor(
  repository: IntakeRepository & RecordedSiteWidgetAiReplyRepository,
  options:
    | MastraLocalFakeWidgetAiAssemblyOptions
    | MastraStagingOpenAiWidgetAiAssemblyOptions,
  runRepository: AiRunRepository,
  approvedAiAssets: ApprovedAiAssetManifest
) {
  if (!isRecordedSiteWidgetAiGateRepository(repository)) {
    if ("stagingOpenAi" in options) {
      throw new Error("M3 staging Mastra runtime requires an app-owned send gate repository");
    }
    return undefined;
  }

  const liveAssets = approvedAiAssets.liveV2;
  const hasLocalFake = "localFake" in options && options.localFake !== undefined;
  const hasStagingOpenAi =
    "stagingOpenAi" in options && options.stagingOpenAi !== undefined;

  if (hasLocalFake === hasStagingOpenAi) {
    throw new Error("Mastra runtime requires exactly one trusted runtime boundary");
  }

  let boundary: {
    generator: ObservedLiveV2DecisionGenerator;
    modelProvider: "fake" | "openai";
    modelName: string;
    reasoningEffort: "none" | typeof MASTRA_OPENAI_REASONING_EFFORT;
    approvedFacts: LiveV2FactsSnapshot;
  };

  if (hasLocalFake) {
    const localFake = (options as MastraLocalFakeWidgetAiAssemblyOptions).localFake;
    boundary = {
      generator: new MastraLiveV2DecisionGenerator(
        localFake.agent,
        "fake",
        localFake.modelName
      ),
      modelProvider: "fake",
      modelName: localFake.modelName,
      reasoningEffort: "none",
      approvedFacts: localFake.approvedFacts
    };
  } else {
    const stagingOpenAi = (
      options as MastraStagingOpenAiWidgetAiAssemblyOptions
    ).stagingOpenAi;
    boundary = {
      generator: stagingOpenAi.generator,
      modelProvider: "openai",
      modelName: stagingOpenAi.modelName,
      reasoningEffort: MASTRA_OPENAI_REASONING_EFFORT,
      approvedFacts: stagingOpenAi.approvedFacts
    };
  }

  if (
    hasStagingOpenAi &&
    boundary.modelName !== MASTRA_OPENAI_MODEL
  ) {
    throw new Error(`M3 staging Mastra model must be ${MASTRA_OPENAI_MODEL}`);
  }

  if (!isSafeWidgetAiModelName(boundary.modelName)) {
    return undefined;
  }

  const approvedFacts = parseLiveV2FactsSnapshot(boundary.approvedFacts);
  const turnService = new RecordedLiveV2TurnService({
    repository: runRepository,
    gateRepository: repository,
    generator: boundary.generator,
    approvedFacts,
    versions: {
      policyVersion: liveAssets.policyVersion,
      promptVersion: liveAssets.promptVersion,
      toolVersion: liveAssets.toolVersion,
      assetVersion: liveAssets.assetVersion,
      toneVersion: liveAssets.toneVersion,
      factsVersion: liveAssets.factsVersion,
      disclosureVersion: liveAssets.disclosureVersion,
      modelProfileVersion: liveAssets.modelProfileVersion,
      runtimeVersion: `node.v${process.versions.node}`
    },
    model: {
      modelProvider: boundary.modelProvider,
      requestedModelName: boundary.modelName,
      reasoningEffort: boundary.reasoningEffort
    }
  });

  return new RecordedPublicWidgetAiTurnExecutor(turnService, repository);
}

function assertNeverRuntime(value: never): never {
  throw new Error(`Unsupported AI runtime mode: ${String(value)}`);
}

function asAiRunRepository(value: unknown): AiRunRepository | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("beginOrReplay" in value) ||
    !("completeWithoutReply" in value) ||
    typeof value.beginOrReplay !== "function" ||
    typeof value.completeWithoutReply !== "function"
  ) {
    return undefined;
  }

  return value as AiRunRepository;
}
