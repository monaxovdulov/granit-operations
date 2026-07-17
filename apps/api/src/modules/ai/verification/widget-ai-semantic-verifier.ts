import { z } from "zod";

import type { CatalogRecord, CatalogSnapshot } from "../catalog/catalog-knowledge-port.js";
import {
  AI_SLOT_NAMES,
  GROUNDED_AI_TURN_ACTIONS,
  type GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export const WIDGET_AI_VERIFIER_VERSION = "granit_widget_ai_verifier.v1" as const;

export const WIDGET_AI_VERDICTS = ["pass", "repair", "handoff", "block"] as const;
export type WidgetAiVerdict = (typeof WIDGET_AI_VERDICTS)[number];

export const WIDGET_AI_VERIFICATION_VIOLATIONS = [
  "unsupported_claim",
  "invalid_catalog_reference",
  "expired_commercial_fact",
  "invalid_slot_evidence",
  "commercial_promise",
  "legal_advice",
  "missed_manager_request",
  "repeated_question",
  "wrong_handoff",
  "too_many_questions",
  "low_confidence"
] as const;
export type WidgetAiVerificationViolation =
  (typeof WIDGET_AI_VERIFICATION_VIOLATIONS)[number];

const WidgetAiViolationSchema = z
  .object({
    code: z.enum(WIDGET_AI_VERIFICATION_VIOLATIONS),
    detail: z.string().trim().min(1).max(240),
    claimStart: z.number().int().min(0).max(900).nullable(),
    claimEnd: z.number().int().min(1).max(900).nullable()
  })
  .strict();

const WidgetAiSlotVerdictSchema = z
  .object({
    name: z.enum(AI_SLOT_NAMES),
    valid: z.boolean(),
    detail: z.string().trim().min(1).max(240).nullable()
  })
  .strict();

export const WidgetAiVerificationSchema = z
  .object({
    version: z.literal(WIDGET_AI_VERIFIER_VERSION),
    verdict: z.enum(WIDGET_AI_VERDICTS),
    requiredAction: z.enum(GROUNDED_AI_TURN_ACTIONS).nullable(),
    violations: z.array(WidgetAiViolationSchema).max(24),
    slotVerdicts: z.array(WidgetAiSlotVerdictSchema).max(AI_SLOT_NAMES.length),
    confidence: z.number().min(0).max(1)
  })
  .strict();

export type WidgetAiVerification = z.infer<typeof WidgetAiVerificationSchema>;

export type WidgetAiVerifierInput = {
  turn: AiTurnInput;
  decision: GroundedAiTurnCandidateDecision;
  snapshot: CatalogSnapshot;
  selectedRecords: readonly CatalogRecord[];
  instructions: string;
  userInput: string;
};

export type WidgetAiVerifierUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type WidgetAiVerifierResult = {
  verification: WidgetAiVerification;
  modelProvider: "openai" | "fake";
  modelName: string;
  responseId?: string;
  usage?: WidgetAiVerifierUsage;
};

export interface WidgetAiSemanticVerifier {
  verify(input: WidgetAiVerifierInput, signal?: AbortSignal): Promise<WidgetAiVerifierResult>;
}

const stringEnumSchema = (values: readonly string[]) => ({
  type: "string",
  enum: [...values]
});

export const WIDGET_AI_VERIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", const: WIDGET_AI_VERIFIER_VERSION },
    verdict: stringEnumSchema(WIDGET_AI_VERDICTS),
    requiredAction: {
      anyOf: [stringEnumSchema(GROUNDED_AI_TURN_ACTIONS), { type: "null" }]
    },
    violations: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          code: stringEnumSchema(WIDGET_AI_VERIFICATION_VIOLATIONS),
          detail: { type: "string", minLength: 1, maxLength: 240 },
          claimStart: { type: ["integer", "null"], minimum: 0, maximum: 900 },
          claimEnd: { type: ["integer", "null"], minimum: 1, maximum: 900 }
        },
        required: ["code", "detail", "claimStart", "claimEnd"]
      }
    },
    slotVerdicts: {
      type: "array",
      maxItems: AI_SLOT_NAMES.length,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: stringEnumSchema(AI_SLOT_NAMES),
          valid: { type: "boolean" },
          detail: { type: ["string", "null"], maxLength: 240 }
        },
        required: ["name", "valid", "detail"]
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "version",
    "verdict",
    "requiredAction",
    "violations",
    "slotVerdicts",
    "confidence"
  ]
} as const;

export function buildWidgetAiVerifierInstructions(): string {
  return [
    "Ты независимый semantic verifier ответа AI-консультанта Granit.",
    "Не доверяй claim annotations основной модели: самостоятельно проверь каждое фактическое утверждение в replyText.",
    "Факт о компании, ассортименте, цене, сроке, наличии, гарантии или услуге допустим только при точном подтверждении переданными catalogRecords.",
    "Факт о клиенте или его пожелании допустим только при подтверждении visitor message и evidence span.",
    "Разговорная связка и осторожная рекомендация допустимы без catalog source, если они не превращаются в бизнес-факт или гарантию.",
    "Отсутствие знания допустимо честно обозначить; оно само по себе не требует handoff.",
    "Определи просьбу о менеджере, юридический совет и обязательное коммерческое обещание по смыслу всего контекста, а не по отдельным словам.",
    "pass допустим только если ответ можно отправить без исправлений.",
    "repair выбери для исправимого ответа; handoff — когда приложение обязано передать диалог; block — когда draft нельзя отправлять и безопасный repair невозможен.",
    "Не возвращай рассуждения или скрытые цепочки мыслей, только JSON verdict."
  ].join("\n");
}

export function buildWidgetAiVerifierUserInput(input: {
  turn: AiTurnInput;
  decision: GroundedAiTurnCandidateDecision;
  snapshot: CatalogSnapshot;
  selectedRecords: readonly CatalogRecord[];
}): string {
  return JSON.stringify({
    currentMessage: input.turn.inboundMessage,
    recentMessages: input.turn.compactContext.messages,
    knownSlots: input.turn.knownSlots.values,
    decision: input.decision,
    catalogSnapshot: {
      schemaVersion: input.snapshot.schemaVersion,
      catalogVersion: input.snapshot.catalogVersion,
      contentHash: input.snapshot.contentHash
    },
    catalogRecords: input.selectedRecords
  });
}

