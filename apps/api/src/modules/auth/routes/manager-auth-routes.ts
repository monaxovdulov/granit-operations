import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ManagerAuthRuntime } from "../manager-auth.js";
import type { AuthenticatedManager } from "../repositories/manager-auth-repository.js";
import { ManagerForbiddenError } from "../../manager/use-cases/manager-actor.js";
import type { ManagerTelegramBindingUseCases } from "../../manager/use-cases/manager-telegram-use-cases.js";

type AuthStartQuery = {
  return_to?: string;
};

type AuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

export function registerManagerAuthRoutes(
  app: FastifyInstance,
  auth: ManagerAuthRuntime,
  managerTelegram?: ManagerTelegramBindingUseCases
) {
  app.get<{ Querystring: AuthStartQuery }>("/auth/yandex/start", async (request, reply) => {
    const result = await auth.startYandexLogin({ returnTo: request.query.return_to });

    if (result.status === "not_configured") {
      return reply.code(503).send({ error: "manager_auth_not_configured" });
    }

    reply.header("set-cookie", result.setCookie);
    return reply.redirect(result.location);
  });

  app.get<{ Querystring: AuthCallbackQuery }>("/auth/yandex/callback", async (request, reply) => {
    const result = await auth.completeYandexCallback({
      cookieHeader: readCookieHeader(request),
      code: request.query.code,
      state: request.query.state,
      error: request.query.error,
      errorDescription: request.query.error_description
    });

    if (result.status === "not_configured") {
      return reply.code(503).send({ error: "manager_auth_not_configured" });
    }

    if (result.status === "oauth_denied") {
      reply.header("set-cookie", result.setCookie);
      return reply.code(401).send({
        error: "yandex_oauth_denied",
        error_description: result.errorDescription
      });
    }

    if (result.status === "invalid_oauth_state") {
      reply.header("set-cookie", result.setCookie);
      return reply.code(400).send({ error: "invalid_oauth_state" });
    }

    if (result.status === "oauth_unavailable") {
      reply.header("set-cookie", result.setCookie);
      return reply.code(502).send({ error: "yandex_oauth_unavailable" });
    }

    if (result.status === "access_denied") {
      reply.header("set-cookie", result.setCookie);
      return reply.code(403).send({
        error: "manager_access_denied",
        reason: result.reason
      });
    }

    reply.header("set-cookie", result.setCookies);
    return reply.redirect(result.location);
  });

  app.post("/auth/logout", async (request, reply) => {
    const result = await auth.logout({ cookieHeader: readCookieHeader(request) });

    reply.header("set-cookie", result.setCookie);
    return reply.code(204).send();
  });

  app.get("/manager/me", async (request, reply) => {
    const user = await authenticateManager(request, reply, auth);

    if (!user) {
      return;
    }

    return {
      user,
      telegramBinding:
        user && managerTelegram
          ? await managerTelegram.getBindingStatus(user.id)
          : { bound: false }
    };
  });

  app.post(
    "/manager/me/telegram-bind-token",
    async (request, reply) => {
      const user = await authenticateManager(request, reply, auth);

      if (!user) {
        return;
      }

      if (!managerTelegram) {
        return reply.code(503).send({ error: "manager_telegram_binding_unavailable" });
      }

      try {
        const bindToken = await managerTelegram.createBindToken({ actor: user });

        return { bindToken };
      } catch (error) {
        if (error instanceof ManagerForbiddenError) {
          return reply.code(403).send({ error: "manager_forbidden" });
        }

        throw error;
      }
    }
  );
}

async function authenticateManager(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: ManagerAuthRuntime
): Promise<AuthenticatedManager | null> {
  const user = await auth.authenticateSession({ cookieHeader: readCookieHeader(request) });

  if (!user) {
    await reply.code(401).send({ error: "manager_auth_required" });
    return null;
  }

  return user;
}

function readCookieHeader(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;

  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}
