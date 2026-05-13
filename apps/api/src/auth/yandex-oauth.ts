import type { YandexManagerProfile } from "../repositories/manager-auth-repository.js";

export type YandexOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
};

export type BuildYandexAuthorizationUrlInput = {
  state: string;
  codeChallenge: string;
};

export type ExchangeYandexCodeInput = {
  code: string;
  codeVerifier: string;
};

export interface YandexOAuthClient {
  buildAuthorizationUrl(input: BuildYandexAuthorizationUrlInput): string;
  exchangeCodeForToken(input: ExchangeYandexCodeInput): Promise<string>;
  fetchProfile(accessToken: string): Promise<YandexManagerProfile>;
}

export class DefaultYandexOAuthClient implements YandexOAuthClient {
  constructor(private readonly config: YandexOAuthConfig) {}

  buildAuthorizationUrl(input: BuildYandexAuthorizationUrlInput): string {
    const url = new URL("https://oauth.yandex.com/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("scope", this.config.scope);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");

    return url.toString();
  }

  async exchangeCodeForToken(input: ExchangeYandexCodeInput): Promise<string> {
    const response = await fetchWithRetry("https://oauth.yandex.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code_verifier: input.codeVerifier
      })
    });

    const body = (await response.json()) as { access_token?: unknown; error?: unknown };

    if (!response.ok || typeof body.access_token !== "string") {
      throw new Error(`Yandex OAuth token exchange failed: ${String(body.error ?? response.status)}`);
    }

    return body.access_token;
  }

  async fetchProfile(accessToken: string): Promise<YandexManagerProfile> {
    const response = await fetchWithRetry("https://login.yandex.ru/info?format=json", {
      headers: {
        Authorization: `OAuth ${accessToken}`
      }
    });

    const body = (await response.json()) as {
      id?: unknown;
      default_email?: unknown;
      login?: unknown;
      display_name?: unknown;
    };

    if (!response.ok || typeof body.id !== "string" || typeof body.default_email !== "string") {
      throw new Error("Yandex ID profile response did not include required id/default_email fields");
    }

    return {
      yandexUid: body.id,
      email: body.default_email,
      login: typeof body.login === "string" ? body.login : undefined,
      displayName: typeof body.display_name === "string" ? body.display_name : undefined
    };
  }
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  const attempts = 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(10_000)
      });
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  throw lastError;
}
