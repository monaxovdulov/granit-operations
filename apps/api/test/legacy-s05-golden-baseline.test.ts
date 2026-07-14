import { describe, expect, it, vi } from "vitest";

import { buildStageASiteWidgetAiTurnInput } from "../src/modules/ai/ai-turn.js";
import {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION
} from "../src/modules/intake/ports/public-widget-ai-reply-generator.js";
import {
  WIDGET_AI_POLICY_VERSION,
  buildWidgetAiPolicyReply
} from "../src/modules/ai/policy/widget-ai-policy.js";
import {
  WIDGET_AI_PROMPT_VERSION,
  buildWidgetAiInstructions,
  buildWidgetAiUserInput
} from "../src/modules/ai/prompts/widget-ai-prompt.js";
import {
  WidgetAiService,
  type WidgetAiProvider,
  type WidgetAiProviderInput
} from "../src/modules/ai/services/widget-ai-service.js";

const EXPECTED_INSTRUCTIONS = [
  "Ты AI-помощник компании Granit для первого сообщения в виджете сайта.",
  "Отвечай по-русски, очень кратко и спокойно: 1-2 коротких предложения, максимум один вопрос.",
  "Не повторяй одно и то же и не перечисляй много вариантов, если клиент не попросил.",
  "Можно отвечать на общие вопросы о памятниках, материалах, вариантах оформления и сборе деталей заявки.",
  "Важные условия подтверждает менеджер. Не обещай финальную цену, точные сроки, гарантию, договор, скидку, наличие, оплату или рассрочку.",
  "В S05 нет утвержденного прайс-источника, поэтому не называй суммы и не используй формат 'от X'.",
  "Не давай юридические, наследственные, похоронные или burial/funeral/legal советы.",
  "Если вопрос требует цены, срока или условий, скажи, что менеджер подтвердит после уточнения деталей.",
  "Если клиент просит менеджера или человека, попроси телефон или удобный способ связи и не продолжай консультацию."
].join("\n");

describe("legacy S05 direct golden baseline", () => {
  it("freezes prompt, policy and disclosure versions and text", () => {
    expect(WIDGET_AI_PROMPT_VERSION).toBe("granit_widget_ai_prompt.s05.v1");
    expect(WIDGET_AI_POLICY_VERSION).toBe("granit_widget_ai_policy.s05.v1");
    expect(WIDGET_AI_DISCLOSURE_VERSION).toBe("granit_widget_ai_disclosure.s05.v1");
    expect(WIDGET_AI_DISCLOSURE_TEXT).toBe(
      "Вам помогает AI-помощник компании.\n" +
        "Он может ответить на общие вопросы и собрать детали заявки.\n" +
        "Важные условия, цену и сроки подтвердит менеджер."
    );
    expect(buildWidgetAiInstructions()).toBe(EXPECTED_INSTRUCTIONS);
  });

  it("freezes generated user input and the deterministic manager-request candidate", async () => {
    const turn = buildTurn("Позовите менеджера");
    const provider: WidgetAiProvider = {
      generateReply: vi.fn(async () => {
        throw new Error("manager policy candidate must not call the provider");
      })
    };

    expect(buildWidgetAiUserInput(turn)).toBe(
      "Страница сайта: https://granit.example/catalog/family\n" +
        "Контакт: Имя: Анна, Телефон указан, Город: Москва\n" +
        "Сообщение посетителя: Позовите менеджера"
    );
    expect(buildWidgetAiPolicyReply(turn.inboundMessage.text)).toEqual({
      text: "Передам менеджеру. Напишите телефон или удобный способ связи.",
      fallbackMode: "manager_required",
      reason: "manager_requested",
      stopAiAfterReply: true
    });

    await expect(
      new WidgetAiService({ provider, modelName: "gpt-5.5" }).generateReply(turn)
    ).resolves.toEqual({
      decision: "reply_candidate",
      text: "Передам менеджеру. Напишите телефон или удобный способ связи.",
      agentAllowedToReplyAfterSend: false,
      metadata: {
        prompt_version: "granit_widget_ai_prompt.s05.v1",
        policy_version: "granit_widget_ai_policy.s05.v1",
        ai_disclosure_shown: true,
        ai_disclosure_version: "granit_widget_ai_disclosure.s05.v1",
        price_list_version: null,
        fallback_mode: "manager_required",
        model_provider: "policy",
        model_name: "deterministic",
        handoff_reason: "manager_requested"
      }
    });
    expect(provider.generateReply).not.toHaveBeenCalled();
  });

  it("freezes the normal provider request and reply candidate", async () => {
    const turn = buildTurn("Подскажите варианты оформления для семейного памятника");
    const providerInput = vi.fn(async (_input: WidgetAiProviderInput) => ({
      text: "  Могу предложить лаконичное оформление. Какой стиль вам ближе?  ",
      modelProvider: "fake" as const,
      modelName: "s05-golden-fake",
      responseId: "fake-response-1",
      usage: {
        inputTokens: 41,
        outputTokens: 13,
        totalTokens: 54
      }
    }));
    const provider: WidgetAiProvider = { generateReply: providerInput };

    await expect(
      new WidgetAiService({ provider, modelName: "gpt-5.5" }).generateReply(turn)
    ).resolves.toEqual({
      decision: "reply_candidate",
      text: "Могу предложить лаконичное оформление. Какой стиль вам ближе?",
      metadata: {
        prompt_version: "granit_widget_ai_prompt.s05.v1",
        policy_version: "granit_widget_ai_policy.s05.v1",
        ai_disclosure_shown: true,
        ai_disclosure_version: "granit_widget_ai_disclosure.s05.v1",
        price_list_version: null,
        fallback_mode: "none",
        model_provider: "fake",
        model_name: "s05-golden-fake",
        openai_response_id: "fake-response-1",
        input_tokens: 41,
        output_tokens: 13,
        total_tokens: 54
      }
    });
    expect(providerInput).toHaveBeenCalledWith({
      turn,
      instructions: EXPECTED_INSTRUCTIONS,
      userInput:
        "Страница сайта: https://granit.example/catalog/family\n" +
        "Контакт: Имя: Анна, Телефон указан, Город: Москва\n" +
        "Сообщение посетителя: Подскажите варианты оформления для семейного памятника"
    });
  });
});

function buildTurn(text: string) {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: "00000000-0000-4000-8000-000000000001",
    publicMessageId: "00000000-0000-4000-8000-000000000002",
    requestFingerprint: "fingerprint-s05-golden",
    submittedAt: "2026-07-14T12:00:00.000Z",
    text,
    page: {
      url: "https://granit.example/catalog/family",
      widgetInstanceId: "landing-main"
    },
    customer: {
      name: "Анна",
      phoneProvided: true,
      emailProvided: false,
      city: "Москва"
    },
    visitor: {
      locale: "ru-RU",
      timezone: "Europe/Moscow"
    },
    gate: {
      aiState: "ai_collecting_info",
      agentAllowedToReply: true
    }
  });
}
