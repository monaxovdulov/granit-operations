import { sha256Hex } from '@granit/shared';
import { z } from 'zod';

import {
  AI_REQUIREMENT_CATEGORIES,
  AI_REQUIREMENT_MODES,
  AI_SLOT_NAMES,
  type AiHandoffReason,
  type AiRequirementUpdate,
  type AiRiskFlag,
  type AiSlotName,
  type AiSlotUpdate,
} from '../../ai-dialog-contract.js';
import {
  PUBLIC_WIDGET_CATALOG_ACTION_LIMIT,
  type AiTurnInput,
} from '../../ai-turn.js';
import {
  CATALOG_SEARCH_INPUT_JSON_SCHEMA,
  catalogSearchInputSchema,
  type CatalogSearchCandidate,
} from '../../catalog/catalog-search-tool.js';
import {
  isRequirementValueSupportedByEvidence,
  isSlotValueSupportedByEvidence,
} from '../../grounding/ai-slot-evidence-service.js';
import {
  FINAL_TURN_ACTIONS,
  MODEL_TURN_HANDOFF_REASONS,
  MODEL_TURN_OUTPUT_VERSION,
  type FinalTurnAction,
  type FinalTurnResult,
  type ModelTurnAction,
  type ModelTurnHandoffReason,
  type ModelTurnValidationIssue,
  type ModelTurnValidationResult,
  type ProposedStatePatch,
  type RejectedStatePatch,
  type ValidatedTurnPlan,
} from './model-turn-contract.js';
import { normalizeLiveV2TextForComparison } from './live-v2-validator.js';

const quoteEvidenceSchema = z.object({ quote: z.string().min(1).max(900) }).strict();
const slotPatchSchema = z
  .object({
    operation: z.literal('set_slot'),
    name: z.enum(AI_SLOT_NAMES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: quoteEvidenceSchema,
  })
  .strict();
const requirementPatchSchema = z
  .object({
    operation: z.literal('upsert_requirement'),
    category: z.enum(AI_REQUIREMENT_CATEGORIES),
    mode: z.enum(AI_REQUIREMENT_MODES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: quoteEvidenceSchema,
  })
  .strict();
const statePatchesSchema = z
  .array(z.discriminatedUnion('operation', [slotPatchSchema, requirementPatchSchema]))
  .max(32);
const clarifyingQuestionSchema = z
  .object({
    text: z.string().trim().min(1).max(320),
    target: z.enum(AI_SLOT_NAMES),
  })
  .strict()
  .nullable();

export const finalTurnResultSchema = z
  .object({
    version: z.literal(MODEL_TURN_OUTPUT_VERSION),
    action: z.enum(FINAL_TURN_ACTIONS),
    message: z.string().trim().min(1).max(900),
    clarifyingQuestion: clarifyingQuestionSchema,
    statePatches: statePatchesSchema,
    recommendationIds: z.array(z.string().regex(/^ent_[a-f0-9]{16}$/)).max(8),
    handoffIntent: z
      .object({ reason: z.enum(MODEL_TURN_HANDOFF_REASONS) })
      .strict()
      .nullable(),
  })
  .strict();

export const modelTurnActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      version: z.literal(MODEL_TURN_OUTPUT_VERSION),
      type: z.literal('final'),
      result: finalTurnResultSchema,
      input: z.null().optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(MODEL_TURN_OUTPUT_VERSION),
      type: z.literal('search_catalog'),
      input: catalogSearchInputSchema,
      result: z.null().optional(),
    })
    .strict(),
]);

