import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresIntakeRepository } from "./repositories/postgres-intake-repository.js";
import { PostgresManagerAuthRepository } from "./repositories/postgres-manager-auth-repository.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);
const { db } = createOperationsDb(config.databaseUrl);
const repository = new PostgresIntakeRepository(db);
const managerAuthRepository = new PostgresManagerAuthRepository(db);
const app = buildApi({
  repository,
  logger: true,
  managerAuth: config.managerAuth
    ? {
        repository: managerAuthRepository,
        config: config.managerAuth
      }
    : undefined
});

await app.listen({ host: config.host, port: config.port });
