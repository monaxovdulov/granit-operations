import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { OpenAiWidgetAssistantProvider } from "./modules/ai/adapters/openai-widget-assistant-provider.js";
import { PostgresAiRunRepository } from "./modules/ai/repositories/postgres-ai-run-repository.js";
import { isSafeWidgetAiModelName } from "./modules/ai/widget-ai-model-name.js";
import { PostgresManagerAuthRepository } from "./modules/auth/repositories/postgres-manager-auth-repository.js";
import { PostgresIntakeRepository } from "./modules/conversations/repositories/postgres-intake-repository.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);

if (config.widgetAi.runtimeMode === "mastra_openai_api") {
  throw new Error(
    "AI_RUNTIME_MODE=mastra_openai_api is disabled until exact-SHA G6 owner approval"
  );
}

const { db } = createOperationsDb(config.databaseUrl);
const repository = new PostgresIntakeRepository(db);
const aiRunRepository = new PostgresAiRunRepository(db);
const managerAuthRepository = new PostgresManagerAuthRepository(db);
const widgetAiModelIsSafe = isSafeWidgetAiModelName(config.widgetAi.openAiModel);
const widgetAiProvider = config.widgetAi.openAiApiKey && widgetAiModelIsSafe
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
    runtimeMode: "direct_openai",
    provider: widgetAiProvider,
    modelName: config.widgetAi.openAiModel,
    runRepository: aiRunRepository
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
