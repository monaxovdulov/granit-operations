import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiWidgetAssistantProvider } from "../src/modules/ai/adapters/openai-widget-assistant-provider.js";
import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import type { WidgetAiProviderInput } from "../src/modules/ai/services/widget-ai-service.js";
import { WIDGET_AI_POLICY_VERSION } from "../src/modules/ai/policy/widget-ai-policy.js";
import { WIDGET_AI_PROMPT_VERSION } from "../src/modules/ai/prompts/widget-ai-prompt.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("direct OpenAI widget adapter golden request", () => {
  it("keeps the frozen gpt-5.5 low/store:false Responses API shape", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_test_1",
          model: "gpt-5.5",
          output: [
            {
              content: [
                { type: "output_text", text: "Первый фрагмент." },
                { type: "ignored", text: "Не включать." },
                { type: "output_text", text: "Второй фрагмент." }
              ]
            }
          ],
          usage: {
            input_tokens: 21,
            output_tokens: 9,
            total_tokens: 30
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    const provider = new OpenAiWidgetAssistantProvider({
      apiKey: "test-openai-key",
      model: "gpt-5.5",
      timeoutMs: 5000
    });
    const input = {
      turn: buildStageASiteWidgetAiTurnInput({
        publicConversationId: "00000000-0000-4000-8000-000000000001",
        publicMessageId: "00000000-0000-4000-8000-000000000002",
        requestFingerprint: "fingerprint-direct-adapter-golden",
        submittedAt: "2026-07-14T12:00:00.000Z",
        text: "Подскажите варианты оформления",
        page: {
          url: "https://granit.example/catalog",
          widgetInstanceId: "landing-main"
        },
        customer: {
          phoneProvided: false,
          emailProvided: false
        },
        visitor: {},
        gate: {
          aiState: "ai_collecting_info",
          agentAllowedToReply: true
        }
      }),
      instructions: "Frozen S05 instructions",
      userInput: "Frozen S05 user input"
    } satisfies WidgetAiProviderInput;

    const result = await provider.generateReply(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-openai-key"
      },
      signal: expect.any(AbortSignal)
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-5.5",
      store: false,
      instructions: "Frozen S05 instructions",
      input: "Frozen S05 user input",
      max_output_tokens: 120,
      reasoning: {
        effort: "low"
      },
      text: {
        verbosity: "low"
      },
      metadata: {
        channel: "site_widget",
        prompt_version: WIDGET_AI_PROMPT_VERSION,
        policy_version: WIDGET_AI_POLICY_VERSION
      }
    });
    expect(result).toEqual({
      text: "Первый фрагмент.\nВторой фрагмент.",
      modelProvider: "openai",
      modelName: "gpt-5.5",
      responseId: "resp_test_1",
      usage: {
        inputTokens: 21,
        outputTokens: 9,
        totalTokens: 30
      }
    });
  });
});
