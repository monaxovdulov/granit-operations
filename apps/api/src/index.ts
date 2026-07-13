import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresAiRunRepository } from "./modules/ai/repositories/postgres-ai-run-repository.js";
import { PostgresManagerAuthRepository } from "./modules/auth/repositories/postgres-manager-auth-repository.js";
import { PostgresIntakeRepository } from "./modules/conversations/repositories/postgres-intake-repository.js";
import { buildConfiguredWidgetAiAssembly } from "./widget-ai-runtime-assembly.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);

const { db } = createOperationsDb(config.databaseUrl);
const repository = new PostgresIntakeRepository(db);
const aiRunRepository = new PostgresAiRunRepository(db);
const managerAuthRepository = new PostgresManagerAuthRepository(db);
const widgetAi = await buildConfiguredWidgetAiAssembly({
  config,
  runRepository: aiRunRepository
});
const app = buildApi({
  repository,
  logger: true,
  publicIntakeCors: config.publicIntakeCors,
  widgetAi,
  telegramBot: config.telegramBot,
  managerAuth: config.managerAuth
    ? {
        repository: managerAuthRepository,
        config: config.managerAuth
      }
    : undefined
});

await app.listen({ host: config.host, port: config.port });