const stringEnum = (values: readonly string[]) => ({
  type: 'string',
  enum: [...values],
});
const quoteEvidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['quote'],
  properties: { quote: { type: 'string', minLength: 1, maxLength: 900 } },
} as const;
const statePatchesJsonSchema = {
  type: 'array',
  maxItems: 32,
  items: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'name', 'value', 'confidence', 'evidence'],
        properties: {
          operation: { type: 'string', const: 'set_slot' },
          name: stringEnum(AI_SLOT_NAMES),
          value: { type: 'string', minLength: 1, maxLength: 240 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: quoteEvidenceJsonSchema,
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: [
          'operation',
          'category',
          'mode',
          'value',
          'confidence',
          'evidence',
        ],
        properties: {
          operation: { type: 'string', const: 'upsert_requirement' },
          category: stringEnum(AI_REQUIREMENT_CATEGORIES),
          mode: stringEnum(AI_REQUIREMENT_MODES),
          value: { type: 'string', minLength: 1, maxLength: 240 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: quoteEvidenceJsonSchema,
        },
      },
    ],
  },
} as const;
const questionJsonSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'target'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 320 },
        target: stringEnum(AI_SLOT_NAMES),
      },
    },
    { type: 'null' },
  ],
} as const;

export const FINAL_TURN_RESULT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'action',
    'message',
    'clarifyingQuestion',
    'statePatches',
    'recommendationIds',
    'handoffIntent',
  ],
  properties: {
    version: { type: 'string', const: MODEL_TURN_OUTPUT_VERSION },
    action: stringEnum(FINAL_TURN_ACTIONS),
    message: { type: 'string', minLength: 1, maxLength: 900 },
    clarifyingQuestion: questionJsonSchema,
    statePatches: statePatchesJsonSchema,
    recommendationIds: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', pattern: '^ent_[a-f0-9]{16}$' },
    },
    handoffIntent: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['reason'],
          properties: { reason: stringEnum(MODEL_TURN_HANDOFF_REASONS) },
        },
        { type: 'null' },
      ],
    },
  },
} as const satisfies Record<string, unknown>;

export const MODEL_TURN_ACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'type', 'result', 'input'],
  properties: {
    version: { type: 'string', const: MODEL_TURN_OUTPUT_VERSION },
    type: { type: 'string', enum: ['final', 'search_catalog'] },
    result: { anyOf: [FINAL_TURN_RESULT_JSON_SCHEMA, { type: 'null' }] },
    input: { anyOf: [CATALOG_SEARCH_INPUT_JSON_SCHEMA, { type: 'null' }] },
  },
} as const satisfies Record<string, unknown>;

export function parseModelTurnAction(value: unknown): ModelTurnAction | null {
  const parsed = modelTurnActionSchema.safeParse(value);
  return parsed.success ? (parsed.data as ModelTurnAction) : null;
}

