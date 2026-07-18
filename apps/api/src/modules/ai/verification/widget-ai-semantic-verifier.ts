import { z } from "zod";

import type { CatalogRecord, CatalogSnapshot } from "../catalog/catalog-knowledge-port.js";
import {
  AI_REQUIREMENT_CATEGORIES,
  AI_REQUIREMENT_MODES,
  AI_SLOT_NAMES,
  CatalogReferenceSchema,
  GROUNDED_AI_TURN_ACTIONS,
  AiTextEvidenceSchema,
  type GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export const WIDGET_AI_VERIFIER_VERSION = "granit_widget_ai_verifier.v2" as const;

export const WIDGET_AI_VERDICTS = ["pass", "repair", "handoff", "block"] as const;
export type WidgetAiVerdict = (typeof WIDGET_AI_VERDICTS)[number];

export const WIDGET_AI_VERIFICATION_VIOLATIONS = [
  "unsupported_claim",
  "incomplete_claim_coverage",
  "invalid_claim_evidence",
  "invalid_catalog_reference",
  "expired_commercial_fact",
  "invalid_slot_evidence",
  "invalid_requirement_evidence",
  "commercial_promise",
  "legal_advice",
  "missed_manager_request",
  "repeated_question",
  "wrong_handoff",
  "too_many_questions",
  "unhelpful_response",
  "unnatural_tone",
  "low_confidence"
] as const;
export type WidgetAiVerificationViolation =
  (typeof WIDGET_AI_VERIFICATION_VIOLATIONS)[number];

export const WIDGET_AI_VERIFIED_CLAIM_KINDS = [
  "catalog",
  "visitor_message",
  "system_policy",
  "unsupported"
] as const;

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
    value: z.string().trim().min(1).max(240),
    evidence: AiTextEvidenceSchema,
    valueSupportedByEvidence: z.boolean(),
    valid: z.boolean(),
    detail: z.string().trim().min(1).max(240).nullable()
  })
  .strict();

const WidgetAiRequirementVerdictSchema = z
  .object({
    category: z.enum(AI_REQUIREMENT_CATEGORIES),
    mode: z.enum(AI_REQUIREMENT_MODES),
    value: z.string().trim().min(1).max(240),
    evidence: AiTextEvidenceSchema,
    valueSupportedByEvidence: z.boolean(),
    valid: z.boolean(),
    detail: z.string().trim().min(1).max(240).nullable()
  })
  .strict();

const WidgetAiClaimVerdictSchema = z
  .object({
    text: z.string().min(1).max(900),
    start: z.number().int().min(0).max(900),
    end: z.number().int().min(1).max(900),
    kind: z.enum(WIDGET_AI_VERIFIED_CLAIM_KINDS),
    supported: z.boolean(),
    catalogReference: CatalogReferenceSchema.nullable(),
    messageEvidence: AiTextEvidenceSchema.nullable(),
    systemPolicyId: z.string().trim().min(1).max(120).nullable(),
    detail: z.string().trim().min(1).max(240).nullable()
  })
  .strict();

export const WidgetAiVerificationSchema = z
  .object({
    version: z.literal(WIDGET_AI_VERIFIER_VERSION),
    verdict: z.enum(WIDGET_AI_VERDICTS),
    requiredAction: z.enum(GROUNDED_AI_TURN_ACTIONS).nullable(),
    violations: z.array(WidgetAiViolationSchema).max(24),
    factualClaimsPresent: z.boolean(),
    claimCoverageComplete: z.boolean(),
    claimVerdicts: z.array(WidgetAiClaimVerdictSchema).max(24),
    slotVerdicts: z.array(WidgetAiSlotVerdictSchema).max(AI_SLOT_NAMES.length),
    requirementVerdicts: z.array(WidgetAiRequirementVerdictSchema).max(24),
    confidence: z.number().min(0).max(1)
  })
  .strict()
  .superRefine((verification, context) => {
    if (verification.factualClaimsPresent !== (verification.claimVerdicts.length > 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["factualClaimsPresent"],
        message: "factualClaimsPresent must match claimVerdicts"
      });
    }

    if (
      verification.verdict === "pass" &&
      (!verification.claimCoverageComplete ||
        verification.violations.length > 0 ||
        verification.claimVerdicts.some((claim) => !claim.supported) ||
        verification.slotVerdicts.some(
          (slot) => !slot.valid || !slot.valueSupportedByEvidence
        ) ||
        verification.requirementVerdicts.some(
          (requirement) => !requirement.valid || !requirement.valueSupportedByEvidence
        ))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verdict"],
        message: "pass requires complete and fully supported verification"
      });
    }
  });

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

const nullableObjectSchema = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }]
});

const TEXT_EVIDENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    messageId: { type: "string", minLength: 36, maxLength: 36 },
    quote: { type: "string", minLength: 1, maxLength: 900 },
    start: { type: "integer", minimum: 0, maximum: 12000 },
    end: { type: "integer", minimum: 1, maximum: 12000 }
  },
  required: ["messageId", "quote", "start", "end"]
} as const;

