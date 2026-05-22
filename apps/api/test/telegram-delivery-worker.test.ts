import { describe, expect, it } from "vitest";

import type { TelegramDeliveryBatchResult } from "../src/services/telegram-delivery-service.js";
import {
  TelegramDeliveryWorker,
  type TelegramDeliveryWorkerLogger,
  type TelegramDeliveryWorkerService
} from "../src/services/telegram-delivery-worker.js";

describe("Telegram delivery worker", () => {
  it("runs a batch through the delivery service and waits for the configured poll interval", async () => {
    const service = new FakeDeliveryWorkerService([
      { claimed: 1, sent: 1, retrying: 0, failed: 0, blocked: 0, uncertain: 0 }
    ]);
    const logger = new CapturingLogger();
    const sleeps: number[] = [];
    let worker: TelegramDeliveryWorker;

    worker = new TelegramDeliveryWorker(service, {
      batchSize: 5,
      pollIntervalMs: 1234,
      errorBackoffMs: 9000,
      logger,
      sleep: async (ms) => {
        sleeps.push(ms);
        worker.requestStop("test_done");
      }
    });

    await worker.run();

    expect(service.batchLimits).toEqual([5]);
    expect(service.signals).toEqual([undefined]);
    expect(sleeps).toEqual([1234]);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: "telegram_delivery_worker_tick",
        metadata: { claimed: 1, sent: 1, retrying: 0, failed: 0, blocked: 0, uncertain: 0 }
      })
    );
  });

  it("backs off after an unexpected service error and redacts token-like log text", async () => {
    const service = new FakeDeliveryWorkerService([
      new Error("failed with bot123:secretToken and postgres://user:pass@db/main")
    ]);
    const logger = new CapturingLogger();
    const sleeps: number[] = [];
    let worker: TelegramDeliveryWorker;

    worker = new TelegramDeliveryWorker(service, {
      batchSize: 5,
      pollIntervalMs: 1000,
      errorBackoffMs: 2500,
      logger,
      sleep: async (ms) => {
        sleeps.push(ms);
        worker.requestStop("test_done");
      }
    });

    await worker.run();

    expect(service.batchLimits).toEqual([5]);
    expect(sleeps).toEqual([2500]);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "telegram_delivery_worker_tick_failed",
        metadata: {
          name: "Error",
          message: "failed with bot<redacted> and postgres://<redacted>@db/main"
        }
      })
    );
  });

  it("stops cleanly when the abort signal is raised during sleep", async () => {
    const service = new FakeDeliveryWorkerService([
      { claimed: 0, sent: 0, retrying: 0, failed: 0, blocked: 0, uncertain: 0 }
    ]);
    const logger = new CapturingLogger();
    const abortController = new AbortController();
    const worker = new TelegramDeliveryWorker(service, {
      batchSize: 3,
      pollIntervalMs: 1000,
      errorBackoffMs: 2500,
      logger,
      sleep: async (_ms, signal) => {
        expect(signal).toBe(abortController.signal);
        abortController.abort();
      }
    });

    await worker.run({ signal: abortController.signal });

    expect(service.batchLimits).toEqual([3]);
    expect(service.signals).toEqual([abortController.signal]);
    expect(logger.entries.at(-1)).toEqual({
      level: "info",
      message: "telegram_delivery_worker_stopped",
      metadata: { reason: "abort_signal" }
    });
  });
});

class FakeDeliveryWorkerService implements TelegramDeliveryWorkerService {
  batchLimits: Array<number | undefined> = [];
  signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly results: Array<TelegramDeliveryBatchResult | Error>) {}

  async deliverPendingBatch(
    limit?: number,
    input: { signal?: AbortSignal } = {}
  ): Promise<TelegramDeliveryBatchResult> {
    this.batchLimits.push(limit);
    this.signals.push(input.signal);
    const result = this.results.shift();

    if (result instanceof Error) {
      throw result;
    }

    return result ?? { claimed: 0, sent: 0, retrying: 0, failed: 0, blocked: 0, uncertain: 0 };
  }
}

class CapturingLogger implements TelegramDeliveryWorkerLogger {
  entries: Array<{
    level: "info" | "warn" | "error";
    message: string;
    metadata?: Record<string, unknown>;
  }> = [];

  info(message: string, metadata?: Record<string, unknown>) {
    this.entries.push({ level: "info", message, metadata });
  }

  warn(message: string, metadata?: Record<string, unknown>) {
    this.entries.push({ level: "warn", message, metadata });
  }

  error(message: string, metadata?: Record<string, unknown>) {
    this.entries.push({ level: "error", message, metadata });
  }
}