export function validateFinalTurnResult(input: {
  value: unknown;
  turnInput: AiTurnInput;
  catalogCandidates?: readonly CatalogSearchCandidate[];
  publishedCatalogIds?: ReadonlySet<string>;
}): ModelTurnValidationResult {
  const parsed = finalTurnResultSchema.safeParse(input.value);
  if (!parsed.success) return { ok: false, code: 'invalid_shape' };

  const output = parsed.data as FinalTurnResult;
  if (
    output.clarifyingQuestion &&
    countQuestionMarks(output.clarifyingQuestion.text) > 1
  ) {
    return { ok: false, code: 'invalid_question' };
  }
  const messageWithoutDuplicatedQuestion = output.clarifyingQuestion &&
      output.message.trim().endsWith(output.clarifyingQuestion.text.trim())
    ? output.message
        .trim()
        .slice(0, -output.clarifyingQuestion.text.trim().length)
        .trim()
    : output.message;
  if (
    messageWithoutDuplicatedQuestion.includes('?') ||
    messageWithoutDuplicatedQuestion.includes('？')
  ) {
    return { ok: false, code: 'invalid_question' };
  }
  if (output.handoffIntent && output.clarifyingQuestion) {
    return { ok: false, code: 'invalid_question' };
  }
  if (output.handoffIntent && output.action !== 'answer') {
    return { ok: false, code: 'invalid_action' };
  }
  if (output.action !== actionFor(output.recommendationIds, output.clarifyingQuestion)) {
    return { ok: false, code: 'invalid_action' };
  }

  const patchResult = validateStatePatches(output.statePatches, input.turnInput);
  const questionTarget = output.clarifyingQuestion?.target;
  const questionTargetsKnownSlot = Boolean(
    questionTarget &&
      (isKnownSlot(questionTarget, input.turnInput) ||
        patchResult.applied.some(
          (patch) => 'name' in patch && patch.name === questionTarget,
        )),
  );
  const composed = composeCanonicalText(output, questionTargetsKnownSlot);
  if (!composed) return { ok: false, code: 'invalid_answer' };

  const validationResults: ModelTurnValidationIssue[] = [
    ...composed.validationResults,
    ...patchResult.dropped.map((item) => item.reason),
  ];
  const recommendationResult = validateRecommendations(
    output.recommendationIds,
    input.catalogCandidates ?? [],
    input.publishedCatalogIds,
  );
  if (recommendationResult.dropped.length > 0) {
    validationResults.push('unsupported_recommendation');
  }

  const responseAction = actionFor(
    recommendationResult.accepted,
    composed.question,
  );
  if (responseAction !== output.action) validationResults.push('action_repaired');
  const action = output.handoffIntent
    ? 'handoff_to_manager'
    : composed.question
      ? 'ask_clarifying_question'
      : 'answer';
  const handoff = output.handoffIntent
    ? toValidatedHandoff(output.handoffIntent.reason)
    : undefined;
  const plan: ValidatedTurnPlan = {
    action,
    responseAction,
    reason:
      output.handoffIntent?.reason ??
      (composed.question ? 'question_ready' : 'answer_ready'),
    finalText: composed.finalText,
    finalTextHash: sha256Hex(composed.finalText),
    appliedPatches: patchResult.applied,
    droppedPatches: patchResult.dropped,
    recommendationIds: recommendationResult.accepted,
    droppedRecommendationIds: recommendationResult.dropped,
    riskAssessment: {
      flags: deriveRiskFlags(output.handoffIntent?.reason),
      requiresSemanticVerifier: false,
    },
    validationResults: [...new Set(validationResults)],
    ...(handoff ? { handoffAction: handoff } : {}),
  };

  return { ok: true, output, plan: Object.freeze(plan) };
}

function actionFor(
  recommendationIds: readonly string[],
  question: FinalTurnResult['clarifyingQuestion'],
): FinalTurnAction {
  if (recommendationIds.length > 0) {
    return question ? 'recommend_and_clarify' : 'recommend';
  }
  return question ? 'clarify' : 'answer';
}

function countQuestionMarks(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === '?' || character === '？') count += 1;
  }
  return count;
}

function validateRecommendations(
  recommendationIds: readonly string[],
  candidates: readonly CatalogSearchCandidate[],
  publishedCatalogIds: ReadonlySet<string> | undefined,
): { accepted: string[]; dropped: string[] } {
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const unique = new Set(recommendationIds);
  const isValidSubset =
    unique.size === recommendationIds.length &&
    recommendationIds.every(
      (id) => allowed.has(id) && (!publishedCatalogIds || publishedCatalogIds.has(id)),
    );

  return isValidSubset
    ? {
        accepted: recommendationIds.slice(0, PUBLIC_WIDGET_CATALOG_ACTION_LIMIT),
        dropped: recommendationIds.slice(PUBLIC_WIDGET_CATALOG_ACTION_LIMIT),
      }
    : { accepted: [], dropped: [...recommendationIds] };
}

