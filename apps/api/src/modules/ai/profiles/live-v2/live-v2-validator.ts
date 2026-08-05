import { z } from "zod";

import type { LiveV2FactsSnapshot } from "./live-v2-assets.js";
import { liveV2ApprovedFactIds } from "./live-v2-assets.js";
import {
  LIVE_V2_CANDIDATE_VERSION,
  LIVE_V2_DECISION_PROFILE,
  type LiveV2Action,
  type LiveV2Candidate,
  type LiveV2Slot,
  type LiveV2TurnView,
  type LiveV2ValidationFailureCode,
  type LiveV2ValidationResult
} from "./live-v2-contract.js";

const actionSchema = z.enum([
  "answer",
  "ask_clarifying_question",
  "handoff_to_manager",
  "no_reply"
]);
const slotSchema = z.enum([
  "city",
  "preferred_contact",
  "contact_method",
  "memorial_type",
  "material",
  "decoration",
  "installation_site"
]);
const signalsSchema = z
  .object({
    managerRequest: z.enum(["absent", "negated", "explicit"]),
    mixedIntent: z.boolean()
  })
  .strict();
const evidenceSchema = z
  .object({
    basis: z
      .array(z.enum(["current_message", "recent_context", "known_slots", "approved_facts"]))
      .min(1)
      .max(4),
    usedFactIds: z
      .array(z.string().regex(/^P1Q-(?:TYPE|MAT|DECOR|PROC)-\d{3}$/))
      .max(20)
  })
  .strict();
const candidateBase = {
  schemaVersion: z.literal(LIVE_V2_CANDIDATE_VERSION),
  decisionProfile: z.literal(LIVE_V2_DECISION_PROFILE),
  signals: signalsSchema,
  evidence: evidenceSchema
};
const replyDraftSchema = z.string().trim().min(1).max(900);
export const liveV2CandidateSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...candidateBase,
      action: z.literal("answer"),
      replyDraft: replyDraftSchema,
      reason: z.literal("answer_ready"),
      missingSlots: z.tuple([])
    })
    .strict(),
  z
    .object({
      ...candidateBase,
      action: z.literal("ask_clarifying_question"),
      replyDraft: replyDraftSchema,
      reason: z.literal("missing_required_slot"),
      missingSlots: z.tuple([slotSchema])
    })
    .strict(),
  z
    .object({
      ...candidateBase,
      action: z.literal("handoff_to_manager"),
      replyDraft: replyDraftSchema,
      reason: z.enum(["explicit_manager_request", "manager_required"]),
      missingSlots: z.tuple([])
    })
    .strict(),
  z
    .object({
      ...candidateBase,
      action: z.literal("no_reply"),
      replyDraft: z.null(),
      reason: z.enum(["no_safe_answer", "missing_approved_fact"]),
      missingSlots: z.tuple([])
    })
    .strict()
]);

/**
 * OpenAI Structured Outputs requires the root JSON Schema to be an object rather than `anyOf`.
 * This provider-facing schema keeps every field required and applies only shape-level bounds;
 * `liveV2CandidateSchema` remains the authoritative action-specific app-owned validator.
 */
export const liveV2ProviderCandidateSchema = z
  .object({
    ...candidateBase,
    action: actionSchema,
    replyDraft: replyDraftSchema.nullable(),
    reason: z.enum([
      "answer_ready",
      "missing_required_slot",
      "explicit_manager_request",
      "manager_required",
      "no_safe_answer",
      "missing_approved_fact"
    ]),
    missingSlots: z.array(slotSchema).max(1)
  })
  .strict();

export const LIVE_V2_PROVIDER_CANDIDATE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "decisionProfile",
    "signals",
    "evidence",
    "action",
    "replyDraft",
    "reason",
    "missingSlots"
  ],
  properties: {
    schemaVersion: {
      type: "string",
      const: LIVE_V2_CANDIDATE_VERSION
    },
    decisionProfile: {
      type: "string",
      const: LIVE_V2_DECISION_PROFILE
    },
    signals: {
      type: "object",
      additionalProperties: false,
      required: ["managerRequest", "mixedIntent"],
      properties: {
        managerRequest: {
          type: "string",
          enum: ["absent", "negated", "explicit"]
        },
        mixedIntent: { type: "boolean" }
      }
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["basis", "usedFactIds"],
      properties: {
        basis: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "string",
            enum: ["current_message", "recent_context", "known_slots", "approved_facts"]
          }
        },
        usedFactIds: {
          type: "array",
          maxItems: 20,
          items: {
            type: "string",
            pattern: "^P1Q-(?:TYPE|MAT|DECOR|PROC)-[0-9]{3}$"
          }
        }
      }
    },
    action: {
      type: "string",
      enum: ["answer", "ask_clarifying_question", "handoff_to_manager", "no_reply"]
    },
    replyDraft: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 900 },
        { type: "null" }
      ]
    },
    reason: {
      type: "string",
      enum: [
        "answer_ready",
        "missing_required_slot",
        "explicit_manager_request",
        "manager_required",
        "no_safe_answer",
        "missing_approved_fact"
      ]
    },
    missingSlots: {
      type: "array",
      maxItems: 1,
      items: {
        type: "string",
        enum: [
          "city",
          "preferred_contact",
          "contact_method",
          "memorial_type",
          "material",
          "decoration",
          "installation_site"
        ]
      }
    }
  }
} as const satisfies Record<string, unknown>;

