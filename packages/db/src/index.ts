import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./schema.js";

export function createOperationsDb(
  connectionString: string,
  options: { searchPath?: string } = {}
) {
  const searchPath = options.searchPath?.trim();
  if (searchPath && !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(searchPath)) {
    throw new Error("DATABASE_SEARCH_PATH must be a comma-separated list of identifiers");
  }
  const client = postgres(connectionString, {
    max: 5,
    ...(searchPath ? { connection: { search_path: searchPath } } : {})
  });
  const db = drizzle(client, { schema });

  return { client, db };
}

export type OperationsDb = ReturnType<typeof createOperationsDb>["db"];
