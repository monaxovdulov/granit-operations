import { describe, expect, it, vi } from "vitest";

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

describe("widget AI grounded mode config", () => {
  it.each([
    [undefined, "off"],
    ["off", "off"],
    ["shadow", "shadow"],
    ["enforce", "enforce"]
  ] as const)("maps %s to %s", (value, expected) => {
    const config = loadConfig({
      DATABASE_URL: "postgres://example.invalid/granit",
      ...(value === undefined ? {} : { AI_WIDGET_GROUNDED_MODE: value })
    });

    expect(config.widgetAi.groundedMode).toBe(expected);
  });

  it("falls back to off and emits a sanitized startup error for an unknown value", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const config = loadConfig({
        DATABASE_URL: "postgres://example.invalid/granit",
        AI_WIDGET_GROUNDED_MODE: "secret-invalid-value"
      });

      expect(config.widgetAi.groundedMode).toBe("off");
      expect(write).toHaveBeenCalledOnce();
      expect(String(write.mock.calls[0]?.[0])).toContain("invalid_widget_ai_grounded_mode");
      expect(String(write.mock.calls[0]?.[0])).not.toContain("secret-invalid-value");
    } finally {
      write.mockRestore();
    }
  });
});
