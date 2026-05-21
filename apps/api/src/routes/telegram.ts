import type { FastifyInstance } from "fastify";

import type { IntakeRepository } from "../repositories/intake-repository.js";
import { TelegramBotService, type TelegramBotServiceOptions } from "../services/telegram-bot-service.js";

export function registerTelegramRoutes(
  app: FastifyInstance,
  repository: IntakeRepository,
  options: TelegramBotServiceOptions
) {
  const service = new TelegramBotService(repository, options);

  app.post("/telegram/webhook", async (request, reply) => {
    if (!service.enabled) {
      return reply.code(404).send({ error: "telegram_bot_disabled" });
    }

    if (!service.configured) {
      return reply.code(503).send({ error: "telegram_bot_misconfigured" });
    }

    const secret = request.headers["x-telegram-bot-api-secret-token"];

    if (!service.validateSecret(Array.isArray(secret) ? secret[0] : secret)) {
      return reply.code(401).send({ error: "telegram_webhook_secret_invalid" });
    }

    return service.handleUpdate(request.body);
  });
}