/**
 * P1Q validates a provider-neutral candidate's shape and deterministic safety invariants.
 * It intentionally does not claim to infer the visitor's intent from prose or prove semantic
 * entailment between arbitrary reply prose and a declared fact ID; those remain model-evaluation
 * gates before live traffic is enabled.
 */
export function validateLiveV2Candidate(input: {
  value: unknown;
  turnView: LiveV2TurnView;
  approvedFacts: LiveV2FactsSnapshot;
}): LiveV2ValidationResult {
  const preflightFailure = preflightCandidate(input.value);

  if (preflightFailure) {
    return invalid(preflightFailure);
  }

  const parsed = liveV2CandidateSchema.safeParse(input.value);

  if (!parsed.success) {
    return invalid(classifySchemaFailure(input.value));
  }

  const decision = parsed.data as LiveV2Candidate;
  const evidenceFailure = validateEvidence(decision, input.turnView, input.approvedFacts);

  if (evidenceFailure) {
    return invalid(evidenceFailure);
  }

  if (!signalsMatchAction(decision)) {
    return invalid("action_signal_mismatch");
  }

  if (decision.action === "no_reply") {
    return { ok: true, decision };
  }

  if (normalizeForComparison(decision.replyDraft).length < 2) {
    return invalid("invalid_reply_draft");
  }

  const questionCount = countQuestions(decision.replyDraft);

  if (
    questionCount > 1 ||
    (decision.action === "ask_clarifying_question" && questionCount !== 1)
  ) {
    return invalid("question_limit_exceeded");
  }

  if (
    decision.action === "ask_clarifying_question" &&
    isKnownSlot(decision.missingSlots[0], input.turnView)
  ) {
    return invalid("known_slot_requested");
  }

  if (unsafeClaimReason(decision.replyDraft)) {
    return invalid("unsafe_claim");
  }

  if (hasToneViolation(decision)) {
    return invalid("tone_violation");
  }

  if (repeatsExistingMessage(decision.replyDraft, input.turnView)) {
    return invalid("repeated_reply");
  }

  return { ok: true, decision };
}

function preflightCandidate(value: unknown): LiveV2ValidationFailureCode | null {
  if (!isRecord(value)) {
    return "invalid_shape";
  }

  if (typeof value.schemaVersion !== "string") {
    return "invalid_shape";
  }

  if (value.schemaVersion !== LIVE_V2_CANDIDATE_VERSION) {
    return "unsupported_schema_version";
  }

  if (typeof value.decisionProfile !== "string") {
    return "invalid_shape";
  }

  if (value.decisionProfile !== LIVE_V2_DECISION_PROFILE) {
    return "wrong_decision_profile";
  }

  if (typeof value.action !== "string") {
    return "invalid_shape";
  }

  if (!actionSchema.safeParse(value.action).success) {
    return "unsupported_action";
  }

  return null;
}

function classifySchemaFailure(value: unknown): LiveV2ValidationFailureCode {
  if (!isRecord(value)) {
    return "invalid_shape";
  }

  const action = value.action as LiveV2Action;
  const expectsReply = action !== "no_reply";

  if (
    (expectsReply &&
      (typeof value.replyDraft !== "string" ||
        !value.replyDraft.trim() ||
        value.replyDraft.trim().length > 900)) ||
    (!expectsReply && value.replyDraft !== null)
  ) {
    return "invalid_reply_draft";
  }

  if (!reasonMatchesAction(action, value.reason)) {
    return "invalid_reason";
  }

  if (!missingSlotsMatchAction(action, value.missingSlots)) {
    return "invalid_missing_slots";
  }

  if (!signalsSchema.safeParse(value.signals).success) {
    return "invalid_signals";
  }

  if (!evidenceSchema.safeParse(value.evidence).success) {
    return "invalid_evidence";
  }

  return "invalid_shape";
}

function reasonMatchesAction(action: LiveV2Action, reason: unknown): boolean {
  if (action === "answer") {
    return reason === "answer_ready";
  }

  if (action === "ask_clarifying_question") {
    return reason === "missing_required_slot";
  }

  if (action === "handoff_to_manager") {
    return reason === "explicit_manager_request" || reason === "manager_required";
  }

  return reason === "no_safe_answer" || reason === "missing_approved_fact";
}

