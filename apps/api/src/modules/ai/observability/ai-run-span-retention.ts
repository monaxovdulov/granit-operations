export const AI_RUN_SPAN_CLEANUP_MIN_BATCH_SIZE = 1;
export const AI_RUN_SPAN_CLEANUP_MAX_BATCH_SIZE = 1000;
export const AI_RUN_SPAN_CLEANUP_MAX_BATCHES = 100;

export type AiRunSpanCleanupBatchInput = {
  cutoff: Date;
  batchSize: number;
  dryRun: boolean;
};

export type AiRunSpanCleanupBatchResult = {
  matched: number;
  deleted: number;
  hasMore: boolean;
};

export interface AiRunSpanRetentionRepository {
  cleanupExpiredBatch(
    input: AiRunSpanCleanupBatchInput
  ): Promise<AiRunSpanCleanupBatchResult>;
}

export type AiRunSpanCleanupOptions = {
  cutoff?: Date;
  batchSize?: number;
  maxBatches?: number;
  dryRun?: boolean;
};

export type AiRunSpanCleanupResult = {
  dryRun: boolean;
  cutoff: Date;
  batchSize: number;
  maxBatches: number;
  batches: number;
  matched: number;
  deleted: number;
  hasMore: boolean;
};

export class AiRunSpanRetentionInputError extends Error {
  constructor(message = "invalid AI run span cleanup options") {
    super(message);
    this.name = "AiRunSpanRetentionInputError";
  }
}

export class AiRunSpanRetentionService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: AiRunSpanRetentionRepository,
    options: { clock?: () => Date } = {}
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async cleanupExpired(options: AiRunSpanCleanupOptions = {}): Promise<AiRunSpanCleanupResult> {
    const now = checkedDate(this.clock());
    const cutoff = checkedDate(options.cutoff ?? now);
    const batchSize = checkedInteger(
      options.batchSize ?? 100,
      AI_RUN_SPAN_CLEANUP_MIN_BATCH_SIZE,
      AI_RUN_SPAN_CLEANUP_MAX_BATCH_SIZE
    );
    const maxBatches = checkedInteger(
      options.maxBatches ?? 1,
      1,
      AI_RUN_SPAN_CLEANUP_MAX_BATCHES
    );
    const dryRun = options.dryRun ?? true;

    if (typeof dryRun !== "boolean") {
      throw new AiRunSpanRetentionInputError();
    }
    if (cutoff.getTime() > now.getTime()) {
      throw new AiRunSpanRetentionInputError("cleanup cutoff cannot be in the future");
    }

    let batches = 0;
    let matched = 0;
    let deleted = 0;
    let hasMore = false;

    do {
      const batch = await this.repository.cleanupExpiredBatch({
        cutoff,
        batchSize,
        dryRun
      });
      assertBatchResult(batch, batchSize, dryRun);
      batches += 1;
      matched += batch.matched;
      deleted += batch.deleted;
      hasMore = batch.hasMore;

      // A dry-run must not select the same unchanged rows repeatedly. A zero-delete apply batch
      // also stops to avoid spinning during a concurrent cleanup race.
      if (dryRun || !hasMore || batch.deleted === 0) {
        break;
      }
    } while (batches < maxBatches);

    return {
      dryRun,
      cutoff: new Date(cutoff.getTime()),
      batchSize,
      maxBatches,
      batches,
      matched,
      deleted,
      hasMore
    };
  }
}

export function parseAiRunSpanCleanupArgs(argv: readonly string[]): AiRunSpanCleanupOptions {
  let dryRun = true;
  let batchSize = 100;
  let maxBatches = 1;
  let cutoff: Date | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--apply":
        dryRun = false;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--batch-size":
        batchSize = parseIntegerArgument(argv[++index], arg);
        break;
      case "--max-batches":
        maxBatches = parseIntegerArgument(argv[++index], arg);
        break;
      case "--cutoff":
        cutoff = parseDateArgument(argv[++index], arg);
        break;
      default:
        throw new AiRunSpanRetentionInputError(`unknown cleanup argument: ${arg ?? ""}`);
    }
  }

  return {
    dryRun,
    batchSize: checkedInteger(
      batchSize,
      AI_RUN_SPAN_CLEANUP_MIN_BATCH_SIZE,
      AI_RUN_SPAN_CLEANUP_MAX_BATCH_SIZE
    ),
    maxBatches: checkedInteger(maxBatches, 1, AI_RUN_SPAN_CLEANUP_MAX_BATCHES),
    ...(cutoff ? { cutoff } : {})
  };
}

function assertBatchResult(
  result: AiRunSpanCleanupBatchResult,
  batchSize: number,
  dryRun: boolean
): void {
  if (
    !Number.isInteger(result.matched) ||
    result.matched < 0 ||
    result.matched > batchSize ||
    !Number.isInteger(result.deleted) ||
    result.deleted < 0 ||
    result.deleted > result.matched ||
    typeof result.hasMore !== "boolean" ||
    (dryRun && result.deleted !== 0)
  ) {
    throw new AiRunSpanRetentionInputError("invalid AI run span cleanup repository result");
  }
}

function checkedDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AiRunSpanRetentionInputError();
  }
  return new Date(value.getTime());
}

function checkedInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AiRunSpanRetentionInputError();
  }
  return value;
}

function parseIntegerArgument(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new AiRunSpanRetentionInputError(`${name} requires an integer`);
  }
  return Number(value);
}

function parseDateArgument(value: string | undefined, name: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new AiRunSpanRetentionInputError(`${name} requires an ISO timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AiRunSpanRetentionInputError(`${name} requires an ISO timestamp`);
  }
  return parsed;
}
