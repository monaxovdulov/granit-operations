import { createManagerAuth, type ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import type { CatalogKnowledgePort } from "./modules/ai/catalog/catalog-knowledge-port.js";
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
import {
  GroundedWidgetAiService,
  type GroundedWidgetAiProvider
} from "./modules/ai/services/grounded-widget-ai-service.js";
import {
  ShadowWidgetAiReplyGenerator,
  type WidgetAiShadowObservationSink
} from "./modules/ai/services/shadow-widget-ai-reply-generator.js";
import { WidgetAiService, type WidgetAiProvider } from "./modules/ai/services/widget-ai-service.js";
import type { WidgetAiSemanticVerifier } from "./modules/ai/verification/widget-ai-semantic-verifier.js";
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
  groundedMode?: "off" | "shadow" | "enforce";
  provider?: WidgetAiProvider;
  groundedProvider?: GroundedWidgetAiProvider;
  verifier?: WidgetAiSemanticVerifier;
  catalog?: CatalogKnowledgePort;
  modelName?: string;
  verifierModelName?: string;
  deadlineMs?: number;
  shadowObservationSink?: WidgetAiShadowObservationSink;
  replyGenerator?: PublicWidgetAiReplyGenerator;
  runRepository?: AiRunRepository;
  jobWorker?: {
    enabled: boolean;
    pollIntervalMs: number;
    leaseMs: number;
    retryBackoffMs: number;
    maxAttempts: number;
  };
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
  const widgetAiReplyGenerator = buildWidgetAiReplyGenerator(
    options.widgetAi,
    options.repository
  );
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
            turnExecutor: widgetAiTurnExecutor,
            requiresRecordedExecutor: widgetAiRequiresRecordedExecutor(options.widgetAi),
            jobMaxAttempts:
              options.widgetAi.runtimeMode === "mastra_openai_api"
                ? undefined
                : options.widgetAi.jobWorker?.maxAttempts
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

function widgetAiRequiresRecordedExecutor(options: WidgetAiAssemblyOptions): boolean {
  if (!options.enabled || options.runtimeMode === "mastra_openai_api") {
    return options.enabled && options.runtimeMode === "mastra_openai_api";
  }

  if (options.modelName !== undefined && !isSafeWidgetAiModelName(options.modelName)) {
    return true;
  }

  return Boolean(options.replyGenerator) || !options.provider;
}

function buildWidgetAiReplyGenerator(
  options: WidgetAiAssemblyOptions | undefined,
  repository: IntakeRepository
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

  const mode =
    options.groundedMode ??
    (options.groundedProvider && options.verifier ? "enforce" : "off");
  const grounded =
    mode !== "off" && options.groundedProvider && options.verifier
      ? new GroundedWidgetAiService({
          provider: options.groundedProvider,
          verifier: options.verifier,
          catalog: options.catalog,
          modelName: options.modelName,
          verifierModelName: options.verifierModelName,
          deadlineMs: options.deadlineMs
        })
      : undefined;

  if (mode === "enforce") {
    return grounded;
  }

  const legacy = options.provider
    ? new WidgetAiService({
        provider: options.provider,
        modelName: options.modelName
      })
    : undefined;

  if (mode === "shadow" && grounded) {
    const sink =
      options.shadowObservationSink ??
      (repository.recordSiteWidgetAiShadowComparison
        ? {
            record: (observation) =>
              repository.recordSiteWidgetAiShadowComparison!(observation)
          }
        : undefined);
    return legacy ? new ShadowWidgetAiReplyGenerator(legacy, grounded, sink) : grounded;
  }

  return legacy;
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
  if (options.provider && !options.replyGenerator) {
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
  const effectiveGenerator =
    generator ??
    ({
      async generateReply() {
        return {
          decision: "no_reply" as const,
          reason: "missing_openai_config" as const,
          metadata: { model_provider: "none" }
        };
      }
    } satisfies PublicWidgetAiReplyGenerator);
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
    new BoundRecordedLegacyS05TurnService(turnService, effectiveGenerator),
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