function composeCanonicalText(
  output: FinalTurnResult,
  dropKnownSlotQuestion: boolean,
): {
  finalText: string;
  question: FinalTurnResult['clarifyingQuestion'];
  validationResults: ModelTurnValidationIssue[];
} | null {
  let message = output.message.trim();
  let question = output.clarifyingQuestion
    ? {
        text: output.clarifyingQuestion.text.trim(),
        target: output.clarifyingQuestion.target,
      }
    : null;
  const validationResults: ModelTurnValidationIssue[] = [];

  if (question) {
    if (message.endsWith(question.text)) {
      message = message.slice(0, -question.text.length).trim();
      validationResults.push('duplicate_question');
    }
    if (dropKnownSlotQuestion) {
      question = null;
      validationResults.push('known_slot_requested');
    }
  }

  let finalText = question
    ? message
      ? `${message}\n\n${question.text}`
      : question.text
    : message;
  if (question && finalText.length > 900) {
    question = null;
    finalText = message;
    validationResults.push('question_dropped_for_length');
  }
  return finalText ? { finalText, question, validationResults } : null;
}

function validateStatePatches(
  patches: ProposedStatePatch[],
  turnInput: AiTurnInput,
): {
  applied: Array<AiSlotUpdate | AiRequirementUpdate>;
  dropped: RejectedStatePatch[];
} {
  const applied: Array<AiSlotUpdate | AiRequirementUpdate> = [];
  const dropped: RejectedStatePatch[] = [];
  const seen = new Set<string>();

  for (const patch of patches) {
    const key =
      patch.operation === 'set_slot'
        ? `slot:${patch.name}`
        : `requirement:${patch.category}:${patch.mode}:${normalizeLiveV2TextForComparison(patch.value)}`;
    if (seen.has(key)) {
      dropped.push({ patch, reason: 'duplicate_patch' });
      continue;
    }
    seen.add(key);

    const evidence = locateUniqueEvidence(
      turnInput.inboundMessage.text,
      patch.evidence.quote,
    );
    const valueIsSupported =
      patch.operation === 'set_slot'
        ? isSlotValueSupportedByEvidence(
            patch.name,
            patch.value,
            patch.evidence.quote,
          )
        : isRequirementValueSupportedByEvidence(
            patch.value,
            patch.evidence.quote,
          );
    if (!evidence || !valueIsSupported) {
      dropped.push({ patch, reason: 'invalid_patch_evidence' });
      continue;
    }

    const common = {
      value: patch.value,
      confidence: patch.confidence,
      source: 'ai_extraction' as const,
      sourceMessageId: turnInput.inboundMessage.publicMessageId,
      evidence: {
        messageId: turnInput.inboundMessage.publicMessageId,
        quote: patch.evidence.quote,
        ...evidence,
      },
    };
    if (patch.operation === 'set_slot') {
      applied.push({ name: patch.name, ...common });
    } else {
      applied.push({
        category: patch.category,
        mode: patch.mode,
        ...common,
      });
    }
  }
  return { applied, dropped };
}

function locateUniqueEvidence(
  text: string,
  quote: string,
): { start: number; end: number } | null {
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) >= 0) return null;
  return { start, end: start + quote.length };
}

function isKnownSlot(slot: AiSlotName, input: AiTurnInput): boolean {
  if (input.knownSlots.values[slot]) return true;
  if (slot === 'customerName') return input.knownSlots.customerNameProvided;
  if (slot === 'phone') return input.knownSlots.phoneProvided;
  if (slot === 'preferredContact') return Boolean(input.knownSlots.preferredContact);
  if (slot === 'city') return Boolean(input.knownSlots.city);
  return false;
}

function toValidatedHandoff(reason: ModelTurnHandoffReason): {
  reason: AiHandoffReason;
  sourceReason: ModelTurnHandoffReason;
} {
  const reasons: Record<ModelTurnHandoffReason, AiHandoffReason> = {
    customer_requested_manager: 'manager_requested',
    customer_wants_final_quote: 'final_quote_pressure',
    customer_ready_to_order: 'lead_ready',
  };
  return { reason: reasons[reason], sourceReason: reason };
}

function deriveRiskFlags(reason: ModelTurnHandoffReason | undefined): AiRiskFlag[] {
  if (reason === 'customer_requested_manager') return ['manager_requested'];
  if (reason === 'customer_wants_final_quote') {
    return ['exact_price_requested', 'final_quote_pressure'];
  }
  return [];
}
