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
import { WidgetAiJobWorker } from "./modules/intake/services/widget-ai-job-worker.js";
import { registerTelegramRoutes } from "./modules/telegram/inbound/routes/telegram-routes.js";
import type { TelegramBotServiceOptions } from "./modules/telegram/inbound/telegram-bot-service.js";

export type BuildApiOptions = {
  repository: IntakeRepository;
  widgetAi?: WidgetAiAssemblyOptions;
  publicIntakeCors?: {
    allowedOrigins: string[];
  };
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

  registerPublicIntakeRoutes(app, context.publicIntake, {
    cors: options.publicIntakeCors
  });
  registerManagerAuthRoutes(app, context.managerAuth, context.managerTelegram);
  registerManagerShellRoutes(app, options.managerShell);
  registerManagerRoutes(app, context.managerLeads, context.managerAuth);
  registerTelegramRoutes(app, context.telegramWebhook);

  if (
    options.widgetAi?.runtimeMode !== "mastra_openai_api" &&
    options.widgetAi?.jobWorker?.enabled
  ) {
    const abortController = new AbortController();
    const worker = new WidgetAiJobWorker(
      options.repository,
      context.publicIntake.siteWidget,
      {
        ...options.widgetAi.jobWorker,
        onError: (error) => {
          app.log.error({ err: error }, "site widget AI job worker iteration failed");
        }
      }
    );
    let workerRun: Promise<void> | undefined;

    app.addHook("onReady", () => {
      workerRun = worker.run(abortController.signal).catch((error: unknown) => {
        app.log.error({ err: error }, "site widget AI job worker stopped unexpectedly");
      });
    });
    app.addHook("onClose", async () => {
      abortController.abort();
      await workerRun;
    });
  }

  return app;
}
