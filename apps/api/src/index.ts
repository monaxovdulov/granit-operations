import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { OpenAiWidgetAssistantProvider } from "./modules/ai/adapters/openai-widget-assistant-provider.js";
import { PostgresManagerAuthRepository } from "./modules/auth/repositories/postgres-manager-auth-repository.js";
import { PostgresIntakeRepository } from "./modules/conversations/repositories/postgres-intake-repository.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);
const { db } = createOperationsDb(config.databaseUrl);
const repository = new PostgresIntakeRepository(db);
const managerAuthRepository = new PostgresManagerAuthRepository(db);
const widgetAiProvider = config.widgetAi.openAiApiKey
  ? new OpenAiWidgetAssistantProvider({
      apiKey: config.widgetAi.openAiApiKey,
      model: config.widgetAi.openAiModel
    })
  : undefined;
const app = buildApi({
  repository,
  logger: true,
  widgetAi: {
    enabled: config.widgetAi.enabled,
    provider: widgetAiProvider,
    modelName: config.widgetAi.openAiModel
  },
  telegramBot: config.telegramBot,
  managerAuth: config.managerAuth
    ? {
        repository: managerAuthRepository,
        config: config.managerAuth
      }
    : undefined
});

await app.listen({ host: config.host, port: config.port });
