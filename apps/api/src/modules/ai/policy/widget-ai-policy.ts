import type {
  AiHandoffReason,
  AiRiskFlag,
  AiSlotName,
  AiTurnAction,
  AiTurnIntent
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export const WIDGET_AI_POLICY_VERSION = "granit_widget_ai_policy.consult_first.v1";

export type WidgetAiPolicyReply = {
  text: string;
  fallbackMode: "manager_required" | "none";
  reason: string;
  action: AiTurnAction;
  intent: AiTurnIntent;
  requestedSlots: AiSlotName[];
  riskFlags: AiRiskFlag[];
  handoffReason?: AiHandoffReason;
  stopAiAfterReply?: boolean;
};

export function buildWidgetAiPolicyReply(input: AiTurnInput): WidgetAiPolicyReply | null {
  const normalized = input.inboundMessage.text.toLocaleLowerCase("ru-RU");

  if (/(менеджер|оператор|человек|живой|позвон|свяж|перезвон|manager|human|operator)/i.test(normalized)) {
    return {
      text: handoffText(input, "Передам менеджеру."),
      fallbackMode: "manager_required",
      reason: "manager_requested",
      action: "handoff",
      intent: "manager_request",
      requestedSlots: [],
      riskFlags: ["manager_requested"],
      handoffReason: "manager_requested",
      stopAiAfterReply: true
    };
  }

  if (/(наслед|юрид|перезахорон|захорон|похорон|документ|legal|inheritance|burial|funeral)/i.test(normalized)) {
    return {
      text:
        "По юридическим и похоронным вопросам не консультирую. По памятнику менеджер подскажет после уточнения деталей.",
      fallbackMode: "manager_required",
      reason: "out_of_scope_legal_funeral_inheritance",
      action: "handoff",
      intent: "out_of_scope",
      requestedSlots: [],
      riskFlags: ["legal_funeral_topic"],
      handoffReason: "out_of_scope",
      stopAiAfterReply: true
    };
  }

  if (/(точн|финальн|окончательн).{0,24}(цен|стоим|смет|расч[её]т)|(?:цен|стоим|смет|расч[её]т).{0,24}(точн|финальн|окончательн)|коммерческ(?:ое|ого) предложен/i.test(normalized)) {
    return {
      text:
        handoffText(input, "Финальную стоимость подготовит менеджер."),
      fallbackMode: "manager_required",
      reason: "final_quote_pressure",
      action: "handoff",
      intent: "binding_terms",
      requestedSlots: [],
      riskFlags: ["exact_price_requested", "final_quote_pressure"],
      handoffReason: "final_quote_pressure",
      stopAiAfterReply: true
    };
  }

  const calculationReply = buildWidgetAiCalculationPolicyReply(input);
  if (calculationReply) return calculationReply;

  if (/(гарант|договор|контракт|скидк|наличи|оплат|рассроч|кредит|warranty|contract|discount|available|payment|installment)/i.test(normalized)) {
    return {
      text:
        handoffText(input, "Такие условия подтверждает менеджер."),
      fallbackMode: "manager_required",
      reason: "binding_terms_require_manager_confirmation",
      action: "handoff",
      intent: "binding_terms",
      requestedSlots: [],
      riskFlags: ["binding_terms_requested"],
      handoffReason: "binding_terms",
      stopAiAfterReply: true
    };
  }

  return null;
}

export function buildWidgetAiCalculationPolicyReply(
  input: AiTurnInput
): WidgetAiPolicyReply | null {
  const normalized = input.inboundMessage.text.toLocaleLowerCase("ru-RU");

  if (
    /(точн|финальн|окончательн).{0,24}(расч[её]т|смет)|(?:расч[её]т|смет).{0,24}(точн|финальн|окончательн)/i.test(
      normalized
    )
  ) {
    return {
      text: handoffText(input, "Финальную стоимость подготовит менеджер."),
      fallbackMode: "manager_required",
      reason: "final_quote_pressure",
      action: "handoff",
      intent: "binding_terms",
      requestedSlots: [],
      riskFlags: ["exact_price_requested", "final_quote_pressure"],
      handoffReason: "final_quote_pressure",
      stopAiAfterReply: true
    };
  }

  if (!isCalculationIntakeRequest(normalized)) {
    return null;
  }

  const requestedSlot = nextCalculationSlot(input);

  if (requestedSlot) {
    return {
      text: calculationQuestion(requestedSlot),
      fallbackMode: "none",
      reason: "calculation_intake_clarify",
      action: "clarify",
      intent: "price_intake",
      requestedSlots: [requestedSlot],
      riskFlags: ["exact_price_requested"]
    };
  }

  return {
    text: handoffText(input, "Финальную стоимость подготовит менеджер."),
    fallbackMode: "manager_required",
    reason: "calculation_intake_ready_for_manager",
    action: "handoff",
    intent: "binding_terms",
    requestedSlots: [],
    riskFlags: ["exact_price_requested", "final_quote_pressure"],
    handoffReason: "final_quote_pressure",
    stopAiAfterReply: true
  };
}

function isCalculationIntakeRequest(normalized: string): boolean {
  if (/(примерн|ориентир)/i.test(normalized)) {
    return false;
  }

  return (
    /(расч[её]т|смет)/i.test(normalized) &&
    /(нужен|нужна|нужно|нужны|нужн|надо|сдела|подготов|посчита|расс?чита)/i.test(normalized)
  );
}

function nextCalculationSlot(input: AiTurnInput): AiSlotName | null {
  const preferredOrder: AiSlotName[] = ["monumentType", "material", "size", "city", "cemetery"];

  return preferredOrder.find((slot) => !input.knownSlots.values[slot]) ?? null;
}

function calculationQuestion(slot: AiSlotName): string {
  const questions: Record<AiSlotName, string> = {
    monumentType:
      "Для расчёта сначала уточним детали. Какой тип памятника нужен: одинарный, двойной, семейный или комплекс?",
    material:
      "Для расчёта сначала уточним детали. Какой материал рассматриваете?",
    size: "Для расчёта сначала уточним детали. Какой размер памятника нужен?",
    city: "Для расчёта сначала уточним детали. В каком городе или районе нужна установка?",
    cemetery: "Для расчёта сначала уточним детали. На каком кладбище планируется установка?",
    engraving: "Для расчёта сначала уточним детали. Нужна ли гравировка?",
    installation: "Для расчёта сначала уточним детали. Нужна ли установка?",
    budgetContext: "Для расчёта сначала уточним детали. Есть ли ориентир по бюджету?",
    desiredTiming: "Для расчёта сначала уточним детали. К какому сроку нужна установка?",
    customerName: "Для расчёта сначала уточним детали. Как к вам обращаться?",
    phone: "Для расчёта сначала уточним детали. Напишите телефон для связи.",
    preferredContact: "Для расчёта сначала уточним детали. Как удобнее связаться?",
    questionSummary: "Для расчёта сначала уточним детали. Что важно учесть в заявке?"
  };

  return questions[slot];
}

function handoffText(input: AiTurnInput, prefix: string): string {
  const contactKnown = Boolean(
    input.customer.phoneProvided ||
      input.customer.emailProvided ||
      input.customer.preferredContact ||
      input.knownSlots.values.phone ||
      input.knownSlots.values.preferredContact
  );

  return contactKnown
    ? `${prefix} Передам ему диалог вместе с уже указанным контактом.`
    : `${prefix} Напишите телефон или удобный способ связи.`;
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
