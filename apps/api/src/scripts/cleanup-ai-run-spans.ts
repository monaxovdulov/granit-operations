import { createOperationsDb } from "@granit/db";

import {
  AiRunSpanRetentionService,
  parseAiRunSpanCleanupArgs
} from "../modules/ai/observability/ai-run-span-retention.js";
import { PostgresAiRunSpanRetentionRepository } from "../modules/ai/observability/postgres-ai-run-span-retention-repository.js";

let client: ReturnType<typeof createOperationsDb>["client"] | undefined;

try {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("missing database configuration");
  }
  const options = parseAiRunSpanCleanupArgs(process.argv.slice(2));
  const database = createOperationsDb(databaseUrl);
  client = database.client;
  const result = await new AiRunSpanRetentionService(
    new PostgresAiRunSpanRetentionRepository(database.db)
  ).cleanupExpired(options);

  console.log(
    JSON.stringify({
      ok: true,
      dry_run: result.dryRun,
      cutoff: result.cutoff.toISOString(),
      batch_size: result.batchSize,
      max_batches: result.maxBatches,
      batches: result.batches,
      matched: result.matched,
      deleted: result.deleted,
      has_more: result.hasMore
    })
  );
} catch {
  console.error(
    JSON.stringify({
      ok: false,
      error: "ai_run_span_cleanup_failed"
    })
  );
  process.exitCode = 1;
} finally {
  await client?.end({ timeout: 5 });
}
