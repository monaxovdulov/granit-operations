import type {
  TelegramDeliveryBatchResult,
  TelegramMessageDeliveryService
} from "./telegram-delivery-service.js";

export type TelegramDeliveryWorkerService = Pick<
  TelegramMessageDeliveryService,
  "deliverPendingBatch"
>;

export type TelegramDeliveryWorkerLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export type TelegramDeliveryWorkerOptions = {
  batchSize: number;
  pollIntervalMs: number;
  errorBackoffMs: number;
  logger?: TelegramDeliveryWorkerLogger;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const noopLogger: TelegramDeliveryWorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export class TelegramDeliveryWorker {
  private stopReason: string | null = null;

  constructor(
    private readonly service: TelegramDeliveryWorkerService,
    private readonly options: TelegramDeliveryWorkerOptions
  ) {}

  requestStop(reason: string) {
    if (!this.stopReason) {
      this.stopReason = reason;
      this.logger.info("telegram_delivery_worker_shutdown_requested", { reason });
    }
  }

  async run(input: { signal?: AbortSignal } = {}): Promise<void> {
    const signal = input.signal;

    this.logger.info("telegram_delivery_worker_started", {
      batch_size: this.options.batchSize,
      poll_interval_ms: this.options.pollIntervalMs,
      error_backoff_ms: this.options.errorBackoffMs
    });

    try {
      while (!this.shouldStop(signal)) {
        const delayMs = await this.runTick(signal);

        if (!this.shouldStop(signal)) {
          await this.sleep(delayMs, signal);
        }
      }
    } finally {
      this.logger.info("telegram_delivery_worker_stopped", {
        reason: this.stopReason ?? (signal?.aborted ? "abort_signal" : "completed")
      });
    }
  }

  private async runTick(signal?: AbortSignal) {
    try {
      const result = await this.service.deliverPendingBatch(this.options.batchSize, { signal });

      this.logger.info("telegram_delivery_worker_tick", resultToLogMetadata(result));

      return this.options.pollIntervalMs;
    } catch (error) {
      this.logger.error("telegram_delivery_worker_tick_failed", normalizeWorkerError(error));

      return this.options.errorBackoffMs;
    }
  }

  private shouldStop(signal?: AbortSignal) {
    return Boolean(this.stopReason || signal?.aborted);
  }

  private get logger() {
    return this.options.logger ?? noopLogger;
  }

  private sleep(ms: number, signal?: AbortSignal) {
    return (this.options.sleep ?? sleep)(ms, signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolveAndCleanup, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      resolveAndCleanup();
    };

    function resolveAndCleanup() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resultToLogMetadata(result: TelegramDeliveryBatchResult) {
  return {
    claimed: result.claimed,
    sent: result.sent,
    retrying: result.retrying,
    failed: result.failed,
    blocked: result.blocked,
    uncertain: result.uncertain
  };
}

function normalizeWorkerError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(truncate(error.message, 500))
    };
  }

  return {
    name: "UnknownError",
    message: "unknown Telegram delivery worker error"
  };
}

function redactSecrets(value: string) {
  return value
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1<redacted>@");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
