import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { loadConfig } from "../config.js";
import { PostgresTelegramDeliveryRepository } from "../repositories/telegram-delivery-repository.js";
import {
  TelegramBotApiDeliveryProvider,
  TelegramMessageDeliveryService
} from "../services/telegram-delivery-service.js";
import {
  TelegramDeliveryWorker,
  type TelegramDeliveryWorkerLogger
} from "../services/telegram-delivery-worker.js";

setDefaultResultOrder("ipv4first");

const config = loadConfig(process.env);

if (!config.telegramBot.providerAccountId) {
  throw new Error("TELEGRAM_BOT_PROVIDER_ACCOUNT_ID is required for Telegram delivery worker");
}

if (!config.telegramBot.token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram delivery worker");
}

const { client, db } = createOperationsDb(config.databaseUrl);
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
const worker = new TelegramDeliveryWorker(service, {
  batchSize: config.telegramDelivery.batchSize,
  pollIntervalMs: config.telegramDelivery.pollIntervalMs,
  errorBackoffMs: config.telegramDelivery.retryBackoffMs,
  logger: createJsonConsoleLogger()
});
const abortController = new AbortController();

const shutdown = (signal: NodeJS.Signals) => {
  worker.requestStop(signal);
  abortController.abort();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

try {
  await worker.run({ signal: abortController.signal });
} finally {
  process.off("SIGTERM", shutdown);
  process.off("SIGINT", shutdown);
  await client.end();
}

function createJsonConsoleLogger(): TelegramDeliveryWorkerLogger {
  return {
    info: (message, metadata) => log("info", message, metadata),
    warn: (message, metadata) => log("warn", message, metadata),
    error: (message, metadata) => log("error", message, metadata)
  };
}

function log(level: "info" | "warn" | "error", message: string, metadata?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    event: message,
    ...metadata
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}
