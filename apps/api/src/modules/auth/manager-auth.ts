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
} from "./repositories/manager-auth-repository.js";

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
  authenticateSession: (input: AuthenticateManagerSessionInput) => Promise<AuthenticatedManager | null>;
  startYandexLogin: (input: ManagerYandexStartInput) => Promise<ManagerYandexStartResult>;
  completeYandexCallback: (
    input: ManagerYandexCallbackInput
  ) => Promise<ManagerYandexCallbackResult>;
  logout: (input: ManagerLogoutInput) => Promise<ManagerLogoutResult>;
};

export type AuthenticateManagerSessionInput = {
  cookieHeader?: string;
};

export type ManagerYandexStartInput = {
  returnTo?: string;
};

export type ManagerYandexStartResult =
  | {
      status: "redirect";
      location: string;
      setCookie: string;
    }
  | {
      status: "not_configured";
    };

export type ManagerYandexCallbackInput = {
  cookieHeader?: string;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

export type ManagerYandexCallbackResult =
  | {
      status: "redirect";
      location: string;
      setCookies: [string, string];
    }
  | {
      status: "oauth_denied";
      setCookie: string;
      errorDescription?: string;
    }
  | {
      status: "invalid_oauth_state";
      setCookie: string;
    }
  | {
      status: "oauth_unavailable";
      setCookie: string;
    }
  | {
      status: "access_denied";
      setCookie: string;
      reason: "not_allowed" | "disabled" | "identity_conflict";
    }
  | {
      status: "not_configured";
    };

export type ManagerLogoutInput = {
  cookieHeader?: string;
};

export type ManagerLogoutResult = {
  status: "logged_out";
  setCookie: string;
};

type OAuthStatePayload = SignedCookiePayload & {
  state: string;
  codeVerifier: string;
  returnTo: string;
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

  async function authenticateSession(
    input: AuthenticateManagerSessionInput
  ): Promise<AuthenticatedManager | null> {
    const token = parseCookies(input.cookieHeader)[MANAGER_SESSION_COOKIE];

    if (!token) {
      return null;
    }

    return authOptions.repository.findManagerSession(hashSessionToken(token), now());
  }

  return {
    configured: true,
    authenticateSession,
    async startYandexLogin(input) {
      const state = createOpaqueToken();
      const codeVerifier = createOpaqueToken();
      const returnTo = sanitizeReturnTo(input.returnTo);
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

      return {
        status: "redirect",
        location: authorizationUrl,
        setCookie: serializeCookie(
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
      };
    },
    async completeYandexCallback(input) {
      const clearOAuthStateCookie = expiredCookie(
        MANAGER_OAUTH_STATE_COOKIE,
        "/auth/yandex",
        authOptions
      );

      if (input.error) {
        return {
          status: "oauth_denied",
          setCookie: clearOAuthStateCookie,
          errorDescription: input.errorDescription
        };
      }

      const oauthState = readSignedCookieValue<OAuthStatePayload>(
        parseCookies(input.cookieHeader)[MANAGER_OAUTH_STATE_COOKIE],
        authOptions.config.sessionSecret,
        oauthStateTtlSeconds * 1000,
        now()
      );

      if (!input.code || !input.state || !oauthState || oauthState.state !== input.state) {
        return {
          status: "invalid_oauth_state",
          setCookie: clearOAuthStateCookie
        };
      }

      const profile = await fetchYandexProfileForCallback(yandexOAuthClient, {
        code: input.code,
        codeVerifier: oauthState.codeVerifier
      });

      if (!profile) {
        return {
          status: "oauth_unavailable",
          setCookie: clearOAuthStateCookie
        };
      }

      const loginResult = await authOptions.repository.completeYandexLogin(profile);

      if (!loginResult.ok) {
        return {
          status: "access_denied",
          setCookie: clearOAuthStateCookie,
          reason: loginResult.reason
        };
      }

      const sessionToken = createOpaqueToken();
      const expiresAt = new Date(now().getTime() + sessionTtlSeconds * 1000);
      await authOptions.repository.createManagerSession({
        managerUserId: loginResult.user.id,
        sessionTokenHash: hashSessionToken(sessionToken),
        expiresAt
      });

      return {
        status: "redirect",
        location: oauthState.returnTo,
        setCookies: [
          clearOAuthStateCookie,
          serializeCookie(MANAGER_SESSION_COOKIE, sessionToken, {
          path: "/",
          maxAgeSeconds: sessionTtlSeconds,
          httpOnly: true,
          secure: authOptions.config.cookieSecure,
          sameSite: "Lax"
          })
        ]
      };
    },
    async logout(input) {
      const token = parseCookies(input.cookieHeader)[MANAGER_SESSION_COOKIE];

      if (token) {
        await authOptions.repository.revokeManagerSession(hashSessionToken(token), now());
      }

      return {
        status: "logged_out",
        setCookie: expiredCookie(MANAGER_SESSION_COOKIE, "/", authOptions)
      };
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
  async function authenticateSession() {
    return null;
  }

  return {
    configured: false,
    authenticateSession,
    async startYandexLogin() {
      return { status: "not_configured" };
    },
    async completeYandexCallback() {
      return { status: "not_configured" };
    },
    async logout() {
      return {
        status: "logged_out",
        setCookie: serializeCookie(MANAGER_SESSION_COOKIE, "", {
          path: "/",
          maxAgeSeconds: 0,
          expires: new Date(0),
          httpOnly: true,
          secure: true,
          sameSite: "Lax"
        })
      };
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
