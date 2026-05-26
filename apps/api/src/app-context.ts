import { createManagerAuth, type ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import { WidgetAiService, type WidgetAiProvider } from "./modules/ai/services/widget-ai-service.js";
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
  provider?: WidgetAiProvider;
  modelName?: string;
  replyGenerator?: PublicWidgetAiReplyGenerator;
};

export function buildAppContext(options: AppContextOptions) {
  const managerAuth = createManagerAuth(options.managerAuth);
  const widgetAiReplyGenerator = buildWidgetAiReplyGenerator(options.widgetAi);
  const publicIntake = {
    siteForm: new PublicIntakeService(options.repository),
    siteWidget: new PublicWidgetIntakeService(options.repository, {
      ai: options.widgetAi
        ? {
            enabled: options.widgetAi.enabled,
            replyGenerator: widgetAiReplyGenerator
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

  if (options.replyGenerator) {
    return options.replyGenerator;
  }

  if (!options.provider) {
    return undefined;
  }

  return new WidgetAiService({
    provider: options.provider,
    modelName: options.modelName
  });
}
