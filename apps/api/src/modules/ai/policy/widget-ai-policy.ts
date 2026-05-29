export const WIDGET_AI_POLICY_VERSION = "granit_widget_ai_policy.s05.v1";

export type WidgetAiPolicyReply = {
  text: string;
  fallbackMode: "manager_required";
  reason: string;
  stopAiAfterReply?: boolean;
};

export function buildWidgetAiPolicyReply(message: string): WidgetAiPolicyReply | null {
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

export function unsafeWidgetAiModelReplyReason(text: string): string | null {
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
