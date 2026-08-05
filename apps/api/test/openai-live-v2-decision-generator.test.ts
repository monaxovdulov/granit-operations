import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OpenAiLiveV2DecisionGenerator
} from "../src/modules/ai/adapters/openai-live-v2-decision-generator.js";
import {
  MastraLiveV2DecisionGenerator
} from "../src/modules/ai/adapters/mastra-live-v2-decision-generator.js";
import {
  LIVE_V2_MAX_OUTPUT_TOKENS,
  LIVE_V2_PROVIDER_TIMEOUT_MS,
  LiveV2GenerationError
} from "../src/modules/ai/ports/live-v2-runtime.js";
import { LIVE_V2_PROMPT_ASSET } from "../src/modules/ai/profiles/live-v2/assets/prompt.v1.js";
import { LIVE_V2_TONE_ASSET } from "../src/modules/ai/profiles/live-v2/assets/tone.v1.js";
import { toLiveV2ModelFactsAsset } from "../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import {
  LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA
} from "../src/modules/ai/profiles/live-v2/live-v2-validator.js";
import {
  TEST_LIVE_V2_FACTS,
  answerCandidate,
  buildLiveV2TestTurn
} from "./fixtures/live-v2-synthetic.v1.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CONV-1 direct OpenAI live_v2 adapter", () => {
  it("matches the existing Mastra adapter candidate and observation contract", async () => {
    const candidate = answerCandidate();
    const runtimeResult = {
      candidate,
      modelProvider: "openai",
      providerModelName: "gpt-5.6-sol",
      runtimeRunId: "runtime-parity-001",
      usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 }
    };
    const direct = new OpenAiLiveV2DecisionGenerator(
      { apiKey: "test-direct-live-v2-key", model: "gpt-5.6-sol" },
      async () => ({
        id: runtimeResult.runtimeRunId,
        model: runtimeResult.providerModelName,
        outputText: JSON.stringify(candidate),
        usage: runtimeResult.usage
      })
    );
    const mastra = new MastraLiveV2DecisionGenerator(
      { generate: vi.fn(async () => runtimeResult) },
      "openai",
      "gpt-5.6-sol"
    );
    const invocation = {
      appTraceId: "00000000-0000-4000-8000-000000000200"
    };

    await expect(direct.generateDecision(generatorInput(), invocation)).resolves.toEqual(
      await mastra.generateDecision(generatorInput(), invocation)
    );
  });

  it("sends the exact bounded live_v2 Responses request and returns trusted observation", async () => {
    const candidate = answerCandidate();
    const fetchMock = vi.fn<typeof fetch>(async () =>
      response({
        id: "resp_live_v2_001",
        model: "gpt-5.6-sol",
        output: [
          {
            content: [
              { type: "output_text", text: JSON.stringify(candidate) },
              { type: "ignored", text: "RAW_IGNORED_OUTPUT" }
            ]
          }
        ],
        usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const generator = createGenerator();

    const result = await generator.generateDecision(generatorInput(), {
      appTraceId: "00000000-0000-4000-8000-000000000201"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-direct-live-v2-key"
      },
      signal: expect.any(AbortSignal)
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      instructions: LIVE_V2_PROMPT_ASSET.instructions.join("\n"),
      max_output_tokens: LIVE_V2_MAX_OUTPUT_TOKENS,
      reasoning: { effort: "medium" },
      metadata: { channel: "site_widget", decision_profile: "live_v2" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "granit_live_v2_candidate",
          strict: true,
          schema: LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA
        }
      }
    });
    const serializedInput = String(body.input);
    expect(serializedInput).toContain('"decisionProfile":"live_v2"');
    expect(serializedInput).toContain('"turn"');
    expect(serializedInput).toContain('"tone"');
    expect(serializedInput).toContain('"facts"');
    expect(serializedInput).not.toContain("00000000-0000-4000-8000-000000000201");
    expect(serializedInput).not.toContain("publicMessageId");
    expect(serializedInput).not.toContain("blobSha");
    expect(LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA.type).toBe("object");
    expect(LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA).not.toHaveProperty("anyOf");
    expect(LIVE_V2_PROVIDER_TIMEOUT_MS).toBe(15_000);
    expect(result).toEqual({
      candidate,
      observation: {
        observedModelProvider: "openai",
        observedModelName: "gpt-5.6-sol",
        runtimeRunId: "resp_live_v2_001",
        usage: { inputTokens: 120, outputTokens: 45, totalTokens: 165 }
      }
    });
  });

  it("combines caller cancellation with one direct fetch and no retry", async () => {
    const caller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      markStarted();
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("cancelled", "AbortError")),
          { once: true }
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const categories: string[] = [];
    const generation = createGenerator({
      onSanitizedFailure(category) {
        categories.push(category);
      }
    }).generateDecision(generatorInput(), {
      appTraceId: "00000000-0000-4000-8000-000000000202",
      signal: caller.signal
    });
    await started;

    caller.abort("job_not_current");

    await expect(generation).rejects.toMatchObject({
      name: "LiveV2GenerationError",
      failureCategory: "timeout_or_abort"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(categories).toEqual(["timeout_or_abort"]);
  });

  it("enforces its provider timeout with one direct fetch and no retry", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("timed out", "AbortError")),
          { once: true }
        );
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGenerator({ timeoutMs: 5 }).generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000203"
      })
    ).rejects.toMatchObject({ failureCategory: "timeout_or_abort" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed with sanitized observation when the returned model mismatches", async () => {
    const rawCanary = "RAW_MISMATCH_BODY_MUST_NOT_ESCAPE";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        response({
          id: "safe-mismatch-run",
          model: "unexpected-safe-model",
          output: [{ content: [{ type: "output_text", text: rawCanary }] }],
          usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 }
        })
      )
    );

    const thrown = await capture(
      createGenerator().generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000204"
      })
    );

    expect(thrown).toBeInstanceOf(LiveV2GenerationError);
    expect(thrown).toMatchObject({
      failureCategory: "identity_mismatch",
      observation: {
        observedModelProvider: "openai",
        observedModelName: "unexpected-safe-model",
        runtimeRunId: "safe-mismatch-run",
        usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 }
      }
    });
    expect(JSON.stringify(thrown)).not.toContain(rawCanary);
  });

  it("fails closed when the provider omits observed model identity", async () => {
    const rawCanary = "RAW_MISSING_MODEL_OUTPUT_MUST_NOT_ESCAPE";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        response({
          id: "resp-missing-model",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ ...answerCandidate(), replyDraft: rawCanary })
                }
              ]
            }
          ]
        })
      )
    );

    const thrown = await capture(
      createGenerator().generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000207"
      })
    );

    expect(thrown).toMatchObject({
      failureCategory: "runtime_error",
      observation: undefined
    });
    expect(JSON.stringify(thrown)).not.toContain("gpt-5.6-sol");
    expect(JSON.stringify(thrown)).not.toContain(rawCanary);
  });

  it("fails closed on malformed structured output without retaining raw text", async () => {
    const rawCanary = "RAW_INVALID_JSON_MUST_NOT_ESCAPE";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        response({
          id: "resp_live_v2_bad_json",
          model: "gpt-5.6-sol",
          output: [{ content: [{ type: "output_text", text: `{${rawCanary}` }] }]
        })
      )
    );

    const thrown = await capture(
      createGenerator().generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000205"
      })
    );

    expect(thrown).toMatchObject({ failureCategory: "runtime_error" });
    expect(JSON.stringify(thrown)).not.toContain(rawCanary);
  });

  it("classifies HTTP failure from status only and never reads the raw body", async () => {
    const rawCanary = "RAW_401_BODY_MUST_NOT_ESCAPE";
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: rawCanary } }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const categories: string[] = [];

    const thrown = await capture(
      createGenerator({
        onSanitizedFailure(category) {
          categories.push(category);
        }
      }).generateDecision(generatorInput(), {
        appTraceId: "00000000-0000-4000-8000-000000000206"
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(thrown).toMatchObject({ failureCategory: "auth_or_entitlement" });
    expect(categories).toEqual(["auth_or_entitlement"]);
    expect(JSON.stringify(thrown)).not.toContain(rawCanary);
  });

  it("rejects unsafe config or trace identity before any provider call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      () =>
        new OpenAiLiveV2DecisionGenerator({
          apiKey: "test-key",
          model: "unsafe model name"
        })
    ).toThrow("not safely configured");
    await expect(
      createGenerator().generateDecision(generatorInput(), { appTraceId: "unsafe trace" })
    ).rejects.toMatchObject({ failureCategory: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function createGenerator(
  overrides: Partial<ConstructorParameters<typeof OpenAiLiveV2DecisionGenerator>[0]> = {}
) {
  return new OpenAiLiveV2DecisionGenerator({
    apiKey: "test-direct-live-v2-key",
    model: "gpt-5.6-sol",
    ...overrides
  });
}

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

function response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}
