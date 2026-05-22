import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { loadConfig } from "../config.js";
import { PostgresTelegramDeliveryRepository } from "../repositories/telegram-delivery-repository.js";
import { tryAcquirePostgresAdvisoryLock } from "../services/postgres-advisory-lock.js";
import {
  TelegramBotApiDeliveryProvider,
  TelegramMessageDeliveryService
} from "../services/telegram-delivery-service.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);

if (!config.telegramBot.providerAccountId) {
  throw new Error("TELEGRAM_BOT_PROVIDER_ACCOUNT_ID is required for Telegram delivery");
}

if (!config.telegramBot.token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram delivery");
}

const telegramDeliveryAdvisoryLockKey = [0x4752414e, 0x54475231] as const;
const { client, db } = createOperationsDb(config.databaseUrl);
const abortController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  log("warn", "telegram_delivery_once_shutdown_requested", { reason: signal });
  abortController.abort();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

try {
  log("info", "telegram_delivery_once_started", {
    batch_size: config.telegramDelivery.batchSize,
    provider_timeout_ms: config.telegramDelivery.providerTimeoutMs,
    processing_stale_ms: config.telegramDelivery.processingStaleMs
  });

  const lock = await tryAcquirePostgresAdvisoryLock(client, telegramDeliveryAdvisoryLockKey);

  if (!lock.acquired) {
    log("info", "telegram_delivery_lock_busy");
    process.exitCode = 0;
  } else {
    try {
      log("info", "telegram_delivery_lock_acquired");

      const service = new TelegramMessageDeliveryService(
        new PostgresTelegramDeliveryRepository(db),
        new TelegramBotApiDeliveryProvider(config.telegramBot.token, {
          timeoutMs: config.telegramDelivery.providerTimeoutMs
        }),
        {
          providerAccountId: config.telegramBot.providerAccountId,
          batchSize: config.telegramDelivery.batchSize,
          maxAttempts: config.telegramDelivery.maxAttempts,
          retryBackoffMs: config.telegramDelivery.retryBackoffMs,
          processingStaleMs: config.telegramDelivery.processingStaleMs
        }
      );
      const result = await service.deliverPendingBatch(config.telegramDelivery.batchSize, {
        signal: abortController.signal
      });

      log("info", "telegram_delivery_once_finished", result);
      console.log(JSON.stringify(result));
    } finally {
      await lock.release();
      log("info", "telegram_delivery_lock_released");
    }
  }
} catch (error) {
  log("error", "telegram_delivery_once_failed", normalizeScriptError(error));
  process.exitCode = 1;
} finally {
  process.off("SIGTERM", shutdown);
  process.off("SIGINT", shutdown);
  await client.end();
}

function log(level: "info" | "warn" | "error", event: string, metadata?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    event,
    ...metadata
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}

function normalizeScriptError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSecrets(truncate(error.message, 500))
    };
  }

  return {
    name: "UnknownError",
    message: "unknown Telegram delivery one-shot error"
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
