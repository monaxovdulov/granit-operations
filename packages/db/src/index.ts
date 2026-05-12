import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./schema.js";

export function createOperationsDb(connectionString: string) {
  const client = postgres(connectionString, { max: 5 });
  const db = drizzle(client, { schema });

  return { client, db };
}

export type OperationsDb = ReturnType<typeof createOperationsDb>["db"];
