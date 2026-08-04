import {
  SITE_WIDGET_MESSAGE_EVENT_TYPE,
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteWidgetMessageRequest
} from "@granit/contracts";
import { describe, expect, it } from "vitest";

import type { AiTurnInput } from "../src/modules/ai/ai-turn.js";
import type { PublicWidgetAiReplyGenerator } from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import { PublicWidgetIntakeService } from "../src/modules/intake/use-cases/public-widget-intake-service.js";
import { MemoryIntakeRepository } from "./helpers/memory-intake-repository.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("widget AI conversation memory", () => {
  it("persists evidence-grounded preferences and supplies them on the next turn", async () => {
    const repository = new MemoryIntakeRepository();
    const seenInputs: AiTurnInput[] = [];
    const generator: PublicWidgetAiReplyGenerator = {
      async generateReply(input) {
        seenInputs.push(input);

        if (seenInputs.length === 1) {
          const start = input.inboundMessage.text.indexOf("строгий стиль");
          return {
            decision: "reply_candidate",
            text: "Понял, вам ближе строгий стиль.",
            action: "answer",
            intent: "product_selection",
            requestedSlots: [],
            requirementUpdates: [
              {
                category: "style",
                mode: "preference",
                value: "строгий стиль",
                confidence: 0.98,
                evidence: {
                  messageId: input.inboundMessage.publicMessageId,
                  quote: "строгий стиль",
                  start,
                  end: start + "строгий стиль".length
                },
                source: "ai_extraction",
                sourceMessageId: input.inboundMessage.publicMessageId
              }
            ],
            metadata: {
              grounding_verified: true,
              verifier_verdict: "pass"
            }
          };
        }

        return {
          decision: "reply_candidate",
          text: "Учту строгий стиль. Что ещё для вас важно?",
          action: "clarify",
          intent: "product_selection",
          requestedSlots: ["monumentType"],
          metadata: {
            grounding_verified: true,
            verifier_verdict: "pass"
          }
        };
      }
    };
    const service = new PublicWidgetIntakeService(repository, {
      ai: { enabled: true, replyGenerator: generator }
    });

    await service.acceptSiteWidgetMessage(
      request(1, "Мне нравится строгий стиль без лишнего декора")
    );
    const second = await service.acceptSiteWidgetMessage(
      request(2, "Какие детали теперь стоит выбрать?")
    );

    expect(second.body).toMatchObject({ ok: true });
    expect(seenInputs[1]?.knownRequirements).toEqual([
      expect.objectContaining({
        category: "style",
        mode: "preference",
        value: "строгий стиль",
        source: "ai_extraction",
        evidence: expect.objectContaining({ quote: "строгий стиль" })
      })
    ]);
  });

  it("keeps a rolling digest when the dialog exceeds twelve recent messages", async () => {
    const repository = new MemoryIntakeRepository();
    const seenInputs: AiTurnInput[] = [];
    const generator: PublicWidgetAiReplyGenerator = {
      async generateReply(input) {
        seenInputs.push(input);
        return {
          decision: "reply_candidate",
          text: `Ответ на шаг ${seenInputs.length}`,
          action: "answer",
          intent: "general_question",
          requestedSlots: [],
          metadata: { model_name: "memory-test" }
        };
      }
    };
    const service = new PublicWidgetIntakeService(repository, {
      ai: { enabled: true, replyGenerator: generator }
    });

    for (let index = 1; index <= 8; index += 1) {
      await service.acceptSiteWidgetMessage(
        request(index, `Сообщение клиента номер ${index}`)
      );
    }

    const eighthInput = seenInputs[7]!;
    expect(eighthInput.compactContext.messages).toHaveLength(12);
    expect(eighthInput.compactContext.rollingSummary?.text).toContain(
      "Сообщение клиента номер 1"
    );
    expect(eighthInput.compactContext.rollingSummary?.text).toContain("Ответ на шаг 1");
    expect(eighthInput.compactContext.rollingSummary?.text).not.toContain(
      "Сообщение клиента номер 8"
    );
  });
});

function request(index: number, text: string): SiteWidgetMessageRequest {
  return {
    schema_version: SITE_WIDGET_V2_CONTRACT_VERSION,
    event_type: SITE_WIDGET_MESSAGE_EVENT_TYPE,
    idempotency_key: `widget-memory-message-${String(index).padStart(4, "0")}`,
    submitted_at: new Date(Date.UTC(2026, 6, 18, 10, index)).toISOString(),
    public_session_id: SESSION_ID,
    source: {
      channel: "site_widget",
      page_url: "https://example.test/catalog",
      widget_instance_id: "memory-test"
    },
    message: { role: "visitor", text }
  };
}
