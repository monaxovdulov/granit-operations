import type { ManagerAuthConfig } from "./modules/auth/manager-auth.js";

export const AI_RUNTIME_MODES = ["direct_openai", "mastra_openai_api"] as const;
export type AiRuntimeMode = (typeof AI_RUNTIME_MODES)[number];

export const DEPLOYMENT_TIERS = [
  "local",
  "test",
  "staging",
  "production",
  "unknown"
] as const;
export type DeploymentTier = (typeof DEPLOYMENT_TIERS)[number];

export const MASTRA_OPENAI_MODEL = "gpt-5.6-sol" as const;
export const MASTRA_OPENAI_REASONING_EFFORT = "medium" as const;

export type ApiConfig = {
  host: string;
  port: number;
  databaseUrl: string;
  deploymentTier: DeploymentTier;
  widgetAi: {
    enabled: boolean;
    runtimeMode: AiRuntimeMode;
    openAiApiKey?: string;
    openAiModel: string;
    mastra: {
      openAiApiKey?: string;
      model: typeof MASTRA_OPENAI_MODEL;
      reasoningEffort: typeof MASTRA_OPENAI_REASONING_EFFORT;
      traceExportEnabled: false;
      telemetryDisabled: boolean;
      autoRefreshProviders: boolean;
    };
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

  const deploymentTier = parseStrictEnum(
    "DEPLOYMENT_TIER",
    env.DEPLOYMENT_TIER,
    DEPLOYMENT_TIERS,
    "unknown"
  );
  const runtimeMode = parseStrictEnum(
    "AI_RUNTIME_MODE",
    env.AI_RUNTIME_MODE,
    AI_RUNTIME_MODES,
    "direct_openai"
  );
  const traceExportEnabled = parseExactFalse(
    "AI_TRACE_EXPORT_ENABLED",
    env.AI_TRACE_EXPORT_ENABLED
  );
  const mastra = loadMastraConfig(env, runtimeMode, deploymentTier, traceExportEnabled);

  return {
    host: env.HOST ?? "0.0.0.0",
    port: Number.parseInt(env.PORT ?? "3001", 10),
    databaseUrl,
    deploymentTier,
    widgetAi: {
      enabled: env.AI_WIDGET_ENABLED === "true",
      runtimeMode,
      openAiApiKey: env.OPENAI_API_KEY,
      openAiModel: env.OPENAI_MODEL ?? "gpt-5.5",
      mastra
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

function loadMastraConfig(
  env: NodeJS.ProcessEnv,
  runtimeMode: AiRuntimeMode,
  deploymentTier: DeploymentTier,
  traceExportEnabled: false
): ApiConfig["widgetAi"]["mastra"] {
  if (runtimeMode !== "mastra_openai_api") {
    return {
      model: MASTRA_OPENAI_MODEL,
      reasoningEffort: MASTRA_OPENAI_REASONING_EFFORT,
      traceExportEnabled,
      telemetryDisabled: env.MASTRA_TELEMETRY_DISABLED === "true",
      autoRefreshProviders: env.MASTRA_AUTO_REFRESH_PROVIDERS !== "false"
    };
  }

  if (deploymentTier !== "staging") {
    throw new Error("AI_RUNTIME_MODE=mastra_openai_api requires DEPLOYMENT_TIER=staging");
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for AI_RUNTIME_MODE=mastra_openai_api");
  }

  const model = env.MASTRA_OPENAI_MODEL ?? MASTRA_OPENAI_MODEL;

  if (model !== MASTRA_OPENAI_MODEL) {
    throw new Error(`MASTRA_OPENAI_MODEL must be ${MASTRA_OPENAI_MODEL}`);
  }

  const reasoningEffort =
    env.MASTRA_OPENAI_REASONING_EFFORT ?? MASTRA_OPENAI_REASONING_EFFORT;

  if (reasoningEffort !== MASTRA_OPENAI_REASONING_EFFORT) {
    throw new Error(
      `MASTRA_OPENAI_REASONING_EFFORT must be ${MASTRA_OPENAI_REASONING_EFFORT}`
    );
  }

  if (env.MASTRA_TELEMETRY_DISABLED !== "true") {
    throw new Error("MASTRA_TELEMETRY_DISABLED must be true for mastra_openai_api");
  }

  if (env.MASTRA_AUTO_REFRESH_PROVIDERS !== "false") {
    throw new Error("MASTRA_AUTO_REFRESH_PROVIDERS must be false for mastra_openai_api");
  }

  if (env.MASTRA_LICENSE_KEY !== undefined) {
    throw new Error("MASTRA_LICENSE_KEY is not allowed in the first slice");
  }

  if (env.MASTRA_EE_LICENSE !== undefined) {
    throw new Error("MASTRA_EE_LICENSE is not allowed in the first slice");
  }

  return {
    openAiApiKey: env.OPENAI_API_KEY,
    model,
    reasoningEffort,
    traceExportEnabled,
    telemetryDisabled: true,
    autoRefreshProviders: false
  };
}

function parseStrictEnum<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  allowed: T,
  fallback: T[number]
): T[number] {
  if (value === undefined) {
    return fallback;
  }

  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${name} has an unsupported value`);
  }

  return value;
}

function parseExactFalse(name: string, value: string | undefined): false {
  if (value === undefined || value === "false") {
    return false;
  }

  throw new Error(`${name} must be false in the first slice`);
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
