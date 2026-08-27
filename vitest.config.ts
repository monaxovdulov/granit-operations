import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "tooling/ai-architecture-guardrails.test.mjs"
    ]
  }
});
