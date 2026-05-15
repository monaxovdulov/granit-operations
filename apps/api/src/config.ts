import type { ManagerAuthConfig } from "./auth/manager-auth.js";

export type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  widgetAi: {
    enabled: boolean;
    openAiApiKey?: string;
    openAiModel: string;
  };
  managerAuth: ManagerAuthConfig | null;
};

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the operations API");
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number.parseInt(env.PORT ?? "3001", 10),
    databaseUrl,
    widgetAi: {
      enabled: env.AI_WIDGET_ENABLED === "true",
      openAiApiKey: env.OPENAI_API_KEY,
      openAiModel: env.OPENAI_MODEL ?? "gpt-5.5"
    },
    managerAuth: loadManagerAuthConfig(env)
  };
}

function loadManagerAuthConfig(env: NodeJS.ProcessEnv): ManagerAuthConfig | null {
  const yandexClientId = env.YANDEX_OAUTH_CLIENT_ID;
  const yandexClientSecret = env.YANDEX_OAUTH_CLIENT_SECRET;
  const yandexRedirectUri = env.YANDEX_OAUTH_REDIRECT_URI;
  const sessionSecret = env.SESSION_SECRET;

  if (!yandexClientId || !yandexClientSecret || !yandexRedirectUri || !sessionSecret) {
    return null;
  }

  return {
    yandexClientId,
    yandexClientSecret,
    yandexRedirectUri,
    sessionSecret,
    cookieSecure: env.NODE_ENV !== "development" && env.NODE_ENV !== "test"
  };
}