function missingSlotsMatchAction(action: LiveV2Action, value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  if (action === "ask_clarifying_question") {
    return value.length === 1 && slotSchema.safeParse(value[0]).success;
  }

  return value.length === 0;
}

function validateEvidence(
  decision: LiveV2Candidate,
  turnView: LiveV2TurnView,
  approvedFacts: LiveV2FactsSnapshot
): LiveV2ValidationFailureCode | null {
  const basis = decision.evidence.basis;
  const usedFactIds = decision.evidence.usedFactIds;

  if (new Set(basis).size !== basis.length || new Set(usedFactIds).size !== usedFactIds.length) {
    return "invalid_evidence";
  }

  if (!basis.includes("current_message")) {
    return "invalid_evidence";
  }

  if (basis.includes("recent_context") && turnView.messages.length <= 1) {
    return "invalid_evidence";
  }

  if (basis.includes("known_slots") && !hasAnyKnownSlot(turnView)) {
    return "invalid_evidence";
  }

  if (basis.includes("approved_facts") !== (usedFactIds.length > 0)) {
    return "fact_evidence_mismatch";
  }

  if (
    (decision.action === "handoff_to_manager" || decision.action === "no_reply") &&
    usedFactIds.length > 0
  ) {
    return "fact_evidence_mismatch";
  }

  const approvedFactIds = liveV2ApprovedFactIds(approvedFacts);

  if (usedFactIds.some((factId) => !approvedFactIds.has(factId))) {
    return "unknown_fact_id";
  }

  if (
    typeof decision.replyDraft === "string" &&
    approvedFacts.facts.some(
      (fact) =>
        normalizedContains(decision.replyDraft, fact.allowedCustomerWording) &&
        !usedFactIds.includes(fact.id)
    )
  ) {
    return "fact_evidence_mismatch";
  }

  return null;
}

function signalsMatchAction(decision: LiveV2Candidate): boolean {
  if (decision.signals.managerRequest === "explicit") {
    return (
      decision.action === "handoff_to_manager" &&
      decision.reason === "explicit_manager_request"
    );
  }

  if (decision.signals.managerRequest === "negated") {
    return decision.action !== "handoff_to_manager";
  }

  if (decision.action === "handoff_to_manager") {
    return decision.reason === "manager_required";
  }

  return true;
}

function countQuestions(replyDraft: string): number {
  return [...replyDraft].filter((character) => character === "?").length;
}

function isKnownSlot(slot: LiveV2Slot, turnView: LiveV2TurnView): boolean {
  if (slot === "city") {
    return Boolean(turnView.knownSlots.city);
  }

  if (slot === "preferred_contact") {
    return Boolean(turnView.knownSlots.preferredContact);
  }

  if (slot === "contact_method") {
    return Boolean(
      turnView.knownSlots.phoneProvided ||
        turnView.knownSlots.emailProvided ||
        turnView.knownSlots.preferredContact
    );
  }

  return false;
}

function hasAnyKnownSlot(turnView: LiveV2TurnView): boolean {
  return Boolean(
    turnView.knownSlots.customerNameProvided ||
      turnView.knownSlots.phoneProvided ||
      turnView.knownSlots.emailProvided ||
      turnView.knownSlots.preferredContact ||
      turnView.knownSlots.city
  );
}

