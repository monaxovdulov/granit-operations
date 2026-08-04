import { describe, expect, it } from "vitest";

import { buildStageASiteWidgetAiTurnInput, type AiTurnInput } from "../src/modules/ai/ai-turn.js";
import {
  buildWidgetAiDialogueControlReply,
  guardUnsupportedWidgetReply
} from "../src/modules/ai/policy/widget-ai-dialogue-control.js";
import { buildWidgetAiPolicyReply } from "../src/modules/ai/policy/widget-ai-policy.js";
import {
  buildWidgetAiCalculationFallbackReply,
  normalizeWidgetAiReplyPlan
} from "../src/modules/ai/rendering/widget-ai-reply-renderer.js";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

describe("widget AI dialogue control", () => {
  it("preserves the issue 14 transcript as a deterministic repaired flow", () => {
    const context: AiTurnInput["compactContext"]["messages"] = [];

    const initial = buildWidgetAiPolicyReply(turn("Нужен расчет памятника с установкой", context));
    expect(initial).toMatchObject({ action: "clarify", requestedSlots: ["monumentType"] });
    pushTurn(context, "Нужен расчет памятника с установкой", initial!.text);

    const uncertain = buildWidgetAiPolicyReply(turn("не знаю", context));
    expect(uncertain).toMatchObject({
      action: "answer",
      requestedSlots: [],
      reason: "dialogue_uncertainty_guided_choice"
    });
    expect(uncertain!.text).not.toMatch(/одинарный, двойной, семейный/u);
    pushTurn(context, "не знаю", uncertain!.text);

    const grandfather = buildWidgetAiPolicyReply(turn("у меня дед", context));
    expect(grandfather).toMatchObject({
      action: "answer",
      requestedSlots: [],
      reason: "dialogue_tentative_one_person_context"
    });
    expect(grandfather!.text).toContain("как ориентир");
    pushTurn(context, "у меня дед", grandfather!.text);

    const firstFrustration = buildWidgetAiPolicyReply(
      turn("я ж сказал не знаю я не разбираюсь", context)
    );
    expect(firstFrustration).toMatchObject({
      action: "answer",
      reason: "dialogue_frustration_repair"
    });
    expect(firstFrustration!.text).toContain("больше не буду повторять вопрос");
    pushTurn(context, "я ж сказал не знаю я не разбираюсь", firstFrustration!.text);

    const repeatedFrustration = buildWidgetAiPolicyReply(
      turn("ты че тоже самое мне говоришь", context)
    );
    expect(repeatedFrustration).toMatchObject({
      action: "handoff",
      requestedSlots: [],
      reason: "dialogue_repeated_frustration_handoff",
      stopAiAfterReply: true
    });
    expect(repeatedFrustration!.text).not.toMatch(/минск|кладбищ/iu);
  });

  it("retracts an unsupported location after a visitor correction", () => {
    const reply = buildWidgetAiDialogueControlReply(
      turn("я ничего про минск не говорил", [
        message("ai_assistant", "На каком кладбище в Минске планируется установка?", 1)
      ])
    );

    expect(reply).toMatchObject({
      action: "answer",
      requestedSlots: [],
      reason: "dialogue_correction_retracted_unsupported_location"
    });
    expect(reply!.text).toContain("вы не называли");
  });

  it("does not invent a grandfather or frustration for ordinary family advice", () => {
    const familyReply = buildWidgetAiDialogueControlReply(
      turn("памятник для мамы", [message("visitor", "не разбираюсь", 1)])
    );

    expect(familyReply).toMatchObject({
      action: "answer",
      reason: "dialogue_tentative_one_person_context"
    });
    expect(familyReply!.text).not.toMatch(/дедуш/iu);
    expect(buildWidgetAiDialogueControlReply(turn("ты что посоветуешь?", []))).toBeNull();
  });

  it("does not route a business-hours question into deadline intake", () => {
    const input = turn("когда вы работаете?", []);
    const plan = {
      action: "answer" as const,
      intent: "general_question" as const,
      requestedSlots: [],
      riskFlags: [],
      handoffReason: null
    };

    expect(normalizeWidgetAiReplyPlan({ turn: input, plan })).toEqual({
      plan,
      reason: null
    });
  });

  it("blocks a semantically duplicate requested slot", () => {
    const input = turn("Я не уверен", [
      message("ai_assistant", "Какой тип памятника нужен: одинарный или двойной?", 1)
    ]);
    const normalized = normalizeWidgetAiReplyPlan({
      turn: input,
      plan: {
        action: "clarify",
        intent: "product_selection",
        requestedSlots: ["monumentType"],
        riskFlags: [],
        handoffReason: null
      }
    });

    expect(normalized).toMatchObject({
      reason: "dialogue_duplicate_question_monumentType",
      plan: { action: "handoff", requestedSlots: [], handoffReason: "low_confidence" }
    });
  });

  it("does not ask calculation slots that were already asked", () => {
    const reply = buildWidgetAiCalculationFallbackReply(
      turn("Нужен расчет памятника с установкой", [
        message("ai_assistant", "Какой тип памятника нужен?", 1)
      ])
    );

    expect(reply).toMatchObject({ action: "clarify", requestedSlots: ["material"] });
    expect(reply!.text).not.toContain("тип памятника");
  });

  it("replaces invented Minsk or cemetery context before persistence", () => {
    const reply = guardUnsupportedWidgetReply({
      turn: turn("я не разбираюсь", []),
      text: "Тогда уточним кладбище в Минске."
    });

    expect(reply).toMatchObject({ reason: "dialogue_unsupported_location_blocked" });
    expect(reply!.text).not.toMatch(/минск|кладбищ/iu);
  });

  it("allows location wording after the visitor supplied it", () => {
    expect(
      guardUnsupportedWidgetReply({
        turn: turn("Установка будет на Северном кладбище в Минске", []),
        text: "Уточню детали установки на Северном кладбище в Минске."
      })
    ).toBeNull();
  });
});

function turn(
  text: string,
  recentMessages: AiTurnInput["compactContext"]["messages"]
): AiTurnInput {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: CONVERSATION_ID,
    publicMessageId: "11111111-1111-4111-8111-111111111111",
    requestFingerprint: "a".repeat(64),
    submittedAt: "2026-07-22T09:00:00.000Z",
    text,
    page: {
      url: "https://preview.granitkr.ru/catalog.html",
      widgetInstanceId: "issue-14-regression"
    },
    customer: { phoneProvided: false, emailProvided: false },
    visitor: { locale: "ru-RU", timezone: "Europe/Moscow" },
    gate: { aiState: "ai_collecting_info", agentAllowedToReply: true },
    recentMessages
  });
}

function pushTurn(
  context: AiTurnInput["compactContext"]["messages"],
  visitor: string,
  assistant: string
): void {
  const offset = context.length;
  context.push(message("visitor", visitor, offset), message("ai_assistant", assistant, offset + 1));
}

function message(
  senderRole: "visitor" | "ai_assistant",
  text: string,
  index: number
): AiTurnInput["compactContext"]["messages"][number] {
  return {
    publicMessageId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    direction: senderRole === "visitor" ? "inbound" : "outbound",
    senderRole,
    contentType: "text",
    submittedAt: new Date(Date.parse("2026-07-22T09:00:00.000Z") + index * 1000).toISOString(),
    text
  };
}
