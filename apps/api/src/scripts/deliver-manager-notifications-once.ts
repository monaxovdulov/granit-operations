import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { loadConfig } from "../config.js";
import { TelegramBotApiDeliveryProvider } from "../modules/delivery/adapters/telegram-bot-api-delivery-provider.js";
import { tryAcquirePostgresAdvisoryLock } from "../modules/delivery/services/postgres-advisory-lock.js";
import { PostgresManagerNotificationOutboxRepository } from "../modules/manager-notifications/repositories/manager-notification-outbox-repository.js";
import { ManagerNotificationSenderService } from "../modules/manager-notifications/services/manager-notification-sender-service.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);

if (!config.telegramBot.providerAccountId) {
  throw new Error("TELEGRAM_BOT_PROVIDER_ACCOUNT_ID is required for manager notifications");
}

if (!config.telegramBot.token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for manager notifications");
}

const managerNotificationAdvisoryLockKey = [0x4752414e, 0x4d4e4f31] as const;
const { client, db } = createOperationsDb(config.databaseUrl);
const abortController = new AbortController();
const shutdown = (signal: NodeJS.Signals) => {
  log("warn", "manager_notification_sender_once_shutdown_requested", { reason: signal });
  abortController.abort();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

try {
  log("info", "manager_notification_sender_once_started", {
    batch_size: config.telegramDelivery.batchSize,
    provider_timeout_ms: config.telegramDelivery.providerTimeoutMs
  });

  const lock = await tryAcquirePostgresAdvisoryLock(client, managerNotificationAdvisoryLockKey);

  if (!lock.acquired) {
    log("info", "manager_notification_sender_lock_busy");
    process.exitCode = 0;
  } else {
    try {
      log("info", "manager_notification_sender_lock_acquired");

      const service = new ManagerNotificationSenderService(
        new PostgresManagerNotificationOutboxRepository(db),
        new TelegramBotApiDeliveryProvider(config.telegramBot.token, {
          timeoutMs: config.telegramDelivery.providerTimeoutMs
        }),
        {
          providerAccountId: config.telegramBot.providerAccountId,
          batchSize: config.telegramDelivery.batchSize,
          maxAttempts: config.telegramDelivery.maxAttempts,
          retryBackoffMs: config.telegramDelivery.retryBackoffMs
        }
      );
      const result = await service.deliverPendingBatch(config.telegramDelivery.batchSize, {
        signal: abortController.signal
      });

      log("info", "manager_notification_sender_once_finished", result);
      console.log(JSON.stringify(result));
    } finally {
      await lock.release();
      log("info", "manager_notification_sender_lock_released");
    }
  }
} catch (error) {
  log("error", "manager_notification_sender_once_failed", normalizeScriptError(error));
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
      message: redactSensitiveText(truncate(error.message, 500))
    };
  }

  return {
    name: "UnknownError",
    message: "unknown manager notification sender one-shot error"
  };
}

function redactSensitiveText(value: string) {
  return value
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/g, "$1<redacted>@")
    .replace(/(["']?chat[_-]?id["']?\s*[:=]\s*)-?\d+/gi, "$1<redacted>");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
