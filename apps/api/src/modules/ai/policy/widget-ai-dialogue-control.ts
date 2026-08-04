import type { AiSlotName } from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";
import type {
  WidgetAiRenderedReply,
  WidgetAiReplyPlan
} from "../rendering/widget-ai-reply-renderer.js";

const REPAIR_MARKER = "больше не буду повторять вопрос";

export type WidgetDialogueSignals = {
  uncertainty: boolean;
  frustration: boolean;
  correction: boolean;
  memorialForOnePerson: boolean;
  repairAlreadyAttempted: boolean;
  previouslyAskedSlots: AiSlotName[];
};

export function analyzeWidgetDialogue(input: AiTurnInput): WidgetDialogueSignals {
  const current = normalize(input.inboundMessage.text);
  const assistantMessages = input.compactContext.messages
    .filter((message) => message.senderRole === "ai_assistant")
    .map((message) => normalize(message.text));

  return {
    uncertainty: isUncertainty(current),
    frustration: isFrustration(current),
    correction: isUnsupportedLocationCorrection(current),
    memorialForOnePerson: isOnePersonMemorialContext(current),
    repairAlreadyAttempted: assistantMessages.some((message) =>
      message.includes(REPAIR_MARKER)
    ),
    previouslyAskedSlots: uniqueSlots(assistantMessages.flatMap(inferAskedSlots))
  };
}

export function buildWidgetAiDialogueControlReply(
  input: AiTurnInput
): WidgetAiRenderedReply | null {
  const signals = analyzeWidgetDialogue(input);

  if (signals.correction) {
    return {
      text:
        "Вы правы: это место вы не называли. Не буду учитывать это предположение; продолжим только с тем, что вы сообщили сами.",
      fallbackMode: "none",
      reason: "dialogue_correction_retracted_unsupported_location",
      action: "answer",
      intent: "general_question",
      requestedSlots: [],
      riskFlags: []
    };
  }

  if (signals.frustration && signals.repairAlreadyAttempted) {
    return {
      text: handoffText(
        input,
        "Извините, диалог пошёл по кругу. Больше не буду задавать те же вопросы; передам разговор менеджеру."
      ),
      fallbackMode: "manager_required",
      reason: "dialogue_repeated_frustration_handoff",
      action: "handoff",
      intent: "manager_request",
      requestedSlots: [],
      riskFlags: ["low_confidence"],
      handoffReason: "low_confidence",
      stopAiAfterReply: true
    };
  }

  if (signals.frustration) {
    return {
      text:
        "Извините, больше не буду повторять вопрос. Не нужно разбираться в терминах: могу показать простые варианты или сразу передать диалог менеджеру — как удобнее?",
      fallbackMode: "none",
      reason: "dialogue_frustration_repair",
      action: "answer",
      intent: "product_selection",
      requestedSlots: [],
      riskFlags: ["low_confidence"]
    };
  }

  if (signals.memorialForOnePerson && hasRecentUncertainty(input)) {
    return {
      text:
        "Понял: речь о памятнике для одного человека, поэтому как ориентир можно начать с одинарного варианта. Это пока не окончательный выбор — показать несколько простых вариантов без терминов?",
      fallbackMode: "none",
      reason: "dialogue_tentative_one_person_context",
      action: "answer",
      intent: "product_selection",
      requestedSlots: [],
      riskFlags: []
    };
  }

  if (signals.uncertainty) {
    return {
      text:
        "Это нормально — разбираться в типах памятников не нужно. Можно начать с простого базового варианта, а затем сравнить его с более широким или с оформлением участка; показать примеры без терминов?",
      fallbackMode: "none",
      reason: "dialogue_uncertainty_guided_choice",
      action: "answer",
      intent: "product_selection",
      requestedSlots: [],
      riskFlags: []
    };
  }

  return null;
}

export function duplicateRequestedSlot(
  input: AiTurnInput,
  plan: WidgetAiReplyPlan
): AiSlotName | null {
  const requested = plan.requestedSlots[0];
  if (!requested) return null;

  return analyzeWidgetDialogue(input).previouslyAskedSlots.includes(requested)
    ? requested
    : null;
}

