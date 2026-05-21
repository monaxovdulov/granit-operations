import type { FastifyInstance } from "fastify";

import type { ManagerAuthRuntime, RequestWithManager } from "../auth/manager-auth.js";
import type { IntakeRepository } from "../repositories/intake-repository.js";

export function registerManagerAuthRoutes(
  app: FastifyInstance,
  auth: ManagerAuthRuntime,
  repository?: IntakeRepository
) {
  app.get("/auth/yandex/start", async (request, reply) => auth.handleYandexStart(request, reply));

  app.get("/auth/yandex/callback", async (request, reply) =>
    auth.handleYandexCallback(request, reply)
  );

  app.post("/auth/logout", async (request, reply) => auth.handleLogout(request, reply));

  app.get("/manager/me", { preHandler: auth.requireManagerSession }, async (request) => {
    const user = (request as RequestWithManager).managerUser;

    return {
      user,
      telegramBinding:
        user && repository
          ? await repository.getManagerTelegramBindingStatus(user.id)
          : { bound: false }
    };
  });

  app.post("/manager/me/telegram-bind-token", { preHandler: auth.requireManagerSession }, async (request, reply) => {
    const user = (request as RequestWithManager).managerUser;

    if (!user) {
      return reply.code(401).send({ error: "manager_auth_required" });
    }

    if (!repository) {
      return reply.code(503).send({ error: "manager_telegram_binding_unavailable" });
    }

    if (user.role === "viewer") {
      return reply.code(403).send({ error: "manager_forbidden" });
    }

    const bindToken = await repository.createManagerTelegramBindToken({
      managerUserId: user.id,
      managerEmail: user.email,
      managerRole: user.role
    });

    return { bindToken };
  });
}
