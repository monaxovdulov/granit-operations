import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentExecutionOptionsBase } from "@mastra/core/agent";

describe("G4 pinned Mastra package contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MASTRA_TELEMETRY_DISABLED;
  });

  it("constructs the exact disabled agent profile without network access", async () => {
    process.env.MASTRA_TELEMETRY_DISABLED = "true";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { Agent } = await import("@mastra/core/agent");
    const agent = new Agent({
      id: "granit-live-v2",
      name: "Granit live_v2",
      instructions: "Return only the app-owned live_v2 structured decision.",
      model: {
        id: "openai/gpt-5.6-sol",
        apiKey: "g4-not-a-real-key"
      },
      maxRetries: 0
    });
    const executionOptions = {
      runId: "00000000-0000-4000-8000-000000000000",
      maxSteps: 1,
      maxProcessorRetries: 0,
      modelSettings: {
        maxRetries: 0,
        maxOutputTokens: 1200
      },
      providerOptions: {
        openai: {
          reasoningEffort: "medium",
          store: false,
          transport: "fetch"
        }
      }
    } satisfies AgentExecutionOptionsBase<unknown>;

    expect(agent.id).toBe("granit-live-v2");
    expect(executionOptions).toMatchObject({
      maxSteps: 1,
      maxProcessorRetries: 0,
      modelSettings: { maxRetries: 0, maxOutputTokens: 1200 },
      providerOptions: {
        openai: { reasoningEffort: "medium", store: false, transport: "fetch" }
      }
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
