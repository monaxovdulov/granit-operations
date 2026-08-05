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
import type { ObservedLiveV2DecisionGenerator } from "./modules/ai/ports/live-v2-runtime.js";
import { LiveV2GenerationError } from "./modules/ai/ports/live-v2-runtime.js";
import { DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT } from "./config.js";
import {
  MODEL_TURN_MODEL_PROFILE_VERSION,
  MODEL_TURN_PROMPT_VERSION
} from "./modules/ai/profiles/live-v2/model-turn-contract.js";
import {
  parseLiveV2FactsSnapshot,
  type LiveV2FactsSnapshot
} from "./modules/ai/profiles/live-v2/live-v2-assets.js";
import { RecordedLiveV2TurnService } from "./modules/ai/services/recorded-live-v2-turn-service.js";
import { RecordedPublicWidgetAiTurnExecutor } from "./modules/ai/services/recorded-public-widget-ai-turn-executor.js";
import type { IntakeRepository } from "./modules/conversations/repositories/intake-repository.js";
import { PublicIntakeService } from "./modules/intake/use-cases/public-intake-service.js";
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

type WidgetAiJobWorkerAssemblyOptions = {
  enabled: boolean;
  pollIntervalMs: number;
  leaseMs: number;
  retryBackoffMs: number;
  maxAttempts: number;
  globalConcurrency?: number;
};

export type WidgetAiAssemblyOptions = {
  enabled: boolean;
  runRepository?: AiRunRepository;
  jobWorker?: WidgetAiJobWorkerAssemblyOptions;
  directLiveV2?: {
    generator?: ObservedLiveV2DecisionGenerator;
    modelName: string;
    approvedFacts: LiveV2FactsSnapshot;
  };
};

export function buildAppContext(options: AppContextOptions) {
  const approvedAiAssets = loadApprovedAiAssetManifest();
  const managerAuth = createManagerAuth(options.managerAuth);
  const widgetAiTurnExecutor = buildWidgetAiTurnExecutor(
    options.repository,
    options.widgetAi,
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
            turnExecutor: widgetAiTurnExecutor,
            jobMaxAttempts: options.widgetAi.jobWorker?.maxAttempts
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

function buildWidgetAiTurnExecutor(
  repository: IntakeRepository,
  options: WidgetAiAssemblyOptions | undefined,
  approvedAiAssets: ApprovedAiAssetManifest
) {
  if (!options?.enabled || !isRecordedSiteWidgetAiReplyRepository(repository)) {
    return undefined;
  }

  const runRepository = options.runRepository ?? asAiRunRepository(repository);

  if (!runRepository) return undefined;

  return buildDirectWidgetAiTurnExecutor(
    repository,
    options,
    runRepository,
    approvedAiAssets
  );
}

function buildDirectWidgetAiTurnExecutor(
  repository: IntakeRepository & RecordedSiteWidgetAiReplyRepository,
  options: WidgetAiAssemblyOptions,
  runRepository: AiRunRepository,
  approvedAiAssets: ApprovedAiAssetManifest
) {
  if (!options.directLiveV2) return undefined;

  if (!isRecordedSiteWidgetAiGateRepository(repository)) {
    throw new Error("Direct live_v2 runtime requires an app-owned send gate repository");
  }

  const liveAssets = approvedAiAssets.liveV2;
  const generator =
    options.directLiveV2.generator ??
    ({
      async generateDecision() {
        throw new LiveV2GenerationError(undefined, "auth_or_entitlement");
      }
    } satisfies ObservedLiveV2DecisionGenerator);
  const turnService = new RecordedLiveV2TurnService({
    repository: runRepository,
    gateRepository: repository,
    generator,
    approvedFacts: parseLiveV2FactsSnapshot(options.directLiveV2.approvedFacts),
    turnContract: "model_turn_v1",
    versions: {
      policyVersion: liveAssets.policyVersion,
      promptVersion: MODEL_TURN_PROMPT_VERSION,
      toolVersion: liveAssets.toolVersion,
      assetVersion: liveAssets.assetVersion,
      toneVersion: liveAssets.toneVersion,
      factsVersion: liveAssets.factsVersion,
      disclosureVersion: liveAssets.disclosureVersion,
      modelProfileVersion: MODEL_TURN_MODEL_PROFILE_VERSION,
      runtimeVersion: `node.v${process.versions.node}`
    },
    model: {
      modelProvider: options.directLiveV2.generator ? "openai" : "none",
      requestedModelName: options.directLiveV2.modelName,
      reasoningEffort: DIRECT_LIVE_V2_OPENAI_REASONING_EFFORT
    }
  });

  return new RecordedPublicWidgetAiTurnExecutor(turnService, repository);
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
