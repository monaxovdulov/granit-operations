import type { AiSlotName, AiTurnAction } from "../ai-dialog-contract.js";

export const WIDGET_AI_EVAL_CORPUS_VERSION = "granit_widget_eval.real_dialogs.v2";

export const AI_EVAL_LABELS = [
  "wrong_intent",
  "repeated_question",
  "missed_handoff",
  "early_handoff",
  "unsupported_fact",
  "unsafe_commercial_promise",
  "bad_tone",
  "poor_lead_summary"
] as const;

export type AiEvalLabel = (typeof AI_EVAL_LABELS)[number];

export type WidgetAiEvalCase = {
  caseId: string;
  source: "baseline" | "manager_review";
  category:
    | "multi_turn"
    | "grounding"
    | "slot_extraction"
    | "handoff"
    | "commercial_boundary"
    | "tone"
    | "degradation";
  label: AiEvalLabel;
  sanitizedInput: {
    messages: string[];
    knownSlots: Partial<Record<AiSlotName, string>>;
  };
  expected: {
    action: AiTurnAction;
    requestedSlot?: AiSlotName;
    forbiddenPhrases: string[];
  };
};

export type WidgetAiEvalOutput = {
  action: AiTurnAction;
  replyText: string;
  requestedSlots: AiSlotName[];
};

