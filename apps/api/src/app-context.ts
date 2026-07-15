import { createManagerAuth, type ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import type { AiRunRepository } from "./modules/ai/repositories/ai-run-repository.js";
import { isRecordedSiteWidgetAiReplyRepository } from "./modules/ai/repositories/recorded-site-widget-ai-reply-repository.js";
import { WIDGET_AI_POLICY_VERSION } from "./modules/ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "./modules/ai/prompts/widget-ai-prompt.js";
import { RecordedLegacyS05TurnService } from "./modules/ai/services/recorded-legacy-s05-turn-service.js";
import { RecordedPublicWidgetAiTurnExecutor } from "./modules/ai/services/recorded-public-widget-ai-turn-executor.js";
import { WidgetAiService, type WidgetAiProvider } from "./modules/ai/services/widget-ai-service.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";
import type { IntakeRepository } from "./modules/conversations/repositories/intake-repository.js";
import { PublicIntakeService } from "./modules/intake/use-cases/public-intake-service.js";
import {
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator
} from "./modules/intake/ports/public-widget-ai-reply-generator.js";
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

export type WidgetAiAssemblyOptions = {
  enabled: boolean;
  provider?: WidgetAiProvider;
  modelName?: string;
  replyGenerator?: PublicWidgetAiReplyGenerator;
  runRepository?: AiRunRepository;
};

export function buildAppContext(options: AppContextOptions) {
  const managerAuth = createManagerAuth(options.managerAuth);
  const widgetAiReplyGenerator = buildWidgetAiReplyGenerator(options.widgetAi);
  const widgetAiTurnExecutor = buildWidgetAiTurnExecutor(
    options.repository,
    options.widgetAi,
    widgetAiReplyGenerator
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
  if (!options?.enabled) {
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
  generator: PublicWidgetAiReplyGenerator | undefined
) {
  if (!options?.enabled || !generator || !isRecordedSiteWidgetAiReplyRepository(repository)) {
    return undefined;
  }

  const runRepository = options.runRepository ?? asAiRunRepository(repository);

  if (!runRepository) {
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
  const turnService = new RecordedLegacyS05TurnService({
    repository: runRepository,
    versions: {
      policyVersion: WIDGET_AI_POLICY_VERSION,
      promptVersion: WIDGET_AI_PROMPT_VERSION,
      toolVersion: "granit_ai_tools.none.v1",
      disclosureVersion: WIDGET_AI_DISCLOSURE_VERSION,
      modelProfileVersion: "granit_widget_ai_direct.s05.v1",
      runtimeVersion: `node.v${process.versions.node}`
    },
    model: {
      modelProvider: configuredModelProvider,
      requestedModelName,
      reasoningEffort: configuredModelProvider === "openai" ? "low" : "none"
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
