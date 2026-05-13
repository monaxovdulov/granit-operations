import type { FastifyReply, FastifyRequest } from "fastify";

import { parseCookies, serializeCookie } from "./cookies.js";
import {
  createCodeChallenge,
  createOpaqueToken,
  createSignedCookieValue,
  hashSessionToken,
  MANAGER_OAUTH_STATE_COOKIE,
  MANAGER_SESSION_COOKIE,
  readSignedCookieValue,
  type SignedCookiePayload
} from "./session.js";
import { DefaultYandexOAuthClient, type YandexOAuthClient } from "./yandex-oauth.js";
import type {
  AuthenticatedManager,
  ManagerAuthRepository
} from "../repositories/manager-auth-repository.js";

const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_OAUTH_STATE_TTL_SECONDS = 10 * 60;
const YANDEX_EMAIL_SCOPE = "login:email";

export type ManagerAuthConfig = {
  yandexClientId: string;
  yandexClientSecret: string;
  yandexRedirectUri: string;
  sessionSecret: string;
  cookieSecure: boolean;
  sessionTtlSeconds?: number;
  oauthStateTtlSeconds?: number;
};

export type ManagerAuthOptions = {
  repository: ManagerAuthRepository;
  config: ManagerAuthConfig;
  yandexOAuthClient?: YandexOAuthClient;
  now?: () => Date;
};

