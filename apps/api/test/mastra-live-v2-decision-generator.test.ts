import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import {
  MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS,
  MastraLiveV2DecisionGenerator,
  MastraLiveV2GenerationError,
  createMastraOpenAiLiveV2DecisionGenerator,
  type MastraLiveV2AgentPort
} from "../src/modules/ai/adapters/mastra-live-v2-decision-generator.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { toLiveV2ModelFactsAsset } from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import { liveV2CandidateSchema } from "../src/modules/ai/profiles/live-v2/live-v2-validator.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  buildLiveV2TestTurn
} from "./fixtures/live-v2-synthetic.v1.js";

describe("M1 disabled Mastra live_v2 adapter", () => {
  it("builds the exact bounded request and trusts only the injected agent observation", async () => {
    const candidate = {
      ...answerCandidate(),
      arbitraryMetadata: {
        modelProvider: "openai",
        modelName: "spoofed-model",
        runtimeRunId: "spoofed-run"
      }
    };
    const generate = vi.fn<MastraLiveV2AgentPort["generate"]>(async () => ({
      candidate,
      modelProvider: "fake",
      providerModelName: "mastra-local-fixture-v1",
      runtimeRunId: "runtime-local-001",
      usage: {
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
        reasoningTokens: 20,
        cachedInputTokens: 10,
        raw: "RAW_USAGE_MUST_NOT_ESCAPE",
        negative: -1
      }
    }));
    const generator = new MastraLiveV2DecisionGenerator(
      { generate },
      "fake",
      "mastra-local-fixture-v1"
    );

    const result = await generator.generateDecision(generatorInput(), {
      appTraceId: "00000000-0000-4000-8000-000000000123"
    });

    expect(result).toEqual({
      candidate,
      observation: {
        observedModelProvider: "fake",
        observedModelName: "mastra-local-fixture-v1",
        runtimeRunId: "runtime-local-001",
        usage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
          reasoningTokens: 20,
          cachedInputTokens: 10
        }
      }
    });
    expect(generate).toHaveBeenCalledTimes(1);

    const [messages, options] = generate.mock.calls[0]!;
    expect(options).toMatchObject({
      runId: "00000000-0000-4000-8000-000000000123",
      instructions: LIVE_V2_PROMPT_ASSET.instructions.join("\n"),
      maxSteps: 1,
      maxProcessorRetries: 0,
      modelSettings: {
        maxRetries: 0,
        maxOutputTokens: MASTRA_LIVE_V2_MAX_OUTPUT_TOKENS
      },
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
          store: false,
          transport: "fetch"
        }
      },
      structuredOutput: { schema: liveV2CandidateSchema }
    });
    expect(messages).toHaveLength(1);
    const serializedModelInput = messages[0]!.content;
    expect(serializedModelInput).toContain('"decisionProfile":"live_v2"');
    expect(serializedModelInput).toContain('"turn"');
    expect(serializedModelInput).toContain('"tone"');
    expect(serializedModelInput).toContain('"facts"');
    expect(serializedModelInput).not.toContain(options.runId);
    expect(serializedModelInput).not.toContain("publicMessageId");
    expect(serializedModelInput).not.toContain("blobSha");
    expect(serializedModelInput).not.toContain("ownerApproved");
    expect(JSON.stringify(result.observation)).not.toContain("spoofed");
    expect(JSON.stringify(result.observation)).not.toContain("RAW_USAGE");
  });

  it("fails closed on a mismatched trusted provider or unsafe observed model", async () => {
    const input = generatorInput();

    for (const result of [
      {
        candidate: answerCandidate(),
        modelProvider: "openai",
        providerModelName: "gpt-5.6-sol",
        runtimeRunId: undefined,
        usage: undefined
      },
      {
        candidate: answerCandidate(),
        modelProvider: "fake",
        providerModelName: "unsafe model name",
        runtimeRunId: undefined,
        usage: undefined
      },
      {
        candidate: answerCandidate(),
        modelProvider: "fake",
        providerModelName: "safe-but-unexpected-model",
        runtimeRunId: undefined,
        usage: undefined
      }
    ]) {
      const generator = new MastraLiveV2DecisionGenerator(
        { generate: vi.fn(async () => result) },
        "fake",
        "mastra-local-fixture-v1"
      );

      await expect(
        generator.generateDecision(input, {
          appTraceId: "00000000-0000-4000-8000-000000000123"
        })
      ).rejects.toBeInstanceOf(MastraLiveV2GenerationError);
    }
  });

  it("carries only sanitized returned identity on an exact-model mismatch", async () => {
    const generator = new MastraLiveV2DecisionGenerator(
      {
        generate: vi.fn(async () => ({
          candidate: answerCandidate(),
          modelProvider: "fake",
          providerModelName: "unexpected-safe-model",
          runtimeRunId: "safe-mismatch-run",
          usage: {
            inputTokens: 9,
            outputTokens: 4,
            totalTokens: 13,
            raw: "RAW_MISMATCH_USAGE_CANARY"
          }
        }))
      },
      "fake",
      "mastra-local-fixture-v1"
    );

    let thrown: unknown;
    try {
      await generator.generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000123"
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MastraLiveV2GenerationError);
    expect((thrown as MastraLiveV2GenerationError).observation).toEqual({
      observedModelProvider: "fake",
      observedModelName: "unexpected-safe-model",
      runtimeRunId: "safe-mismatch-run",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }
    });
    expect(JSON.stringify((thrown as MastraLiveV2GenerationError).observation)).not.toContain(
      "RAW_MISMATCH"
    );
  });

  it("normalizes provider failures without exposing raw errors", async () => {
    const rawCanary = "RAW_PROVIDER_SECRET_CANARY";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const generator = new MastraLiveV2DecisionGenerator(
      {
        generate: vi.fn(async () => {
          throw new Error(rawCanary);
        })
      },
      "fake",
      "mastra-local-fixture-v1"
    );

    try {
      let thrown: unknown;
      try {
        await generator.generateDecision(generatorInput(), {
          appTraceId: "00000000-0000-4000-8000-000000000123"
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MastraLiveV2GenerationError);
      expect((thrown as Error).message).not.toContain(rawCanary);
      expect((thrown as Error).cause).toBeUndefined();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("rejects an unsafe real boundary before dynamically importing or fetching", async () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://m1.invalid/granit",
      AI_RUNTIME_MODE: "mastra_openai_api",
      DEPLOYMENT_TIER: "staging",
      OPENAI_API_KEY: "m1-not-a-real-key",
      MASTRA_TELEMETRY_DISABLED: "true",
      MASTRA_AUTO_REFRESH_PROVIDERS: "false"
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const previousTelemetry = process.env.MASTRA_TELEMETRY_DISABLED;
    const previousAutoRefresh = process.env.MASTRA_AUTO_REFRESH_PROVIDERS;
    process.env.MASTRA_TELEMETRY_DISABLED = "false";
    process.env.MASTRA_AUTO_REFRESH_PROVIDERS = "false";

    try {
      await expect(
        createMastraOpenAiLiveV2DecisionGenerator({
          config: config.widgetAi.mastra
        })
      ).rejects.toThrow("provider boundary is not safely configured");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restoreEnv("MASTRA_TELEMETRY_DISABLED", previousTelemetry);
      restoreEnv("MASTRA_AUTO_REFRESH_PROVIDERS", previousAutoRefresh);
      vi.unstubAllGlobals();
    }
  });

  it("constructs the real provider boundary under exact opt-outs without calling it", async () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://m1.invalid/granit",
      AI_RUNTIME_MODE: "mastra_openai_api",
      DEPLOYMENT_TIER: "staging",
      OPENAI_API_KEY: "m1-not-a-real-key",
      MASTRA_TELEMETRY_DISABLED: "true",
      MASTRA_AUTO_REFRESH_PROVIDERS: "false"
    });
    const savedEnv = new Map(
      [
        "MASTRA_TELEMETRY_DISABLED",
        "MASTRA_AUTO_REFRESH_PROVIDERS",
        "MASTRA_LICENSE_KEY",
        "MASTRA_EE_LICENSE"
      ].map((name) => [name, process.env[name]])
    );
    process.env.MASTRA_TELEMETRY_DISABLED = "true";
    process.env.MASTRA_AUTO_REFRESH_PROVIDERS = "false";
    delete process.env.MASTRA_LICENSE_KEY;
    delete process.env.MASTRA_EE_LICENSE;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const generator = await createMastraOpenAiLiveV2DecisionGenerator({
        config: config.widgetAi.mastra
      });

      expect(generator).toBeInstanceOf(MastraLiveV2DecisionGenerator);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      for (const [name, value] of savedEnv) {
        restoreEnv(name, value);
      }
      vi.unstubAllGlobals();
    }
  });
});

function generatorInput() {
  return {
    turn: buildLiveV2TurnView(
      buildLiveV2TestTurn({
        inbound: "Нужен спокойный вертикальный памятник",
        city: "Москва"
      })
    ),
    assets: {
      prompt: LIVE_V2_PROMPT_ASSET,
      tone: LIVE_V2_TONE_ASSET,
      facts: toLiveV2ModelFactsAsset(TEST_LIVE_V2_FACTS)
    }
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
