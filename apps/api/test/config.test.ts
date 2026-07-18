import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("widget AI rollout config", () => {
  it("defaults an enabled runtime to the grounded enforce path", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://example.test/granit",
      AI_WIDGET_ENABLED: "true"
    });

    expect(config.widgetAi).toMatchObject({
      enabled: true,
      groundedMode: "enforce"
    });
  });

  it("keeps legacy off as an explicit rollback switch", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://example.test/granit",
      AI_WIDGET_ENABLED: "true",
      AI_WIDGET_GROUNDED_MODE: "off"
    });

    expect(config.widgetAi.groundedMode).toBe("off");
  });
});
