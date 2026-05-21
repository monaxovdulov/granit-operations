import { setDefaultResultOrder } from "node:dns";

import { createOperationsDb } from "@granit/db";

import { loadConfig } from "../config.js";
import { PostgresTelegramDeliveryRepository } from "../repositories/telegram-delivery-repository.js";
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

const { client, db } = createOperationsDb(config.databaseUrl);

try {
  const service = new TelegramMessageDeliveryService(
    new PostgresTelegramDeliveryRepository(db),
    new TelegramBotApiDeliveryProvider(config.telegramBot.token),
    {
      providerAccountId: config.telegramBot.providerAccountId,
      batchSize: 10,
      maxAttempts: 3
    }
  );
  const result = await service.deliverPendingBatch();

  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
