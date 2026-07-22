import type {
  AiRequirementCategory,
  AiRequirementMode,
  AiSlotName,
  AiTextEvidence,
  AiTurnAction
} from "../ai-dialog-contract.js";

export const WIDGET_AI_EVAL_CORPUS_VERSION = "granit_widget_eval.real_dialogs.v5";

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
    extractedSlots?: Partial<
      Record<AiSlotName, { value: string; evidenceIncludes: string }>
    >;
    requirements?: Array<{
      category: AiRequirementCategory;
      mode: AiRequirementMode;
      value: string;
      evidenceIncludes: string;
    }>;
    requireGroundingVerified?: boolean;
    requireClaimCoverage?: boolean;
    maxLatencyMs?: number;
    minReplyCharacters?: number;
    requiredPhrasesAny?: string[];
  };
};

export type WidgetAiEvalOutput = {
  action: AiTurnAction;
  replyText: string;
  requestedSlots: AiSlotName[];
  slotUpdates?: Array<{
    name: AiSlotName;
    value: string;
    evidence?: AiTextEvidence;
  }>;
  requirementUpdates?: Array<{
    category: AiRequirementCategory;
    mode: AiRequirementMode;
    value: string;
    evidence: AiTextEvidence;
  }>;
  groundingVerified?: boolean;
  claimCoverageComplete?: boolean;
  verifierVerdict?: string;
  verifierViolations?: string[];
  latencyMs?: number;
};

