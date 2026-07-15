import { and, asc, inArray, lte } from "drizzle-orm";

import { aiRunSpans, type OperationsDb } from "@granit/db";

import type {
  AiRunSpanCleanupBatchInput,
  AiRunSpanCleanupBatchResult,
  AiRunSpanRetentionRepository
} from "./ai-run-span-retention.js";
import {
  AI_RUN_SPAN_CLEANUP_MAX_BATCH_SIZE,
  AI_RUN_SPAN_CLEANUP_MIN_BATCH_SIZE,
  AiRunSpanRetentionInputError
} from "./ai-run-span-retention.js";

/** Deletes only explicitly selected expired ai_run_spans; it never mutates their parent runs. */
export class PostgresAiRunSpanRetentionRepository implements AiRunSpanRetentionRepository {
  constructor(private readonly db: OperationsDb) {}

  async cleanupExpiredBatch(
    input: AiRunSpanCleanupBatchInput
  ): Promise<AiRunSpanCleanupBatchResult> {
    if (
      !(input.cutoff instanceof Date) ||
      !Number.isFinite(input.cutoff.getTime()) ||
      !Number.isInteger(input.batchSize) ||
      input.batchSize < AI_RUN_SPAN_CLEANUP_MIN_BATCH_SIZE ||
      input.batchSize > AI_RUN_SPAN_CLEANUP_MAX_BATCH_SIZE ||
      typeof input.dryRun !== "boolean"
    ) {
      throw new AiRunSpanRetentionInputError();
    }

    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: aiRunSpans.id })
        .from(aiRunSpans)
        .where(lte(aiRunSpans.expiresAt, input.cutoff))
        .orderBy(asc(aiRunSpans.expiresAt), asc(aiRunSpans.id))
        .limit(input.batchSize + 1);
      const selectedIds = candidates.slice(0, input.batchSize).map((row) => row.id);
      const hasMore = candidates.length > input.batchSize;

      if (input.dryRun || selectedIds.length === 0) {
        return { matched: selectedIds.length, deleted: 0, hasMore };
      }

      const deleted = await tx
        .delete(aiRunSpans)
        .where(
          and(
            inArray(aiRunSpans.id, selectedIds),
            lte(aiRunSpans.expiresAt, input.cutoff)
          )
        )
        .returning({ id: aiRunSpans.id });

      return {
        matched: selectedIds.length,
        deleted: deleted.length,
        hasMore
      };
    });
  }
}