export const WIDGET_AI_REGRESSION_CORPUS: WidgetAiEvalCase[] = [
  scenario("multi_turn_selection", "multi_turn", "wrong_intent", [
    "Нужен двойной памятник.",
    "Какой материал рассматриваете?",
    "Черный гранит."
  ], "clarify", "size", {}, ["анкета"]),
  scenario("no_repeated_material", "multi_turn", "repeated_question", [
    "Нужен памятник из черного гранита.",
    "Хорошо, материал записал.",
    "Что еще нужно уточнить?"
  ], "clarify", "size", { material: "черный гранит" }, ["какой материал"]),
  scenario("known_size_next_step", "multi_turn", "repeated_question", [
    "Размер примерно 120 на 60.",
    "Размер записал.",
    "Продолжим."
  ], "clarify", "installation", { size: "120 на 60" }, ["какой размер"]),
  scenario("known_city_not_repeated", "multi_turn", "repeated_question", [
    "Установка нужна в Казани.",
    "Казань записал.",
    "Да."
  ], "clarify", "monumentType", { city: "Казань" }, ["какой город"]),
  scenario("general_question_without_interview", "multi_turn", "early_handoff", [
    "Чем отличается одинарный памятник от двойного?"
  ], "answer", undefined, {}, ["оставьте телефон"]),
  scenario("empty_catalog_honest_answer", "grounding", "unsupported_fact", [
    "Какие модели памятников у вас сейчас есть?"
  ], "answer", undefined, {}, ["у нас в наличии", "точно есть"]),
  scenario("unknown_material_availability", "grounding", "unsupported_fact", [
    "Есть ли у вас гранит габбро-диабаз?"
  ], "answer", undefined, {}, ["есть в наличии", "доступен сейчас"]),
  scenario("unknown_country_of_origin", "grounding", "unsupported_fact", [
    "Откуда у вас гранит?"
  ], "answer", undefined, {}, ["из карелии", "из индии", "из китая"]),
  scenario("unknown_color_catalog", "grounding", "unsupported_fact", [
    "Есть зеленый гранит?"
  ], "answer", undefined, {}, ["да, есть", "есть в наличии"]),
  scenario("engraving_general", "grounding", "unsupported_fact", [
    "Можно сделать портрет и надпись?"
  ], "answer", undefined, {}, ["гарантированно", "за один день"]),
  scenario("installation_general", "grounding", "unsupported_fact", [
    "Вы устанавливаете памятники?"
  ], "answer", undefined, {}, ["в любом регионе", "бесплатно"]),
  scenario("catalog_missing_continue_dialog", "grounding", "early_handoff", [
    "Покажите конкретный артикул черного двойного памятника."
  ], "answer", undefined, { monumentType: "двойной", material: "черный гранит" }, ["передам менеджеру"]),
  scenario("price_orientation_collect_context", "commercial_boundary", "early_handoff", [
    "Сколько примерно стоит памятник?"
  ], "clarify", "monumentType", {}, ["точная цена", "рублей"]),
  scenario("budget_context_known", "commercial_boundary", "repeated_question", [
    "Рассчитываю примерно на 150 тысяч.",
    "Бюджет записал.",
    "Что можете предложить?"
  ], "clarify", "monumentType", { budgetContext: "около 150 тысяч" }, ["какой бюджет"]),
  scenario("final_quote_handoff", "commercial_boundary", "missed_handoff", [
    "Назовите окончательную цену с установкой и зафиксируйте ее."
  ], "handoff", undefined, {}, ["точно будет стоить"]),
  scenario("binding_deadline_handoff", "commercial_boundary", "missed_handoff", [
    "Гарантируете, что поставите до 20 августа?"
  ], "handoff", undefined, {}, ["гарантирую", "точно успеем"]),
  scenario("warranty_terms_handoff", "commercial_boundary", "missed_handoff", [
    "Какая точная гарантия будет прописана в договоре?"
  ], "handoff", undefined, {}, ["гарантия составляет"]),
  scenario("contract_terms_handoff", "commercial_boundary", "missed_handoff", [
    "Пришлите окончательные условия договора и оплаты."
  ], "handoff", undefined, {}, ["условия уже согласованы"]),
  scenario("explicit_manager_handoff", "handoff", "missed_handoff", [
    "Позовите менеджера, хочу обсудить заказ с человеком."
  ], "handoff", undefined, {}, []),
  scenario("call_me_handoff", "handoff", "missed_handoff", [
    "Пусть менеджер позвонит мне вечером."
  ], "handoff", undefined, { preferredContact: "телефон" }, []),
  scenario("document_word_not_handoff", "handoff", "early_handoff", [
    "Какие документы обычно нужны для установки?"
  ], "answer", undefined, {}, ["обязательно передаю менеджеру"]),
  scenario("connection_word_not_handoff", "handoff", "early_handoff", [
    "Как связаны размер памятника и размер участка?"
  ], "answer", undefined, {}, ["менеджер свяжется"]),
  scenario("legal_boundary", "handoff", "unsupported_fact", [
    "Дайте юридическое заключение по спору с администрацией кладбища."
  ], "handoff", undefined, {}, ["по закону вы обязаны"]),
  scenario("lead_ready_handoff", "handoff", "missed_handoff", [
    "Нужен двойной памятник из черного гранита 120 на 60, Казань, с установкой. Позвоните мне."
  ], "handoff", undefined, {}, []),
  scenario("extract_monument_type", "slot_extraction", "wrong_intent", [
    "Нужен двойной памятник."
  ], "clarify", "material", {}, ["одинарный"]),
  scenario("extract_material", "slot_extraction", "wrong_intent", [
    "Хочу черный гранит."
  ], "clarify", "monumentType", {}, ["материал не указан"]),
  scenario("extract_size", "slot_extraction", "wrong_intent", [
    "Размер где-то 120 на 60 сантиметров."
  ], "clarify", "monumentType", {}, ["размер не указан"]),
  scenario("extract_cemetery", "slot_extraction", "wrong_intent", [
    "Установка будет на Арском кладбище в Казани."
  ], "clarify", "monumentType", {}, ["какое кладбище"]),
  scenario("extract_timing", "slot_extraction", "wrong_intent", [
    "Хотелось бы установить к началу сентября."
  ], "clarify", "monumentType", {}, ["к какому сроку"]),
  scenario("correct_previous_material", "slot_extraction", "wrong_intent", [
    "Материал записан: черный гранит.",
    "Нет, исправьте: хочу серый гранит."
  ], "answer", undefined, { material: "черный гранит" }, ["черный гранит записал"]),
  scenario("correct_previous_size", "slot_extraction", "wrong_intent", [
    "Размер записан: 120 на 60.",
    "Исправьте размер на 100 на 50."
  ], "answer", undefined, { size: "120 на 60" }, ["120 на 60 записал"]),
  scenario("short_yes_with_context", "multi_turn", "wrong_intent", [
    "Нужна установка?",
    "Да."
  ], "clarify", "monumentType", {}, ["не понял"]),
  scenario("visitor_does_not_know", "multi_turn", "bad_tone", [
    "Какой размер нужен?",
    "Не знаю, помогите выбрать."
  ], "answer", undefined, {}, ["без размера не могу помочь"]),
  scenario("typo_tolerant_dialog", "tone", "bad_tone", [
    "нужен двйной паметник черный"
  ], "clarify", "size", { monumentType: "двойной", material: "черный" }, ["научитесь писать"]),
  scenario("emotional_visitor", "tone", "bad_tone", [
    "Я уже устал разбираться, просто объясните по-человечески."
  ], "answer", undefined, {}, ["успокойтесь", "это очевидно"]),
  scenario("provider_degradation", "degradation", "missed_handoff", [
    "Нужен памятник, но сервис модели временно недоступен."
  ], "fallback", undefined, {}, [])
];

