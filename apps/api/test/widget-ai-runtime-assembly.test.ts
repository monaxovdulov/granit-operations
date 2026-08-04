import { SITE_WIDGET_V2_CONTRACT_VERSION } from "@granit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { loadApprovedAiAssetManifest } from "../src/modules/ai/assets/approved-ai-assets.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { toLiveV2ModelFactsAsset } from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { buildConfiguredWidgetAiAssembly } from "../src/widget-ai-runtime-assembly.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate
} from "./fixtures/live-v2-synthetic.v1.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const openApps: Array<ReturnType<typeof buildApi>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("M3 widget AI runtime assembly", () => {
  it("keeps direct rollback isolated from Mastra assets and generator construction", async () => {
    const repository = new MemoryIntakeRepository();
    const selectLiveV2Assets = vi.fn(async () => {
      throw new Error("direct rollback must not load live_v2 assets");
    });
    const createMastraGenerator = vi.fn(async () => {
      throw new Error("direct rollback must not construct Mastra");
    });

    const assembly = await buildConfiguredWidgetAiAssembly({
      config: loadConfig({ DATABASE_URL: "postgres://m3.invalid/granit" }),
      runRepository: repository,
      dependencies: { selectLiveV2Assets, createMastraGenerator }
    });

    expect(assembly).toMatchObject({
      enabled: false,
      runtimeMode: "direct_openai",
      modelName: "gpt-5.5"
    });
    expect(selectLiveV2Assets).not.toHaveBeenCalled();
    expect(createMastraGenerator).not.toHaveBeenCalled();
  });

  it("assembles the trusted staging generator without bypassing the durable worker gate", async () => {
    const unrelatedSecretCanary = "must-not-cross-mastra-boundary";
    const repository = new MemoryIntakeRepository();
    const generateDecision = vi.fn(async () => ({
      candidate: answerCandidate(),
      observation: {
        observedModelProvider: "openai" as const,
        observedModelName: "gpt-5.6-sol",
        runtimeRunId: "m3-test-runtime-001",
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
      }
    }));
    const createMastraGenerator = vi.fn(async () => ({ generateDecision }));
    const selectLiveV2Assets = vi.fn(async () => ({
      manifest: loadApprovedAiAssetManifest().liveV2,
      prompt: LIVE_V2_PROMPT_ASSET,
      tone: LIVE_V2_TONE_ASSET,
      factsSnapshot: TEST_LIVE_V2_FACTS,
      facts: toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS)
    }));
    const config = loadConfig({
      DATABASE_URL: "postgres://m3.invalid/granit",
      AI_WIDGET_ENABLED: "true",
      AI_RUNTIME_MODE: "mastra_openai_api",
      DEPLOYMENT_TIER: "staging",
      OPENAI_API_KEY: "m3-test-not-a-real-key",
      MASTRA_TELEMETRY_DISABLED: "true",
      MASTRA_AUTO_REFRESH_PROVIDERS: "false",
      TELEGRAM_BOT_TOKEN: unrelatedSecretCanary
    });

    const assembly = await buildConfiguredWidgetAiAssembly({
      config,
      runRepository: repository,
      dependencies: { selectLiveV2Assets, createMastraGenerator }
    });
    const app = buildApi({ repository, widgetAi: assembly });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/public/intake/site-widget/messages",
      payload: {
        schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
        event_type: "site_widget.message_submitted",
        idempotency_key: "m3-runtime-assembly-0001",
        submitted_at: "2026-07-15T00:00:00.000Z",
        source: {
          channel: "site_widget",
          page_url: "https://granit.example/m3-synthetic",
          widget_instance_id: "m3-runtime-assembly-test"
        },
        message: { role: "visitor", text: "Нужна консультация по выбору памятника" },
        consent: { privacy_policy: true }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ automation: { status: "processing" } });
    expect(selectLiveV2Assets).toHaveBeenCalledTimes(1);
    expect(createMastraGenerator).toHaveBeenCalledWith({
      config: {
        deploymentTier: "staging",
        runtimeMode: "mastra_openai_api",
        mastra: config.widgetAi.mastra
      }
    });
    expect(JSON.stringify(createMastraGenerator.mock.calls[0])).not.toContain(
      unrelatedSecretCanary
    );
    expect(generateDecision).not.toHaveBeenCalled();
    expect(repository.listAiRuns()).toHaveLength(0);
  });

  it("date-validates approved assets before constructing the real generator", async () => {
    const repository = new MemoryIntakeRepository();
    const selectLiveV2Assets = vi.fn(async () => {
      throw new Error("approved facts are outside their review window");
    });
    const createMastraGenerator = vi.fn();
    const config = loadConfig({
      DATABASE_URL: "postgres://m3.invalid/granit",
      AI_WIDGET_ENABLED: "true",
      AI_RUNTIME_MODE: "mastra_openai_api",
      DEPLOYMENT_TIER: "staging",
      OPENAI_API_KEY: "m3-test-not-a-real-key",
      MASTRA_TELEMETRY_DISABLED: "true",
      MASTRA_AUTO_REFRESH_PROVIDERS: "false"
    });

    await expect(
      buildConfiguredWidgetAiAssembly({
        config,
        runRepository: repository,
        dependencies: { selectLiveV2Assets, createMastraGenerator }
      })
    ).rejects.toThrow("outside their review window");
    expect(selectLiveV2Assets).toHaveBeenCalledTimes(1);
    expect(createMastraGenerator).not.toHaveBeenCalled();
  });
});
