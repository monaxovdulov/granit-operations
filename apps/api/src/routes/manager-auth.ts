import type { FastifyInstance } from "fastify";

import type { ManagerAuthRuntime, RequestWithManager } from "../auth/manager-auth.js";

export function registerManagerAuthRoutes(app: FastifyInstance, auth: ManagerAuthRuntime) {
  app.get("/auth/yandex/start", async (request, reply) => auth.handleYandexStart(request, reply));

  app.get("/auth/yandex/callback", async (request, reply) =>
    auth.handleYandexCallback(request, reply)
  );

  app.post("/auth/logout", async (request, reply) => auth.handleLogout(request, reply));

  app.get("/manager/me", { preHandler: auth.requireManagerSession }, async (request) => {
    const user = (request as RequestWithManager).managerUser;

    return { user };
  });
}
