import type { ManagerAuthConfig } from "./modules/auth/manager-auth.js";

export type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  widgetAi: {
    enabled: boolean;
    openAiApiKey?: string;
    openAiModel: string;
  };
  telegramBot: {
    enabled: boolean;
    token?: string;
    providerAccountId?: string;
    webhookSecret?: string;
    publicManagerBaseUrl?: string;
  };
  telegramDelivery: {
    batchSize: number;
    pollIntervalMs: number;
    maxAttempts: number;
    retryBackoffMs: number;
    providerTimeoutMs: number;
    processingStaleMs: number;
  };
  managerAuth: ManagerAuthConfig | null;
};

const telegramDeliveryDefaults = {
  batchSize: 10,
  pollIntervalMs: 5000,
  maxAttempts: 3,
  retryBackoffMs: 60000,
  providerTimeoutMs: 15000,
  processingStaleMs: 300000
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
    telegramBot: {
      enabled: env.TELEGRAM_BOT_ENABLED === "true",
      token: env.TELEGRAM_BOT_TOKEN,
      providerAccountId: env.TELEGRAM_BOT_PROVIDER_ACCOUNT_ID,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
      publicManagerBaseUrl: env.PUBLIC_MANAGER_BASE_URL
    },
    telegramDelivery: {
      batchSize: parseIntegerEnv(env.TELEGRAM_DELIVERY_BATCH_SIZE, {
        fallback: telegramDeliveryDefaults.batchSize,
        min: 1,
        max: 100
      }),
      pollIntervalMs: parseIntegerEnv(env.TELEGRAM_DELIVERY_POLL_INTERVAL_MS, {
        fallback: telegramDeliveryDefaults.pollIntervalMs,
        min: 250,
        max: 600000
      }),
      maxAttempts: parseIntegerEnv(env.TELEGRAM_DELIVERY_MAX_ATTEMPTS, {
        fallback: telegramDeliveryDefaults.maxAttempts,
        min: 1,
        max: 20
      }),
      retryBackoffMs: parseIntegerEnv(env.TELEGRAM_DELIVERY_RETRY_BACKOFF_MS, {
        fallback: telegramDeliveryDefaults.retryBackoffMs,
        min: 0,
        max: 86400000
      }),
      providerTimeoutMs: parseIntegerEnv(env.TELEGRAM_DELIVERY_PROVIDER_TIMEOUT_MS, {
        fallback: telegramDeliveryDefaults.providerTimeoutMs,
        min: 1000,
        max: 120000
      }),
      processingStaleMs: parseIntegerEnv(env.TELEGRAM_DELIVERY_PROCESSING_STALE_MS, {
        fallback: telegramDeliveryDefaults.processingStaleMs,
        min: 60000,
        max: 86400000
      })
    },
    managerAuth: loadManagerAuthConfig(env)
  };
}

function parseIntegerEnv(
  value: string | undefined,
  bounds: { fallback: number; min: number; max: number }
) {
  if (!value) {
    return bounds.fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return bounds.fallback;
  }

  return Math.min(Math.max(parsed, bounds.min), bounds.max);
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
