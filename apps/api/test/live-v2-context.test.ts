import { describe, expect, it } from "vitest";

import {
  LIVE_V2_TURN_VIEW_VERSION
} from "../src/modules/ai/profiles/live-v2/live-v2-contract.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import {
  buildLiveV2TestTurn,
  contextMessage
} from "./fixtures/live-v2-synthetic.v1.js";

describe("live_v2 model-safe context", () => {
  it("keeps the full acceptance transcript and includes current inbound exactly once", () => {
    const transcript = [
      [1, "visitor", "Нужен памятник."],
      [2, "assistant", "Для одного человека или для двоих?"],
      [3, "visitor", "Для одного."],
      [4, "assistant", "Какой материал рассматриваете?"],
      [5, "visitor", "Чёрный гранит."],
      [6, "assistant", "Можно показать несколько лаконичных вариантов."],
      [7, "visitor", "Только без золота."],
      [8, "assistant", "Учту это ограничение."]
    ] as const;
    const previousMessagesNewestFirst = [...transcript].reverse().map(([id, role, text]) =>
      contextMessage({ id, role, text })
    );
    const turn = buildLiveV2TestTurn({
      inbound: "Нет, всё-таки нужен двойной. Покажи варианты, о которых говорили.",
      previousMessagesNewestFirst
    });
    const duplicateCurrent = {
      ...contextMessage({ id: 102, role: "visitor", text: "stale-current-copy" }),
      publicMessageId: turn.inboundMessage.publicMessageId,
      text: "stale-current-copy"
    };
    turn.compactContext.messages.unshift(duplicateCurrent);
    turn.knownSlots.values = {
      monumentType: {
        value: "одинарный",
        source: "ai_extraction",
        confidence: 0.9,
        updatedAt: "2026-08-26T10:00:00.000Z"
      },
      material: {
        value: "чёрный гранит",
        source: "ai_extraction",
        confidence: 0.95,
        updatedAt: "2026-08-26T10:01:00.000Z"
      }
    };
    turn.knownRequirements = [
      {
        category: "decoration",
        mode: "avoidance",
        value: "золото",
        source: "ai_extraction",
        sourceMessageId: "00000000-0000-4000-8000-000000000007",
        evidence: {
          messageId: "00000000-0000-4000-8000-000000000007",
          quote: "без золота",
          start: 6,
          end: 16
        },
        confidence: 0.9,
        updatedAt: "2026-08-26T10:02:00.000Z"
      }
    ];

    const view = buildLiveV2TurnView(turn);

    expect(view.version).toBe(LIVE_V2_TURN_VIEW_VERSION);
    expect(view.messages).toHaveLength(9);
    expect(view.messages.map((message) => message.text)).toEqual([
      ...transcript.map((entry) => entry[2]),
      "Нет, всё-таки нужен двойной. Покажи варианты, о которых говорили."
    ]);
    expect(
      view.messages.filter((message) => message.text.includes("всё-таки нужен двойной"))
    ).toHaveLength(1);
    expect(view.messages.some((message) => message.text === "stale-current-copy")).toBe(false);
    expect(view.knownSlots).toMatchObject({
      monumentType: "одинарный",
      material: "чёрный гранит"
    });
    expect(view.knownSlotProvenance).toMatchObject({
      monumentType: { origin: "saved_field", source: "ai_extraction" },
      material: { origin: "saved_field", source: "ai_extraction" }
    });
    expect(view.knownRequirements).toEqual([
      {
        category: "decoration",
        mode: "avoidance",
        value: "золото",
        provenance: { origin: "saved_requirement", source: "ai_extraction" }
      }
    ]);
  });

  it("keeps at least twenty chronological messages when the request fits the model budget", () => {
    const turn = buildLiveV2TestTurn({
      inbound: "message-21",
      previousMessagesNewestFirst: Array.from({ length: 20 }, (_, index) => {
        const id = 20 - index;
        return contextMessage({
          id,
          role: id % 2 === 0 ? "assistant" : "visitor",
          text: `message-${id}`
        });
      })
    });

    const view = buildLiveV2TurnView(turn);

    expect(view.messages.map((message) => message.text)).toEqual(
      Array.from({ length: 21 }, (_, index) => `message-${index + 1}`)
    );
  });

  it("exposes only controlled slots and gate alongside the transcript", () => {
    const turn = buildLiveV2TestTurn({
      inbound: "Нужен спокойный вариант",
      city: "  Москва  ",
      phoneProvided: true,
      previousMessagesNewestFirst: [
        contextMessage({
          id: 3,
          role: "assistant",
          text: "Можно сделать лаконично. Какой материал рассматриваете?"
        }),
        contextMessage({ id: 2, role: "visitor", text: "Без сложного декора" }),
        contextMessage({ id: 1, role: "assistant", text: "Чем могу помочь?" })
      ]
    });
    turn.customer.name = "Анна";
    turn.knownSlots.customerNameProvided = true;

    const view = buildLiveV2TurnView(turn);
    const serialized = JSON.stringify(view);

    expect(view).not.toHaveProperty("lastAiQuestion");
    expect(view.knownSlots).toEqual({
      customerNameProvided: true,
      phoneProvided: true,
      emailProvided: false,
      city: "Москва"
    });
    expect(view.knownSlotProvenance).toEqual({
      city: { origin: "saved_field", source: "contact" }
    });
    expect(view.gate).toEqual({
      aiState: "ai_collecting_info",
      agentAllowedToReply: true
    });
    expect(serialized).not.toContain("00000000-0000-4000");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("Анна");
    expect(serialized).not.toContain("2026-07-14T");
  });

  it("keeps saved requirements model-safe with source provenance", () => {
    const turn = buildLiveV2TestTurn();
    turn.knownRequirements = [
      {
        category: "decoration",
        mode: "avoidance",
        value: "  без золота  ",
        source: "manager",
        sourceMessageId: "00000000-0000-4000-8000-000000000777",
        evidence: {
          messageId: "00000000-0000-4000-8000-000000000777",
          quote: "без золота",
          start: 0,
          end: 10
        },
        confidence: 1,
        updatedAt: "2026-07-14T10:00:00.000Z"
      }
    ];

    const view = buildLiveV2TurnView(turn);
    const serialized = JSON.stringify(view);

    expect(view.knownRequirements).toEqual([
      {
        category: "decoration",
        mode: "avoidance",
        value: "без золота",
        provenance: { origin: "saved_requirement", source: "manager" }
      }
    ]);
    expect(serialized).not.toContain("00000000-0000-4000-8000-000000000777");
    expect(serialized).not.toContain("2026-07-14T10:00:00.000Z");
  });

  it.each([
    "+7 999 123-45-67",
    "visitor@example.com",
    "https://example.com/contact",
    "Москва 79991234567"
  ])("omits a city slot that can carry contact or URL data: %s", (city) => {
    const view = buildLiveV2TurnView(buildLiveV2TestTurn({ city }));

    expect(view.knownSlots).not.toHaveProperty("city");
    expect(JSON.stringify(view)).not.toContain(city);
  });

  it("keeps visitor-authored contact text only as transcript text", () => {
    const turn = buildLiveV2TestTurn({
      inbound: "Позвоните мне: +7 999 123-45-67"
    });
    turn.customer.name = "Анна";
    turn.page.referrerUrl = "https://private.example/referrer";

    const view = buildLiveV2TurnView(turn);
    const serialized = JSON.stringify(view);

    expect(view.messages.at(-1)?.text).toBe("Позвоните мне: +7 999 123-45-67");
    expect(serialized).not.toContain("Анна");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain(turn.inboundMessage.publicMessageId);
  });
});
