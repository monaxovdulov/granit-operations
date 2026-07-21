import type {
  AiHandoffReason,
  AiRiskFlag,
  AiSlotName,
  AiTurnAction,
  AiTurnIntent
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export type WidgetAiReplyPlan = {
  action: AiTurnAction;
  intent: AiTurnIntent;
  requestedSlots: AiSlotName[];
  riskFlags: AiRiskFlag[];
  handoffReason?: AiHandoffReason | null;
};

export type WidgetAiRenderedReply = {
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

export function renderWidgetAiPlannedReply(input: {
  turn: AiTurnInput;
  plan: WidgetAiReplyPlan;
}): WidgetAiRenderedReply | null {
  const { turn, plan } = input;
  const handoffReason = plan.handoffReason ?? undefined;

  if (plan.action === "handoff") {
    return {
      text: handoffText(turn, handoffPrefix(handoffReason)),
      fallbackMode: "manager_required",
      reason: handoffReason ? `app_render_handoff_${handoffReason}` : "app_render_handoff",
      action: "handoff",
      intent: plan.intent,
      requestedSlots: [],
      riskFlags: plan.riskFlags,
      handoffReason: handoffReason ?? "binding_terms",
      stopAiAfterReply: true
    };
  }

  const requestedSlot = plan.requestedSlots[0];

  if (plan.action === "clarify" && plan.intent === "price_intake" && requestedSlot) {
    return {
      text: calculationQuestion(requestedSlot),
      fallbackMode: "none",
      reason: "app_render_price_intake_clarify",
      action: "clarify",
      intent: "price_intake",
      requestedSlots: [requestedSlot],
      riskFlags: plan.riskFlags
    };
  }

  if (plan.action === "clarify" && plan.intent === "deadline_intake" && requestedSlot) {
    return {
      text: deadlineQuestion(requestedSlot),
      fallbackMode: "none",
      reason: "app_render_deadline_intake_clarify",
      action: "clarify",
      intent: "deadline_intake",
      requestedSlots: [requestedSlot],
      riskFlags: plan.riskFlags
    };
  }

  if (plan.intent === "binding_terms") {
    return {
      text: handoffText(turn, "Такие условия подтверждает менеджер."),
      fallbackMode: "manager_required",
      reason: "app_render_binding_terms_handoff",
      action: "handoff",
      intent: "binding_terms",
      requestedSlots: [],
      riskFlags: plan.riskFlags.length ? plan.riskFlags : ["binding_terms_requested"],
      handoffReason: handoffReason ?? "binding_terms",
      stopAiAfterReply: true
    };
  }

  return null;
}

export function buildWidgetAiCalculationFallbackReply(
  input: AiTurnInput
): WidgetAiRenderedReply | null {
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

  if (!requestedSlot) {
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
    material: "Для расчёта сначала уточним детали. Какой материал рассматриваете?",
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

function deadlineQuestion(slot: AiSlotName): string {
  const questions: Record<AiSlotName, string> = {
    monumentType:
      "Срок зависит от модели, оформления и установки. Какой тип памятника рассматриваете?",
    material: "Срок зависит от материала, оформления и установки. Какой материал рассматриваете?",
    size: "Срок зависит от размера, оформления и установки. Какой размер памятника нужен?",
    city: "Срок зависит от места работ и деталей заказа. В каком городе или районе нужна установка?",
    cemetery: "Срок зависит от места работ и деталей заказа. На каком кладбище планируется установка?",
    engraving: "Срок зависит от оформления. Нужна ли гравировка?",
    installation: "Срок зависит от работ на месте. Нужна ли установка?",
    budgetContext: "Срок зависит от состава работ. Есть ли ориентир по бюджету?",
    desiredTiming: "Срок подтвердит менеджер. К какому периоду нужна установка?",
    customerName: "Срок подтвердит менеджер. Как к вам обращаться?",
    phone: "Срок подтвердит менеджер. Напишите телефон для связи.",
    preferredContact: "Срок подтвердит менеджер. Как удобнее связаться?",
    questionSummary: "Срок зависит от деталей заказа. Что важно учесть?"
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

function handoffPrefix(reason: AiHandoffReason | undefined): string {
  if (reason === "manager_requested") return "Передам менеджеру.";
  if (reason === "out_of_scope") return "Передам вопрос менеджеру.";
  if (reason === "final_quote_pressure") return "Финальную стоимость подготовит менеджер.";
  return "Такие условия подтверждает менеджер.";
}
