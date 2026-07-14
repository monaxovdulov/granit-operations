import { describe, expect, it } from "vitest";

import {
  LIVE_V2_CONTEXT_MAX_CHARACTERS,
  LIVE_V2_CONTEXT_MAX_MESSAGES,
  LIVE_V2_TURN_VIEW_VERSION
} from "../src/modules/ai/profiles/live-v2/live-v2-contract.js";
import { buildLiveV2TurnView } from "../src/modules/ai/profiles/live-v2/live-v2-context.js";
import {
  buildLiveV2TestTurn,
  contextMessage
} from "./fixtures/live-v2-synthetic.v1.js";

describe("live_v2 model-safe context", () => {
  it("keeps stable recent order, caps at eight and includes current inbound exactly once", () => {
    const previousMessagesNewestFirst = Array.from({ length: 10 }, (_, index) => {
      const id = 10 - index;
      return contextMessage({
        id,
        role: id % 2 === 0 ? "assistant" : "visitor",
        text: `message-${id}`
      });
    });
    const turn = buildLiveV2TestTurn({
      inbound: "current-inbound",
      previousMessagesNewestFirst
    });
    const duplicateCurrent = {
      ...turn.compactContext.messages.at(-1)!,
      text: "stale-current-copy"
    };
    turn.compactContext.messages.unshift(duplicateCurrent);

    const view = buildLiveV2TurnView(turn);

    expect(view.version).toBe(LIVE_V2_TURN_VIEW_VERSION);
    expect(view.messages).toHaveLength(LIVE_V2_CONTEXT_MAX_MESSAGES);
    expect(view.messages.map((message) => message.text)).toEqual([
      "message-4",
      "message-5",
      "message-6",
      "message-7",
      "message-8",
      "message-9",
      "message-10",
      "current-inbound"
    ]);
    expect(view.messages.filter((message) => message.text === "current-inbound")).toHaveLength(1);
    expect(view.messages.some((message) => message.text === "stale-current-copy")).toBe(false);
  });

  it("enforces the separate 6000-character cap while preserving current inbound", () => {
    const turn = buildLiveV2TestTurn({ inbound: "current" });
    turn.compactContext.messages = [
      ...Array.from({ length: 7 }, (_, index) =>
        contextMessage({
          id: index + 1,
          role: index % 2 === 0 ? "visitor" : "assistant",
          text: String(index + 1).repeat(1_000)
        })
      ),
      turn.compactContext.messages.at(-1)!
    ];

    const view = buildLiveV2TurnView(turn);
    const characterCount = view.messages.reduce((sum, message) => sum + message.text.length, 0);

    expect(characterCount).toBeLessThanOrEqual(LIVE_V2_CONTEXT_MAX_CHARACTERS);
    expect(view.messages.at(-1)).toEqual({ role: "visitor", text: "current" });
    expect(view.messages.filter((message) => message.text === "current")).toHaveLength(1);
  });

  it("extracts the last included AI question and exposes only controlled slots and gate", () => {
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

    expect(view.lastAiQuestion).toBe("Какой материал рассматриваете?");
    expect(view.knownSlots).toEqual({
      customerNameProvided: true,
      phoneProvided: true,
      emailProvided: false,
      city: "Москва"
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
});