const CATALOG_REFERENCE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recordId: { type: "string", minLength: 1, maxLength: 160 },
    revision: { type: "integer", minimum: 1 },
    path: { type: "string", maxLength: 300 },
    catalogVersion: { type: "string", minLength: 1, maxLength: 160 }
  },
  required: ["recordId", "revision", "path", "catalogVersion"]
} as const;

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
    factualClaimsPresent: { type: "boolean" },
    claimCoverageComplete: { type: "boolean" },
    claimVerdicts: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string", minLength: 1, maxLength: 900 },
          start: { type: "integer", minimum: 0, maximum: 900 },
          end: { type: "integer", minimum: 1, maximum: 900 },
          kind: stringEnumSchema(WIDGET_AI_VERIFIED_CLAIM_KINDS),
          supported: { type: "boolean" },
          catalogReference: nullableObjectSchema(CATALOG_REFERENCE_JSON_SCHEMA),
          messageEvidence: nullableObjectSchema(TEXT_EVIDENCE_JSON_SCHEMA),
          systemPolicyId: { type: ["string", "null"], maxLength: 120 },
          detail: { type: ["string", "null"], maxLength: 240 }
        },
        required: [
          "text",
          "start",
          "end",
          "kind",
          "supported",
          "catalogReference",
          "messageEvidence",
          "systemPolicyId",
          "detail"
        ]
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
          value: { type: "string", minLength: 1, maxLength: 240 },
          evidence: TEXT_EVIDENCE_JSON_SCHEMA,
          valueSupportedByEvidence: { type: "boolean" },
          valid: { type: "boolean" },
          detail: { type: ["string", "null"], maxLength: 240 }
        },
        required: [
          "name",
          "value",
          "evidence",
          "valueSupportedByEvidence",
          "valid",
          "detail"
        ]
      }
    },
    requirementVerdicts: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: stringEnumSchema(AI_REQUIREMENT_CATEGORIES),
          mode: stringEnumSchema(AI_REQUIREMENT_MODES),
          value: { type: "string", minLength: 1, maxLength: 240 },
          evidence: TEXT_EVIDENCE_JSON_SCHEMA,
          valueSupportedByEvidence: { type: "boolean" },
          valid: { type: "boolean" },
          detail: { type: ["string", "null"], maxLength: 240 }
        },
        required: [
          "category",
          "mode",
          "value",
          "evidence",
          "valueSupportedByEvidence",
          "valid",
          "detail"
        ]
      }
    },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  },
  required: [
    "version",
    "verdict",
    "requiredAction",
    "violations",
    "factualClaimsPresent",
    "claimCoverageComplete",
    "claimVerdicts",
    "slotVerdicts",
    "requirementVerdicts",
    "confidence"
  ]
} as const;

export function buildWidgetAiVerifierInstructions(): string {
  return [
    "Ты независимый semantic verifier готового ответа AI-консультанта Granit.",
    "Генератор больше не размечает claims: именно ты обязан заново найти ВСЕ объективно проверяемые factual spans в replyText и вернуть их в claimVerdicts с точными UTF-16 start/end offsets.",
    "Не включай в claimVerdicts вопросы, эмпатию и чисто разговорные связки. Если фактических фрагментов нет, верни factualClaimsPresent=false и пустой claimVerdicts.",
    "claimCoverageComplete=true означает, что ни один factual span не пропущен. verdict=pass запрещен при неполном покрытии.",
    "Факт о компании, ассортименте, материале, услуге, цене, сроке, наличии, гарантии или договоре допустим только при точном подтверждении catalogRecords.",
    "Факт о клиенте или его пожелании допустим только при visitor message evidence. App-owned оговорка допустима только с известным systemPolicyId.",
    "Для КАЖДОГО extractedSlot верни ровно один slotVerdict: дословно повтори name, value и evidence кандидата и отдельно проверь, что значение по смыслу следует из цитаты и контекста.",
    "Для КАЖДОГО extractedRequirement верни ровно один requirementVerdict с теми же category, mode, value и evidence и проверь смысловую связь значения с доказательством.",
    "Не добавляй verdict для несуществующего slot или requirement и не дублируй verdict.",
    "Разговорная рекомендация допустима без catalog source только если не превращается в бизнес-факт, общеобразовательное утверждение или гарантию.",
    "Отсутствие знания допустимо честно обозначить; оно само по себе не требует handoff.",
    "Определи просьбу о менеджере, юридический совет и обязательное коммерческое обещание по смыслу всего контекста.",
    "Проверь полезность и естественность: короткий вопрос допускает краткий ответ, а явная просьба объяснить или сравнить допускает более развернутый ответ до лимита.",
    "pass допустим только если ответ можно отправить без исправлений; repair — для одной исправимой попытки; handoff — для немедленной app-owned передачи; block — если безопасный ответ невозможен.",
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
    rollingSummary: input.turn.compactContext.rollingSummary ?? null,
    knownSlots: input.turn.knownSlots.values,
    knownRequirements: input.turn.knownRequirements,
    decision: input.decision,
    catalogSnapshot: {
      schemaVersion: input.snapshot.schemaVersion,
      catalogVersion: input.snapshot.catalogVersion,
      contentHash: input.snapshot.contentHash
    },
    catalogRecords: input.selectedRecords
  });
}
