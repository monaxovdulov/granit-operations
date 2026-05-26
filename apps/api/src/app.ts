import Fastify from "fastify";

import { buildAppContext, type WidgetAiAssemblyOptions } from "./app-context.js";
import type { ManagerAuthOptions } from "./modules/auth/manager-auth.js";
import type { IntakeRepository } from "./modules/conversations/repositories/intake-repository.js";
import { registerManagerAuthRoutes } from "./modules/auth/routes/manager-auth-routes.js";
import {
  registerManagerShellRoutes,
  type ManagerShellOptions
} from "./modules/manager/routes/manager-shell-routes.js";
import { registerManagerRoutes } from "./modules/manager/routes/manager-routes.js";
import { registerPublicIntakeRoutes } from "./modules/intake/routes/public-intake-routes.js";
import { registerTelegramRoutes } from "./modules/telegram/inbound/routes/telegram-routes.js";
import type { TelegramBotServiceOptions } from "./modules/telegram/inbound/telegram-bot-service.js";

export type BuildApiOptions = {
  repository: IntakeRepository;
  widgetAi?: WidgetAiAssemblyOptions;
  managerAuth?: ManagerAuthOptions;
  managerShell?: ManagerShellOptions;
  telegramBot?: TelegramBotServiceOptions;
  logger?: boolean;
};

export function buildApi(options: BuildApiOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const context = buildAppContext({
    repository: options.repository,
    widgetAi: options.widgetAi,
    managerAuth: options.managerAuth,
    telegramBot: options.telegramBot ?? {
      enabled: false
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "granit-operations-api"
  }));

  registerPublicIntakeRoutes(app, context.publicIntake);
  registerManagerAuthRoutes(app, context.managerAuth, context.managerTelegram);
  registerManagerShellRoutes(app, options.managerShell);
  registerManagerRoutes(app, context.managerLeads, context.managerAuth);
  registerTelegramRoutes(app, context.telegramWebhook);

  return app;
}
