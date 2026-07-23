import { describe, expect, it } from "vitest";

import { loadConfig, parsePublicIntakeAllowedOrigins } from "../src/config.js";

describe("public intake CORS config", () => {
  it("defaults to a closed allowlist", () => {
    expect(parsePublicIntakeAllowedOrigins(undefined)).toEqual([]);
    expect(parsePublicIntakeAllowedOrigins("   ")).toEqual([]);
  });

  it("trims, canonicalizes, and deduplicates exact HTTP(S) origins", () => {
    expect(
      parsePublicIntakeAllowedOrigins(
        " https://preview.granitkr.ru/,https://preview.granitkr.ru,http://localhost:4173 "
      )
    ).toEqual(["https://preview.granitkr.ru", "http://localhost:4173"]);
  });

  it.each([
    "*",
    "ftp://preview.granitkr.ru",
    "https://preview.granitkr.ru/path",
    "https://preview.granitkr.ru/?query=1",
    "https://user@preview.granitkr.ru",
    "https://preview.granitkr.ru,,https://example.com",
    "not-an-origin"
  ])("fails closed for invalid allowlist entry %s", (value) => {
    expect(() => parsePublicIntakeAllowedOrigins(value)).toThrow(
      "PUBLIC_INTAKE_ALLOWED_ORIGINS must contain exact HTTP(S) origins"
    );
  });

  it("loads the allowlist into API config", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://example.invalid/granit",
      PUBLIC_INTAKE_ALLOWED_ORIGINS: "https://preview.granitkr.ru"
    });

    expect(config.publicIntakeCors.allowedOrigins).toEqual(["https://preview.granitkr.ru"]);
  });
});

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

  it("loads bounded generator, verifier and turn timeouts independently", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://example.test/granit",
      AI_WIDGET_GENERATOR_TIMEOUT_MS: "12000",
      AI_WIDGET_VERIFIER_TIMEOUT_MS: "10000",
      AI_WIDGET_DEADLINE_MS: "24000"
    });

    expect(config.widgetAi).toMatchObject({
      generatorTimeoutMs: 12000,
      verifierTimeoutMs: 10000,
      deadlineMs: 24000
    });
  });
});
