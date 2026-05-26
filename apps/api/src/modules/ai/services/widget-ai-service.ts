import type { SiteWidgetMessageRequest } from "@granit/contracts";

import {
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator,
  type PublicWidgetAiReplyResult
} from "../../intake/ports/public-widget-ai-reply-generator.js";

export {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator,
  type PublicWidgetAiReplyResult
} from "../../intake/ports/public-widget-ai-reply-generator.js";

export const WIDGET_AI_POLICY_VERSION = "granit_widget_ai_policy.s05.v1";
export const WIDGET_AI_PROMPT_VERSION = "granit_widget_ai_prompt.s05.v1";

export type WidgetAiUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type WidgetAiProviderInput = {
  request: SiteWidgetMessageRequest;
  instructions: string;
  userInput: string;
};

export type WidgetAiProviderResult = {
  text: string;
  modelProvider: "openai" | "fake";
  modelName: string;
  responseId?: string;
  usage?: WidgetAiUsage;
};

export interface WidgetAiProvider {
  generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult>;
}

export type WidgetAiReplyResult = PublicWidgetAiReplyResult;

export type WidgetAiServiceOptions = {
  provider?: WidgetAiProvider;
  modelName?: string;
};

export class WidgetAiService implements PublicWidgetAiReplyGenerator {
  constructor(private readonly options: WidgetAiServiceOptions = {}) {}

  async generateReply(request: SiteWidgetMessageRequest): Promise<WidgetAiReplyResult> {
    const baseMetadata = {
      prompt_version: WIDGET_AI_PROMPT_VERSION,
      policy_version: WIDGET_AI_POLICY_VERSION,
      ai_disclosure_shown: true,
      ai_disclosure_version: WIDGET_AI_DISCLOSURE_VERSION,
      price_list_version: null,
      fallback_mode: "none"
    };

    const policyReply = buildPolicyReply(request.message.text);

    if (policyReply) {
      return {
        status: "replied",
        text: policyReply.text,
        agentAllowedToReplyAfterSend: policyReply.stopAiAfterReply ? false : undefined,
        metadata: {
          ...baseMetadata,
          model_provider: "policy",
          model_name: "deterministic",
          fallback_mode: policyReply.fallbackMode,
          handoff_reason: policyReply.reason
        }
      };
    }

    if (!this.options.provider) {
      return {
        status: "unavailable",
        reason: "missing_openai_config",
        metadata: {
          ...baseMetadata,
          model_provider: "openai",
          model_name: this.options.modelName ?? "gpt-5.5",
          fallback_mode: "manager_required",
          error_type: "missing_openai_config"
        }
      };
    }

    try {
      const providerResult = await this.options.provider.generateReply({
        request,
        instructions: buildInstructions(),
        userInput: buildUserInput(request)
      });
      const text = normalizeReply(providerResult.text);

      if (!text) {
        return {
          status: "unavailable",
          reason: "empty_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: providerResult.modelProvider,
            model_name: providerResult.modelName,
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            error_type: "empty_model_response",
            ...usageMetadata(providerResult.usage)
          }
        };
      }

      const unsafeReason = unsafeModelReplyReason(text);

      if (unsafeReason) {
        return {
          status: "unavailable",
          reason: "unsafe_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: providerResult.modelProvider,
            model_name: providerResult.modelName,
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            handoff_reason: unsafeReason,
            blocked_model_reply: true,
            error_type: "unsafe_model_response",
            ...usageMetadata(providerResult.usage)
          }
        };
      }

      return {
        status: "replied",
        text,
        metadata: {
          ...baseMetadata,
          model_provider: providerResult.modelProvider,
          model_name: providerResult.modelName,
          openai_response_id: providerResult.responseId,
          ...usageMetadata(providerResult.usage)
        }
      };
    } catch {
      return {
        status: "unavailable",
        reason: "model_error",
        metadata: {
          ...baseMetadata,
          model_provider: "openai",
          model_name: this.options.modelName ?? "gpt-5.5",
          fallback_mode: "manager_required",
          error_type: "model_error"
        }
      };
    }
  }
}