function unsafeClaimReason(replyDraft: string): string | null {
  const normalized = replyDraft.toLocaleLowerCase("ru-RU");

  if (/\d[\d\s]*(?:₽|руб|р\.)/iu.test(normalized)) {
    return "price_amount";
  }

  if (
    /(?:цен|стоим|прайс|бюджет|сумм|стоит|обойд[её]тся).{0,32}(?:(?:^|[^\p{L}\p{N}])от\s+\d|\d[\d\s]{2,}(?:тыс|тысяч)?|\d[\d\s]*[-–—]\s*\d)/iu.test(
      normalized
    ) ||
    /(?:цен|стоим|стоит|обойд[её]тся).{0,48}(?:один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|сто|ста|двести|триста|четыреста|пятьсот)(?:\s+\p{L}+){0,5}\s+(?:руб|тысяч)/iu.test(
      normalized
    )
  ) {
    return "price_orientation";
  }

  if (
    /(?:за|через)\s+(?:\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s*(?:дн|час|нед|месяц)|(?:срок.{0,20})?(?:\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s*(?:дн|час|нед|месяц)|будет\s+готов|точн(?:ый|ые|о)\s+срок|к\s+\d{1,2}[./]\d{1,2}|(?:сделаем|изготовим|установим|доставим|выполним).{0,24}(?:завтра|послезавтра|к\s+[а-яё]+|до\s+\d{1,2}[./]\d{1,2})/iu.test(
      normalized
    )
  ) {
    return "deadline_promise";
  }

  if (
    /(?:^|[^\p{L}\p{N}])в\s+наличии(?:$|[^\p{L}\p{N}])|есть\s+на\s+складе|доступн\p{L}*\s+(?:к|для)\s+заказ|(?:модел|товар|вариант).{0,20}доступн\p{L}*.{0,12}(?:сейчас|сегодня)|(?:дадим|сделаем|предоставим|оформим)\s+(?:вам\s+)?скидк|скидк[ауи]\s*\d|(?:бер[её]м|нужна|требуется|вносится)\s+предоплат|предоплат\p{L}*.{0,16}\d|оплатить\s+можно|принимаем\s+оплату|оплата\s+(?:доступна|производится|картой|наличными|по\s+сч[её]ту)|рассрочк[ауи]|возврат\s+(?:оформим|гарантируем|возможен)|верн[её]м\s+деньги|гарантируем|(?:дадим|предоставим|оформим)\s+гаранти|гаранти\p{L}*.{0,20}(?:действует|на\s+(?:\d+|один|два|три|четыре|пять)|составляет|(?:\d+|один|два|три|четыре|пять)\s+(?:год|лет))|(?:работаем\s+по|заключим|подпишем|оформим)\s+(?:официальн\p{L}*\s+)?договор|(?:за\s+.{0,30}отвечаем|отвечаем.{0,30}\sза|нес[её]м\s+ответственность)/iu.test(
      normalized
    )
  ) {
    return "binding_terms";
  }

  if (
    /по\s+закону|юридическ(?:ая\s+консультация|ие\s+советы)|наследств|оформить\s+захоронение|похоронные\s+документы|(?:кладбищ|захоронен|монтаж|установк).{0,60}(?:разрешен\p{L}*|запрещен\p{L}*|не\s+(?:требуется|нужно|ограничен\p{L}*))|документ\p{L}*.{0,24}(?:можно\s+не|не\s+(?:нужно|требуется))/iu.test(
      normalized
    )
  ) {
    return "legal_advice";
  }

  if (
    /(?:служит|прослужит).{0,24}(?:\d+|один|два|три|четыре|пять|десять|сто|ста)\s+лет|не\s+(?:выцвет|треск|впитыва)|(?:морозо|водо|износо)стойк|(?:самый|очень|особенно)\s+(?:прочн|долговечн)|добыва\p{L}*\s+в\s+[а-яё]+|\d+(?:[.,]\d+)?\s*(?:х|×|на)\s*\d+(?:[.,]\d+)?\s*(?:мм|см|сантиметр|метр)/iu.test(
      normalized
    )
  ) {
    return "unsupported_product_claim";
  }

  if (
    /собственн\p{L}*\s+производств|(?:доставляем|работаем)\s+по\s+всей\s+росси|сам\p{L}*\s+популярн\p{L}*\s+модел|пользу\p{L}*\s+спросом|(?:сейчас|это)\s+в\s+тренде/iu.test(
      normalized
    )
  ) {
    return "unsupported_business_claim";
  }

  return null;
}

function hasToneViolation(decision: Exclude<LiveV2Candidate, { action: "no_reply" }>): boolean {
  const normalized = decision.replyDraft.toLocaleLowerCase("ru-RU");

  if (/понимаю\s+ваши\s+чувства|искренне\s+сочувствую|как\s+мне\s+жаль/iu.test(normalized)) {
    return true;
  }

  const pressuresForPhone =
    /(?:оставьте|напишите|пришлите)\s+(?:ваш\s+)?(?:номер|телефон)/iu.test(normalized);

  return (
    pressuresForPhone &&
    !(
      decision.action === "handoff_to_manager" &&
      decision.reason === "explicit_manager_request"
    )
  );
}

function repeatsExistingMessage(replyDraft: string, turnView: LiveV2TurnView): boolean {
  const normalizedReply = normalizeForComparison(replyDraft);
  const normalizedLastQuestion = turnView.lastAiQuestion
    ? normalizeForComparison(turnView.lastAiQuestion)
    : null;

  if (normalizedLastQuestion && normalizedReply.includes(normalizedLastQuestion)) {
    return true;
  }

  return turnView.messages.some(
    (message) => normalizeForComparison(message.text) === normalizedReply
  );
}

function normalizeForComparison(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedContains(value: string, expectedSubstring: string): boolean {
  return normalizeForComparison(value).includes(normalizeForComparison(expectedSubstring));
}

function invalid(code: LiveV2ValidationFailureCode): LiveV2ValidationResult {
  return { ok: false, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
