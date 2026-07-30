import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const DATABASE_URL = "postgres://config-test.invalid/granit";

describe("M1 Mastra runtime config", () => {
  it("keeps the direct legacy runtime and unknown deployment tier as safe defaults", () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config.deploymentTier).toBe("unknown");
    expect(config.widgetAi).toMatchObject({
      runtimeMode: "direct_openai",
      openAiModel: "gpt-5.5"
    });
  });

  it.each([
    ["AI_RUNTIME_MODE", { AI_RUNTIME_MODE: "codex_subscription" }],
    ["DEPLOYMENT_TIER", { DEPLOYMENT_TIER: "preview" }]
  ])("rejects an unsupported %s value", (expectedFragment, override) => {
    expect(() => loadConfig({ DATABASE_URL, ...override })).toThrow(expectedFragment);
  });

  it("accepts only the staging Mastra profile and applies its exact safe defaults", () => {
    const config = loadConfig(validMastraEnv());

    expect(config.deploymentTier).toBe("staging");
    expect(config.widgetAi).toMatchObject({
      runtimeMode: "mastra_openai_api",
      openAiModel: "gpt-5.5",
      mastra: {
        openAiApiKey: "m1-config-test-key",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        traceExportEnabled: false,
        telemetryDisabled: true,
        autoRefreshProviders: false
      }
    });
  });

  it("accepts the exact explicitly configured Mastra profile", () => {
    const config = loadConfig(
      validMastraEnv({
        MASTRA_OPENAI_MODEL: "gpt-5.6-sol",
        MASTRA_OPENAI_REASONING_EFFORT: "medium",
        AI_TRACE_EXPORT_ENABLED: "false"
      })
    );

    expect(config.widgetAi.mastra).toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      traceExportEnabled: false
    });
  });

  it.each(["local", "test", "production", "unknown"])(
    "rejects the Mastra runtime in the %s deployment tier",
    (deploymentTier) => {
      expect(() =>
        loadConfig(validMastraEnv({ DEPLOYMENT_TIER: deploymentTier }))
      ).toThrow("DEPLOYMENT_TIER=staging");
    }
  );

  it("requires a server-only OpenAI key for the Mastra runtime", () => {
    const env = validMastraEnv();
    delete env.OPENAI_API_KEY;

    expect(() => loadConfig(env)).toThrow("OPENAI_API_KEY");
  });

  it.each([
    ["MASTRA_OPENAI_MODEL", { MASTRA_OPENAI_MODEL: "gpt-5.5" }],
    ["MASTRA_OPENAI_REASONING_EFFORT", { MASTRA_OPENAI_REASONING_EFFORT: "high" }],
    ["AI_TRACE_EXPORT_ENABLED", { AI_TRACE_EXPORT_ENABLED: "true" }]
  ])("rejects a non-approved %s value", (expectedFragment, override) => {
    expect(() => loadConfig(validMastraEnv(override))).toThrow(expectedFragment);
  });

  it.each([
    ["MASTRA_TELEMETRY_DISABLED", "MASTRA_TELEMETRY_DISABLED"],
    ["MASTRA_AUTO_REFRESH_PROVIDERS", "MASTRA_AUTO_REFRESH_PROVIDERS"]
  ] as const)("requires an explicit safe %s opt-out", (envKey, expectedFragment) => {
    const env = validMastraEnv();
    delete env[envKey];

    expect(() => loadConfig(env)).toThrow(expectedFragment);
  });

  it.each([
    ["MASTRA_TELEMETRY_DISABLED", "false"],
    ["MASTRA_AUTO_REFRESH_PROVIDERS", "true"]
  ] as const)("rejects an unsafe %s value", (envKey, value) => {
    expect(() => loadConfig(validMastraEnv({ [envKey]: value }))).toThrow(envKey);
  });

  it.each(["MASTRA_LICENSE_KEY", "MASTRA_EE_LICENSE"] as const)(
    "rejects enterprise license configuration through %s without leaking its value",
    (envKey) => {
      const secretCanary = `secret-${envKey.toLowerCase()}`;

      expectConfigErrorWithoutSecret(
        validMastraEnv({ [envKey]: secretCanary }),
        envKey,
        secretCanary
      );
    }
  );

  it("keeps direct OpenAI valid without Mastra profile values or an API key", () => {
    const config = loadConfig({
      DATABASE_URL,
      AI_RUNTIME_MODE: "direct_openai",
      DEPLOYMENT_TIER: "production"
    });

    expect(config.widgetAi).toMatchObject({
      runtimeMode: "direct_openai",
      openAiModel: "gpt-5.5"
    });
    expect(config.widgetAi.openAiApiKey).toBeUndefined();
  });
});

function validMastraEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL,
    AI_RUNTIME_MODE: "mastra_openai_api",
    DEPLOYMENT_TIER: "staging",
    OPENAI_API_KEY: "m1-config-test-key",
    MASTRA_TELEMETRY_DISABLED: "true",
    MASTRA_AUTO_REFRESH_PROVIDERS: "false",
    ...overrides
  };
}

function expectConfigErrorWithoutSecret(
  env: NodeJS.ProcessEnv,
  expectedFragment: string,
  secretCanary: string
): void {
  let thrown: unknown;

  try {
    loadConfig(env);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toContain(expectedFragment);
  expect((thrown as Error).message).not.toContain(secretCanary);
}