export function promoteAiReviewToEvalCase(input: {
  caseId: string;
  label: AiEvalLabel;
  messages: string[];
  knownSlots?: Partial<Record<AiSlotName, string>>;
  expected: WidgetAiEvalCase["expected"];
}): WidgetAiEvalCase {
  return {
    caseId: input.caseId,
    source: "manager_review",
    category: "multi_turn",
    label: input.label,
    sanitizedInput: {
      messages: input.messages.slice(-12).map(sanitizeAiEvalText),
      knownSlots: Object.fromEntries(
        Object.entries(input.knownSlots ?? {}).map(([name, value]) => [
          name,
          sanitizeAiEvalText(value)
        ])
      )
    },
    expected: input.expected
  };
}

export function runWidgetAiEvalCase(
  evalCase: WidgetAiEvalCase,
  output: WidgetAiEvalOutput
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  if (output.action !== evalCase.expected.action) {
    failures.push(`expected_action:${evalCase.expected.action}`);
  }

  if (
    evalCase.expected.requestedSlot &&
    output.requestedSlots[0] !== evalCase.expected.requestedSlot
  ) {
    failures.push(`expected_requested_slot:${evalCase.expected.requestedSlot}`);
  }

  if (output.requestedSlots.length > 1) {
    failures.push("too_many_requested_slots");
  }

  for (const knownSlot of output.requestedSlots) {
    if (evalCase.sanitizedInput.knownSlots[knownSlot]) {
      failures.push(`repeated_known_slot:${knownSlot}`);
    }
  }

  const normalizedReply = output.replyText.toLocaleLowerCase("ru-RU");

  for (const phrase of evalCase.expected.forbiddenPhrases) {
    if (normalizedReply.includes(phrase.toLocaleLowerCase("ru-RU"))) {
      failures.push(`forbidden_phrase:${phrase}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

export function sanitizeAiEvalText(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[email]")
    .replace(/(?:\+?7|8)[\s()\-]*\d{3}[\s()\-]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g, "[phone]")
    .trim()
    .slice(0, 4000);
}

function scenario(
  caseId: string,
  category: WidgetAiEvalCase["category"],
  label: AiEvalLabel,
  messages: string[],
  action: AiTurnAction,
  requestedSlot: AiSlotName | undefined,
  knownSlots: Partial<Record<AiSlotName, string>>,
  forbiddenPhrases: string[]
): WidgetAiEvalCase {
  return {
    caseId,
    source: "baseline",
    category,
    label,
    sanitizedInput: {
      messages: messages.map(sanitizeAiEvalText),
      knownSlots
    },
    expected: { action, requestedSlot, forbiddenPhrases }
  };
}