type PolicyReply = {
  text: string;
  fallbackMode: "manager_required";
  reason: string;
  stopAiAfterReply?: boolean;
};

function buildPolicyReply(message: string): PolicyReply | null {
  const normalized = message.toLocaleLowerCase("ru-RU");

  if (/(менеджер|оператор|человек|живой|позвон|свяж|перезвон|manager|human|operator)/i.test(normalized)) {
    return {
      text: "Передам менеджеру. Напишите телефон или удобный способ связи.",
      fallbackMode: "manager_required",
      reason: "manager_requested",
      stopAiAfterReply: true
    };
  }

  if (/(наслед|юрид|перезахорон|захорон|похорон|документ|legal|inheritance|burial|funeral)/i.test(normalized)) {
    return {
      text:
        "По юридическим и похоронным вопросам не консультирую. По памятнику менеджер подскажет после уточнения деталей.",
      fallbackMode: "manager_required",
      reason: "out_of_scope_legal_funeral_inheritance"
    };
  }

  if (/(цен|стоим|стоить|стоит|сколько.*сто|прайс|руб|₽|price|cost)/i.test(normalized)) {
    return {
      text:
        "Цену подтвердит менеджер после уточнения материала, размера, гравировки и установки. Не буду называть неподтвержденные суммы.",
      fallbackMode: "manager_required",
      reason: "price_requires_approved_source"
    };
  }

  if (/(срок|когда|дата|сегодня|завтра|дней|часов|deadline|timing|when)/i.test(normalized)) {
    return {
      text:
        "Сроки зависят от модели, гравировки, установки и условий на месте. Возможные даты подтвердит менеджер.",
      fallbackMode: "manager_required",
      reason: "deadline_requires_manager_confirmation"
    };
  }

  if (/(гарант|договор|контракт|скидк|наличи|оплат|рассроч|кредит|warranty|contract|discount|available|payment|installment)/i.test(normalized)) {
    return {
      text:
        "Такие условия подтверждает менеджер. Сообщение сохранено, менеджер уточнит детали и ответит по условиям.",
      fallbackMode: "manager_required",
      reason: "binding_terms_require_manager_confirmation"
    };
  }

  return null;
}

function buildInstructions(): string {
  return [
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
}

function buildUserInput(request: SiteWidgetMessageRequest): string {
  const contactParts = [
    request.contact?.name ? `Имя: ${request.contact.name}` : null,
    request.contact?.phone ? "Телефон указан" : "Телефон не указан",
    request.contact?.city ? `Город: ${request.contact.city}` : null
  ].filter(Boolean);

  return [
    `Страница сайта: ${request.source.page_url}`,
    contactParts.length ? `Контакт: ${contactParts.join(", ")}` : "Контакт: не указан",
    `Сообщение посетителя: ${request.message.text}`
  ].join("\n");
}

function normalizeReply(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n").slice(0, 900);
}

function unsafeModelReplyReason(text: string): string | null {
  const normalized = text.toLocaleLowerCase("ru-RU");

  if (/\d[\d\s]*(?:₽|руб|р\.)/i.test(normalized)) {
    return "price_amount_without_approved_source";
  }

  if (/(?:за|через)\s+\d+\s*(?:дн|час|нед|месяц)|\d+\s*(?:дн|час|нед|месяц)|будет готов|точн(?:о|ые сроки)|к\s+\d{1,2}[./]\d{1,2}/i.test(normalized)) {
    return "exact_deadline_promise";
  }

  if (/(гарантируем|предоставим гарантию|скидк[ауи]\s*\d|в наличии|заключим договор|подпишем договор|можно оплатить|рассрочк[ау])/i.test(normalized)) {
    return "binding_terms_promise";
  }

  if (/(по закону|юридически|наследств|оформить захоронение|похоронные документы)/i.test(normalized)) {
    return "legal_funeral_advice";
  }

  return null;
}

function usageMetadata(usage?: WidgetAiUsage): Record<string, unknown> {
  return {
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null
  };
}
