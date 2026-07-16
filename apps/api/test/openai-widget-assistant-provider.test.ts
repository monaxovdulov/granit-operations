import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAiWidgetAssistantProvider } from "../src/modules/ai/adapters/openai-widget-assistant-provider.js";
import { AI_TURN_DECISION_VERSION } from "../src/modules/ai/ai-dialog-contract.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI widget assistant provider", () => {
  it("requests a strict structured decision and validates the returned JSON", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "resp_test",
            model: "gpt-test",
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      version: AI_TURN_DECISION_VERSION,
                      action: "clarify",
                      intent: "price_intake",
                      replyText: "Стоимость зависит от материала. Какой материал нужен?",
                      extractedSlots: [],
                      requestedSlots: ["material"],
                      riskFlags: ["missing_approved_source"],
                      handoffReason: null,
                      sourceEvidence: [],
                      confidence: 0.91
                    })
                  }
                ]
              }
            ],
            usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );
    const provider = new OpenAiWidgetAssistantProvider({
      apiKey: "test-key",
      model: "gpt-test"
    });

    const result = await provider.generateReply({
      turn: {} as never,
      instructions: "instructions",
      userInput: "input"
    });

    expect(requestBody).toMatchObject({
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "granit_widget_ai_turn_decision",
          strict: true,
          schema: {
            additionalProperties: false,
            required: expect.arrayContaining(["action", "intent", "extractedSlots"])
          }
        }
      }
    });
    expect(result.decision).toMatchObject({
      action: "clarify",
      requestedSlots: ["material"]
    });
  });
});
