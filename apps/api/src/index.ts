import { createOperationsDb } from "@granit/db";

import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresIntakeRepository } from "./repositories/postgres-intake-repository.js";

const config = loadConfig(process.env);
const { db } = createOperationsDb(config.databaseUrl);
const repository = new PostgresIntakeRepository(db);
const app = buildApi({ repository, logger: true });

await app.listen({ host: config.host, port: config.port });