export type ManagerAuthRuntime = {
  configured: boolean;
  requireManagerSession: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  authenticateRequest: (request: FastifyRequest) => Promise<AuthenticatedManager | null>;
  handleYandexStart: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
  handleYandexCallback: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
  handleLogout: (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply>;
};

export type RequestWithManager = FastifyRequest & {
  managerUser?: AuthenticatedManager;
};

type OAuthStatePayload = SignedCookiePayload & {
  state: string;
  codeVerifier: string;
  returnTo: string;
};

type AuthStartQuery = {
  return_to?: string;
};

type AuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

export function createManagerAuth(options?: ManagerAuthOptions): ManagerAuthRuntime {
  if (!options) {
    return createDisabledManagerAuth();
  }

  const authOptions = options;
  const now = authOptions.now ?? (() => new Date());
  const sessionTtlSeconds = authOptions.config.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const oauthStateTtlSeconds =
    authOptions.config.oauthStateTtlSeconds ?? DEFAULT_OAUTH_STATE_TTL_SECONDS;
  const yandexOAuthClient =
    authOptions.yandexOAuthClient ??
    new DefaultYandexOAuthClient({
      clientId: authOptions.config.yandexClientId,
      clientSecret: authOptions.config.yandexClientSecret,
      redirectUri: authOptions.config.yandexRedirectUri,
      scope: YANDEX_EMAIL_SCOPE
    });

  async function authenticateRequest(request: FastifyRequest): Promise<AuthenticatedManager | null> {
    const token = parseCookies(request.headers.cookie)[MANAGER_SESSION_COOKIE];

    if (!token) {
      return null;
    }

    return authOptions.repository.findManagerSession(hashSessionToken(token), now());
  }

  return {
    configured: true,
    authenticateRequest,
    async requireManagerSession(request, reply) {
      const user = await authenticateRequest(request);

      if (!user) {
        await reply.code(401).send({ error: "manager_auth_required" });
        return;
      }

      (request as RequestWithManager).managerUser = user;
    },
    async handleYandexStart(request, reply) {
      const query = request.query as AuthStartQuery;
      const state = createOpaqueToken();
      const codeVerifier = createOpaqueToken();
      const returnTo = sanitizeReturnTo(query.return_to);
      const payload: OAuthStatePayload = {
        state,
        codeVerifier,
        returnTo,
        createdAt: now().toISOString()
      };
      const authorizationUrl = yandexOAuthClient.buildAuthorizationUrl({
        state,
        codeChallenge: createCodeChallenge(codeVerifier)
      });

      reply.header(
        "set-cookie",
        serializeCookie(
          MANAGER_OAUTH_STATE_COOKIE,
          createSignedCookieValue(payload, authOptions.config.sessionSecret),
          {
            path: "/auth/yandex",
            maxAgeSeconds: oauthStateTtlSeconds,
            httpOnly: true,
            secure: authOptions.config.cookieSecure,
            sameSite: "Lax"
          }
        )
      );

      return reply.redirect(authorizationUrl);
    },
    async handleYandexCallback(request, reply) {
      const query = request.query as AuthCallbackQuery;
      const clearOAuthStateCookie = expiredCookie(
        MANAGER_OAUTH_STATE_COOKIE,
        "/auth/yandex",
        authOptions
      );

      if (query.error) {
        reply.header("set-cookie", clearOAuthStateCookie);
        return reply.code(401).send({
          error: "yandex_oauth_denied",
          error_description: query.error_description
        });
      }

      const oauthState = readSignedCookieValue<OAuthStatePayload>(
        parseCookies(request.headers.cookie)[MANAGER_OAUTH_STATE_COOKIE],
        authOptions.config.sessionSecret,
        oauthStateTtlSeconds * 1000,
        now()
      );

      if (!query.code || !query.state || !oauthState || oauthState.state !== query.state) {
        reply.header("set-cookie", clearOAuthStateCookie);
        return reply.code(400).send({ error: "invalid_oauth_state" });
      }

      const profile = await fetchYandexProfileForCallback(yandexOAuthClient, {
        code: query.code,
        codeVerifier: oauthState.codeVerifier
      });

      if (!profile) {
        reply.header("set-cookie", clearOAuthStateCookie);
        return reply.code(502).send({ error: "yandex_oauth_unavailable" });
      }

      const loginResult = await authOptions.repository.completeYandexLogin(profile);

      if (!loginResult.ok) {
        reply.header("set-cookie", clearOAuthStateCookie);
        return reply.code(403).send({
          error: "manager_access_denied",
          reason: loginResult.reason
        });
      }

      const sessionToken = createOpaqueToken();
      const expiresAt = new Date(now().getTime() + sessionTtlSeconds * 1000);
      await authOptions.repository.createManagerSession({
        managerUserId: loginResult.user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt
      });

      reply.header("set-cookie", [
        clearOAuthStateCookie,
        serializeCookie(MANAGER_SESSION_COOKIE, sessionToken, {
          path: "/",
          maxAgeSeconds: sessionTtlSeconds,
          httpOnly: true,
          secure: authOptions.config.cookieSecure,
          sameSite: "Lax"
        })
      ]);

      return reply.redirect(oauthState.returnTo);
    },
    async handleLogout(request, reply) {
      const token = parseCookies(request.headers.cookie)[MANAGER_SESSION_COOKIE];

      if (token) {
        await authOptions.repository.revokeManagerSession(hashSessionToken(token), now());
      }

      reply.header("set-cookie", expiredCookie(MANAGER_SESSION_COOKIE, "/", authOptions));
      return reply.code(204).send();
    }
  };
}

async function fetchYandexProfileForCallback(
  yandexOAuthClient: YandexOAuthClient,
  input: { code: string; codeVerifier: string }
) {
  try {
    const accessToken = await yandexOAuthClient.exchangeCodeForToken(input);

    return await yandexOAuthClient.fetchProfile(accessToken);
  } catch {
    return null;
  }
}

function createDisabledManagerAuth(): ManagerAuthRuntime {
  async function authenticateRequest() {
    return null;
  }

  return {
    configured: false,
    authenticateRequest,
    async requireManagerSession(_request, reply) {
      await reply.code(401).send({ error: "manager_auth_required" });
    },
    async handleYandexStart(_request, reply) {
      return reply.code(503).send({
        error: "manager_auth_not_configured"
      });
    },
    async handleYandexCallback(_request, reply) {
      return reply.code(503).send({
        error: "manager_auth_not_configured"
      });
    },
    async handleLogout(_request, reply) {
      reply.header(
        "set-cookie",
        serializeCookie(MANAGER_SESSION_COOKIE, "", {
          path: "/",
          maxAgeSeconds: 0,
          expires: new Date(0),
          httpOnly: true,
          secure: true,
          sameSite: "Lax"
        })
      );
      return reply.code(204).send();
    }
  };
}

function expiredCookie(
  name: string,
  path: string,
  options: Pick<ManagerAuthOptions, "config">
): string {
  return serializeCookie(name, "", {
    path,
    maxAgeSeconds: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: options.config.cookieSecure,
    sameSite: "Lax"
  });
}

function sanitizeReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/manager";
  }

  return value;
}
