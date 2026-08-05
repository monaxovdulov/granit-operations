import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const DATABASE_URL = "postgres://config-test.invalid/granit";

describe("single direct runtime config", () => {
  it("uses the approved direct model and exposes no runtime selector", () => {
    const config = loadConfig({ DATABASE_URL });

    expect(config.deploymentTier).toBe("unknown");
    expect(config.widgetAi.openAiModel).toBe("gpt-5.6-luna");
    expect(config.widgetAi).not.toHaveProperty("runtimeMode");
    expect(config.widgetAi).not.toHaveProperty("mastra");
  });

  it("rejects an unsupported deployment tier", () => {
    expect(() =>
      loadConfig({ DATABASE_URL, DEPLOYMENT_TIER: "preview" })
    ).toThrow("DEPLOYMENT_TIER");
  });

  it("pins the enabled runtime to the approved direct model", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL,
        AI_WIDGET_ENABLED: "true",
        OPENAI_MODEL: "unapproved-model"
      })
    ).toThrow("OPENAI_MODEL must be gpt-5.6-luna");
  });

  it("does not require an API key while AI is disabled", () => {
    const config = loadConfig({ DATABASE_URL, DEPLOYMENT_TIER: "production" });

    expect(config.widgetAi.enabled).toBe(false);
    expect(config.widgetAi.openAiApiKey).toBeUndefined();
  });
});
