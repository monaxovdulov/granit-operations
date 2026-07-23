import { createManagerAuth, type ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import type { CatalogKnowledgePort } from "./modules/ai/catalog/catalog-knowledge-port.js";
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
import type { IntakeRepository } from "./modules/conversations/repositories/intake-repository.js";
import { PublicIntakeService } from "./modules/intake/use-cases/public-intake-service.js";
import type { PublicWidgetAiReplyGenerator } from "./modules/intake/ports/public-widget-ai-reply-generator.js";
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

export type WidgetAiAssemblyOptions = {
  enabled: boolean;
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
  jobWorker?: {
    enabled: boolean;
    pollIntervalMs: number;
    leaseMs: number;
    retryBackoffMs: number;
    maxAttempts: number;
  };
};

export function buildAppContext(options: AppContextOptions) {
  const managerAuth = createManagerAuth(options.managerAuth);
  const widgetAiReplyGenerator = buildWidgetAiReplyGenerator(
    options.widgetAi,
    options.repository
  );
  const publicIntake = {
    siteForm: new PublicIntakeService(options.repository),
    siteWidget: new PublicWidgetIntakeService(options.repository, {
      ai: options.widgetAi
        ? {
            enabled: options.widgetAi.enabled,
            replyGenerator: widgetAiReplyGenerator,
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

function buildWidgetAiReplyGenerator(
  options: WidgetAiAssemblyOptions | undefined,
  repository: IntakeRepository
): PublicWidgetAiReplyGenerator | undefined {
  if (!options?.enabled) {
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
