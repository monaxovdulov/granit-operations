import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { loadApprovedAiAssetManifest } from "../src/modules/ai/assets/approved-ai-assets.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { toLiveV2ModelFactsAsset } from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { buildConfiguredWidgetAiAssembly } from "../src/widget-ai-runtime-assembly.js";
import { TEST_LIVE_V2_FACTS } from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

describe("single direct widget AI runtime assembly", () => {
  it("keeps disabled runtime isolated from assets and generator construction", async () => {
    const repository = new MemoryIntakeRepository();
    const selectLiveV2Assets = vi.fn(async () => {
      throw new Error("disabled runtime must not load live_v2 assets");
    });
    const createDirectGenerator = vi.fn();

    const assembly = await buildConfiguredWidgetAiAssembly({
      config: loadConfig({ DATABASE_URL: "postgres://runtime.invalid/granit" }),
      runRepository: repository,
      dependencies: { selectLiveV2Assets, createDirectGenerator }
    });

    expect(assembly).toMatchObject({ enabled: false, runRepository: repository });
    expect(assembly).not.toHaveProperty("runtimeMode");
    expect(selectLiveV2Assets).not.toHaveBeenCalled();
    expect(createDirectGenerator).not.toHaveBeenCalled();
  });

  it("assembles the enabled direct model-turn boundary", async () => {
    const repository = new MemoryIntakeRepository();
    const generateDecision = vi.fn();
    const createDirectGenerator = vi.fn(() => ({ generateDecision }));
    const selectLiveV2Assets = vi.fn(async () => ({
      manifest: loadApprovedAiAssetManifest().liveV2,
      prompt: LIVE_V2_PROMPT_ASSET,
      tone: LIVE_V2_TONE_ASSET,
      factsSnapshot: TEST_LIVE_V2_FACTS,
      facts: toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS)
    }));
    const config = loadConfig({
      DATABASE_URL: "postgres://runtime.invalid/granit",
      AI_WIDGET_ENABLED: "true",
      OPENAI_API_KEY: "direct-test-not-a-real-key"
    });

    const assembly = await buildConfiguredWidgetAiAssembly({
      config,
      runRepository: repository,
      dependencies: { selectLiveV2Assets, createDirectGenerator }
    });

    expect(assembly).toMatchObject({
      enabled: true,
      directLiveV2: {
        modelName: "gpt-5.6-luna",
        approvedFacts: TEST_LIVE_V2_FACTS
      }
    });
    expect(assembly).not.toHaveProperty("runtimeMode");
    expect(createDirectGenerator).toHaveBeenCalledWith({
      apiKey: "direct-test-not-a-real-key",
      model: "gpt-5.6-luna",
      timeoutMs: 10_000
    });
  });

  it("date-validates approved assets before constructing the generator", async () => {
    const repository = new MemoryIntakeRepository();
    const selectLiveV2Assets = vi.fn(async () => {
      throw new Error("approved facts are outside their review window");
    });
    const createDirectGenerator = vi.fn();
    const config = loadConfig({
      DATABASE_URL: "postgres://runtime.invalid/granit",
      AI_WIDGET_ENABLED: "true",
      OPENAI_API_KEY: "direct-test-not-a-real-key"
    });

    await expect(
      buildConfiguredWidgetAiAssembly({
        config,
        runRepository: repository,
        dependencies: { selectLiveV2Assets, createDirectGenerator }
      })
    ).rejects.toThrow("outside their review window");
    expect(createDirectGenerator).not.toHaveBeenCalled();
  });
});