export function guardUnsupportedWidgetReply(input: {
  turn: AiTurnInput;
  text: string;
}): WidgetAiRenderedReply | null {
  const visitorText = normalize(
    [
      ...input.turn.compactContext.messages
        .filter((message) => message.senderRole === "visitor")
        .map((message) => message.text),
      input.turn.inboundMessage.text
    ].join("\n")
  );
  const reply = normalize(input.text);
  const inventsMinsk = /\bминск(?:е|а|у|ом)?\b/u.test(reply) && !/\bминск/u.test(visitorText);
  const inventsCemetery = /кладбищ/u.test(reply) && !/кладбищ/u.test(visitorText);

  if (!inventsMinsk && !inventsCemetery) {
    return null;
  }

  return {
    text:
      "Не буду предполагать место установки. Продолжим только с теми деталями, которые вы сообщили сами; при желании подключу менеджера.",
    fallbackMode: "none",
    reason: "dialogue_unsupported_location_blocked",
    action: "answer",
    intent: "general_question",
    requestedSlots: [],
    riskFlags: ["missing_approved_source"]
  };
}

function hasRecentUncertainty(input: AiTurnInput): boolean {
  return input.compactContext.messages
    .filter((message) => message.senderRole === "visitor")
    .slice(-3)
    .some((message) => isUncertainty(normalize(message.text)));
}

function isUncertainty(value: string): boolean {
  return /(?:^|\s)(?:не\s+знаю|не\s+разбираюсь|не\s+понимаю|без\s+понятия|затрудняюсь|помогите\s+выбрать)(?:\s|$|[,.!?])/u.test(
    value
  );
}

function isFrustration(value: string): boolean {
  return /(?:я\s*ж(?:е)?\s+(?:сказал|говорил)|ты\s+(?:че|ч[ёе]|что).{0,32}(?:опять|тоже\s+самое|то\s+же|повтор|не\s+(?:слышишь|понимаешь))|опять\s+(?:то\s+же|повтор)|одно\s+и\s+то\s+же|сколько\s+можно|не\s+(?:слышишь|понимаешь)|уже\s+устал|хватит\s+спрашивать)/u.test(
    value
  );
}

function isUnsupportedLocationCorrection(value: string): boolean {
  return /(?:я\s+(?:ничего\s+)?(?:про\s+)?(?:минск|город|кладбищ)|(?:минск|город|кладбищ).{0,32}я)\S*.{0,36}(?:не\s+говорил|не\s+называл|не\s+писал)|я\s+(?:не|ничего\s+не).{0,36}(?:говорил|называл|писал).{0,36}(?:минск|город|кладбищ)/u.test(
    value
  );
}

function isOnePersonMemorialContext(value: string): boolean {
  return /(?:у\s+меня\s+)?(?:дед(?:ушка)?|бабушк[аи]|отец|пап[аеы]|мать|мам[аеы])(?:\s|$|[,.!?])/u.test(
    value
  );
}

function inferAskedSlots(message: string): AiSlotName[] {
  const slots: AiSlotName[] = [];
  if (/(?:какой|какого).{0,24}тип|одинарн|двойн|семейн|вертикальн|горизонтальн/u.test(message)) {
    slots.push("monumentType");
  }
  if (/какой.{0,20}материал|гранит|мрамор/u.test(message)) slots.push("material");
  if (/какой.{0,20}размер|габарит|ширин|высот/u.test(message)) slots.push("size");
  if (/каком.{0,16}город|какой.{0,16}район/u.test(message)) slots.push("city");
  if (/каком.{0,16}кладбищ/u.test(message)) slots.push("cemetery");
  if (/бюджет/u.test(message)) slots.push("budgetContext");
  if (/к\s+какому.{0,16}срок|когда|период/u.test(message)) slots.push("desiredTiming");
  if (/нужна\s+ли\s+установка/u.test(message)) slots.push("installation");
  if (/нужна\s+ли\s+гравировка/u.test(message)) slots.push("engraving");
  return slots;
}

function uniqueSlots(slots: AiSlotName[]): AiSlotName[] {
  return [...new Set(slots)];
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
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
    ? `${prefix} Использую уже указанный контакт.`
    : `${prefix} Если удобно, оставьте телефон или другой способ связи.`;
}