export const WIDGET_AI_REGRESSION_CORPUS: WidgetAiEvalCase[] = [
  scenario("issue14_uncertainty_guided_choice", "multi_turn", "repeated_question", [
    "Нужен расчет памятника с установкой",
    "Для расчёта сначала уточним детали. Какой тип памятника нужен: одинарный, двойной, семейный или комплекс?",
    "не знаю"
  ], "answer", undefined, {}, ["какой тип памятника", "одинарный, двойной"], {
    requiredPhrasesAny: ["разбираться", "без терминов", "показать примеры"]
  }),
  scenario("issue14_tentative_one_person_context", "multi_turn", "wrong_intent", [
    "не знаю",
    "Это нормально — разбираться в типах памятников не нужно. Показать примеры без терминов?",
    "у меня дед"
  ], "answer", undefined, {}, ["какое кладбище", "минск"], {
    requiredPhrasesAny: ["для дедушки", "для одного человека", "как ориентир"]
  }),
  scenario("issue14_first_frustration_repair", "multi_turn", "bad_tone", [
    "у меня дед",
    "Понял. Показать несколько простых вариантов?",
    "я ж сказал не знаю я не разбираюсь"
  ], "answer", undefined, {}, ["какой тип", "какое кладбище", "минск"], {
    requiredPhrasesAny: ["извините", "не буду повторять"]
  }),
  scenario("issue14_repeated_frustration_handoff", "multi_turn", "missed_handoff", [
    "я ж сказал не знаю я не разбираюсь",
    "Извините, больше не буду повторять вопрос. Могу показать варианты или передать менеджеру.",
    "ты че тоже самое мне говоришь"
  ], "handoff", undefined, {}, ["какой тип", "какое кладбище", "минск"]),
  scenario("issue14_retract_invented_location", "multi_turn", "unsupported_fact", [
    "На каком кладбище в Минске планируется установка?",
    "я ничего про минск не говорил"
  ], "answer", undefined, {}, ["на каком кладбище"], {
    requiredPhrasesAny: ["вы не называли", "не буду учитывать", "вы не говорили"]
  }),
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
  ], "clarify", "material", {}, ["одинарный"], {
    extractedSlots: {
      monumentType: { value: "двойной", evidenceIncludes: "двойной памятник" }
    }
  }),
  scenario("extract_material", "slot_extraction", "wrong_intent", [
    "Хочу черный гранит."
  ], "clarify", "monumentType", {}, ["материал не указан"], {
    extractedSlots: {
      material: { value: "черный гранит", evidenceIncludes: "черный гранит" }
    }
  }),
  scenario("extract_size", "slot_extraction", "wrong_intent", [
    "Размер где-то 120 на 60 сантиметров."
  ], "clarify", "monumentType", {}, ["размер не указан"], {
    extractedSlots: {
      size: { value: "120 на 60 сантиметров", evidenceIncludes: "120 на 60 сантиметров" }
    }
  }),
  scenario("extract_cemetery", "slot_extraction", "wrong_intent", [
    "Установка будет на Арском кладбище в Казани."
  ], "clarify", "monumentType", {}, ["какое кладбище"], {
    extractedSlots: {
      cemetery: { value: "Арское кладбище", evidenceIncludes: "Арском кладбище" },
      city: { value: "Казань", evidenceIncludes: "Казани" }
    }
  }),
  scenario("extract_timing", "slot_extraction", "wrong_intent", [
    "Хотелось бы установить к началу сентября."
  ], "clarify", "monumentType", {}, ["к какому сроку"], {
    extractedSlots: {
      desiredTiming: { value: "к началу сентября", evidenceIncludes: "к началу сентября" }
    }
  }),
  scenario("correct_previous_material", "slot_extraction", "wrong_intent", [
    "Материал записан: черный гранит.",
    "Нет, исправьте: хочу серый гранит."
  ], "answer", undefined, { material: "черный гранит" }, ["черный гранит записал"], {
    extractedSlots: {
      material: { value: "серый гранит", evidenceIncludes: "серый гранит" }
    }
  }),
  scenario("correct_previous_size", "slot_extraction", "wrong_intent", [
    "Размер записан: 120 на 60.",
    "Исправьте размер на 100 на 50."
  ], "answer", undefined, { size: "120 на 60" }, ["120 на 60 записал"], {
    extractedSlots: {
      size: { value: "100 на 50", evidenceIncludes: "100 на 50" }
    }
  }),
  scenario("extract_style_preference", "slot_extraction", "wrong_intent", [
    "Хочу современный лаконичный стиль."
  ], "clarify", "monumentType", {}, [], {
    requirements: [
      {
        category: "style",
        mode: "preference",
        value: "современный лаконичный стиль",
        evidenceIncludes: "современный лаконичный стиль"
      }
    ]
  }),
  scenario("extract_color_avoidance", "slot_extraction", "wrong_intent", [
    "Только не красный цвет."
  ], "clarify", "monumentType", {}, [], {
    requirements: [
      {
        category: "color",
        mode: "avoidance",
        value: "красный цвет",
        evidenceIncludes: "не красный цвет"
      }
    ]
  }),
  scenario("extract_site_constraint", "slot_extraction", "wrong_intent", [
    "На участке узкий проход шириной 90 сантиметров."
  ], "clarify", "monumentType", {}, [], {
    requirements: [
      {
        category: "site_constraint",
        mode: "requirement",
        value: "проход шириной 90 сантиметров",
        evidenceIncludes: "проход шириной 90 сантиметров"
      }
    ]
  }),
  scenario("extract_accessory_requirement", "slot_extraction", "wrong_intent", [
    "Обязательно нужна ваза для цветов."
  ], "clarify", "monumentType", {}, [], {
    requirements: [
      {
        category: "accessory",
        mode: "requirement",
        value: "ваза для цветов",
        evidenceIncludes: "ваза для цветов"
      }
    ]
  }),
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

  for (const [name, expectedSlot] of Object.entries(
    evalCase.expected.extractedSlots ?? {}
  ) as Array<[
    AiSlotName,
    NonNullable<WidgetAiEvalCase["expected"]["extractedSlots"]>[AiSlotName]
  ]>) {
    const actual = output.slotUpdates?.find((slot) => slot.name === name);

    if (!actual) {
      failures.push(`missing_extracted_slot:${name}`);
      continue;
    }

    if (normalizeForEval(actual.value) !== normalizeForEval(expectedSlot!.value)) {
      failures.push(`wrong_extracted_value:${name}`);
    }

    if (
      !actual.evidence ||
      !normalizeForEval(actual.evidence.quote).includes(
        normalizeForEval(expectedSlot!.evidenceIncludes)
      ) ||
      !hasExactEvalEvidence(evalCase, actual.evidence)
    ) {
      failures.push(`invalid_extracted_evidence:${name}`);
    }
  }

  for (const expectedRequirement of evalCase.expected.requirements ?? []) {
    const actual = output.requirementUpdates?.find(
      (requirement) =>
        requirement.category === expectedRequirement.category &&
        requirement.mode === expectedRequirement.mode &&
        normalizeForEval(requirement.value) === normalizeForEval(expectedRequirement.value)
    );

    if (!actual) {
      failures.push(
        `missing_requirement:${expectedRequirement.category}:${expectedRequirement.mode}`
      );
    } else if (
      !normalizeForEval(actual.evidence.quote).includes(
        normalizeForEval(expectedRequirement.evidenceIncludes)
      ) ||
      !hasExactEvalEvidence(evalCase, actual.evidence)
    ) {
      failures.push(`invalid_requirement_evidence:${expectedRequirement.category}`);
    }
  }

  if (evalCase.expected.requireGroundingVerified && !output.groundingVerified) {
    failures.push("grounding_not_verified");
  }

  if (evalCase.expected.requireClaimCoverage && !output.claimCoverageComplete) {
    failures.push("claim_coverage_incomplete");
  }

  if (
    evalCase.expected.maxLatencyMs !== undefined &&
    (output.latencyMs === undefined || output.latencyMs > evalCase.expected.maxLatencyMs)
  ) {
    failures.push(`latency_exceeded:${evalCase.expected.maxLatencyMs}`);
  }

  if (
    evalCase.expected.minReplyCharacters !== undefined &&
    output.replyText.trim().length < evalCase.expected.minReplyCharacters
  ) {
    failures.push(`reply_too_short:${evalCase.expected.minReplyCharacters}`);
  }

  if (
    evalCase.expected.requiredPhrasesAny?.length &&
    !evalCase.expected.requiredPhrasesAny.some((phrase) =>
      normalizedReply.includes(normalizeForEval(phrase))
    )
  ) {
    failures.push("missing_required_answer_content");
  }

  if ((output.replyText.match(/\?/gu) ?? []).length > 1) {
    failures.push("too_many_questions_in_reply");
  }

  if (
    output.verifierViolations?.some(
      (violation) => violation === "unhelpful_response" || violation === "unnatural_tone"
    )
  ) {
    failures.push("semantic_quality_violation");
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
  forbiddenPhrases: string[],
  additionalExpected: Partial<WidgetAiEvalCase["expected"]> = {}
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
    expected: {
      action,
      requestedSlot,
      forbiddenPhrases,
      requireGroundingVerified: action !== "fallback",
      requireClaimCoverage: action !== "fallback",
      maxLatencyMs: 20_000,
      minReplyCharacters: action === "fallback" ? undefined : 10,
      ...additionalExpected
    }
  };
}

function normalizeForEval(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

function hasExactEvalEvidence(
  evalCase: WidgetAiEvalCase,
  evidence: AiTextEvidence
): boolean {
  return evalCase.sanitizedInput.messages.some(
    (message) =>
      evidence.start >= 0 &&
      evidence.end > evidence.start &&
      evidence.end <= message.length &&
      message.slice(evidence.start, evidence.end) === evidence.quote
  );
}
