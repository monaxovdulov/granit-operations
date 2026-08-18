import { sha256Hex } from "@granit/shared";
import { z } from "zod";

import {
  AI_REQUIREMENT_CATEGORIES,
  AI_REQUIREMENT_MODES,
  AI_SLOT_NAMES,
  type AiHandoffReason,
  type AiRequirementUpdate,
  type AiRiskFlag,
  type AiSlotName,
  type AiSlotUpdate
} from "../../ai-dialog-contract.js";
import type { AiTurnInput } from "../../ai-turn.js";
import {
  isRequirementValueSupportedByEvidence,
  isSlotValueSupportedByEvidence
} from "../../grounding/ai-slot-evidence-service.js";
import {
  MODEL_TURN_HANDOFF_REASONS,
  MODEL_TURN_OUTPUT_VERSION,
  type ModelTurnHandoffReason,
  type ModelTurnOutput,
  type ModelTurnValidationIssue,
  type ModelTurnValidationResult,
  type ProposedStatePatch,
  type RejectedStatePatch,
  type ValidatedTurnPlan
} from "./model-turn-contract.js";
import {
  liveV2TextHasToneViolation,
  liveV2UnsafeClaimReason,
  normalizeLiveV2TextForComparison
} from "./live-v2-validator.js";

const quoteEvidenceSchema = z.object({ quote: z.string().min(1).max(900) }).strict();
const slotPatchSchema = z
  .object({
    operation: z.literal("set_slot"),
    name: z.enum(AI_SLOT_NAMES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: quoteEvidenceSchema
  })
  .strict();
const requirementPatchSchema = z
  .object({
    operation: z.literal("upsert_requirement"),
    category: z.enum(AI_REQUIREMENT_CATEGORIES),
    mode: z.enum(AI_REQUIREMENT_MODES),
    value: z.string().trim().min(1).max(240),
    confidence: z.number().min(0).max(1),
    evidence: quoteEvidenceSchema
  })
  .strict();

export const modelTurnOutputSchema = z
  .object({
    version: z.literal(MODEL_TURN_OUTPUT_VERSION),
    message: z
      .object({
        answerText: z.string().trim().min(1).max(900),
        question: z
          .object({
            text: z.string().trim().min(1).max(320),
            target: z.enum(AI_SLOT_NAMES)
          })
          .strict()
          .nullable()
      })
      .strict(),
    statePatches: z
      .array(z.discriminatedUnion("operation", [slotPatchSchema, requirementPatchSchema]))
      .max(32),
    recommendationIds: z.array(z.string().regex(/^[A-Za-z0-9._:/@+-]{1,160}$/)).max(6),
    handoffIntent: z
      .object({ reason: z.enum(MODEL_TURN_HANDOFF_REASONS) })
      .strict()
      .nullable()
  })
  .strict();

const stringEnum = (values: readonly string[]) => ({ type: "string", enum: [...values] });
const quoteEvidenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote"],
  properties: { quote: { type: "string", minLength: 1, maxLength: 900 } }
} as const;

export const MODEL_TURN_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "message",
    "statePatches",
    "recommendationIds",
    "handoffIntent"
  ],
  properties: {
    version: { type: "string", const: MODEL_TURN_OUTPUT_VERSION },
    message: {
      type: "object",
      additionalProperties: false,
      required: ["answerText", "question"],
      properties: {
        answerText: { type: "string", minLength: 1, maxLength: 900 },
        question: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["text", "target"],
              properties: {
                text: { type: "string", minLength: 1, maxLength: 320 },
                target: stringEnum(AI_SLOT_NAMES)
              }
            },
            { type: "null" }
          ]
        }
      }
    },
    statePatches: {
      type: "array",
      maxItems: 32,
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["operation", "name", "value", "confidence", "evidence"],
            properties: {
              operation: { type: "string", const: "set_slot" },
              name: stringEnum(AI_SLOT_NAMES),
              value: { type: "string", minLength: 1, maxLength: 240 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: quoteEvidenceJsonSchema
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "operation",
              "category",
              "mode",
              "value",
              "confidence",
              "evidence"
            ],
            properties: {
              operation: { type: "string", const: "upsert_requirement" },
              category: stringEnum(AI_REQUIREMENT_CATEGORIES),
              mode: stringEnum(AI_REQUIREMENT_MODES),
              value: { type: "string", minLength: 1, maxLength: 240 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: quoteEvidenceJsonSchema
            }
          }
        ]
      }
    },
    recommendationIds: {
      type: "array",
      maxItems: 6,
      items: { type: "string", pattern: "^[A-Za-z0-9._:/@+-]{1,160}$" }
    },
    handoffIntent: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: stringEnum(MODEL_TURN_HANDOFF_REASONS) }
        },
        { type: "null" }
      ]
    }
  }
} as const satisfies Record<string, unknown>;

export function validateModelTurnOutput(input: {
  value: unknown;
  turnInput: AiTurnInput;
}): ModelTurnValidationResult {
  const parsed = modelTurnOutputSchema.safeParse(input.value);

  if (!parsed.success) {
    return { ok: false, code: "invalid_shape" };
  }

  const output = parsed.data as ModelTurnOutput;
  const composed = composeCanonicalText(output);

  if (!composed) {
    return { ok: false, code: output.message.question ? "duplicate_question" : "invalid_answer" };
  }

  if (output.handoffIntent && composed.question) {
    return { ok: false, code: "invalid_question" };
  }

  if (liveV2UnsafeClaimReason(composed.finalText)) {
    return { ok: false, code: "unsafe_claim" };
  }

  if (liveV2TextHasToneViolation(composed.finalText)) {
    return { ok: false, code: "tone_violation" };
  }

  if (repeatsExistingReply(composed.finalText, input.turnInput)) {
    return { ok: false, code: "repeated_reply" };
  }

  const patchResult = validateStatePatches(output.statePatches, input.turnInput);

  if (
    composed.question &&
    (isKnownSlot(composed.question.target, input.turnInput) ||
      patchResult.applied.some(
        (patch) => "name" in patch && patch.name === composed.question?.target
      ))
  ) {
    return { ok: false, code: "known_slot_requested" };
  }

  const validationResults: ModelTurnValidationIssue[] = patchResult.dropped.map(
    (item) => item.reason
  );

  if (output.recommendationIds.length > 0) {
    validationResults.push("unsupported_recommendation");
  }

  const action = output.handoffIntent
    ? "handoff_to_manager"
    : composed.question
      ? "ask_clarifying_question"
      : "answer";
  const handoff = output.handoffIntent
    ? toValidatedHandoff(output.handoffIntent.reason)
    : undefined;
  const riskFlags = deriveRiskFlags(output.handoffIntent?.reason);
  const plan: ValidatedTurnPlan = {
    action,
    reason: output.handoffIntent?.reason ?? (composed.question ? "question_ready" : "answer_ready"),
    finalText: composed.finalText,
    finalTextHash: sha256Hex(composed.finalText),
    appliedPatches: patchResult.applied,
    droppedPatches: patchResult.dropped,
    recommendationIds: [],
    droppedRecommendationIds: [...output.recommendationIds],
    riskAssessment: {
      flags: riskFlags,
      requiresSemanticVerifier: false
    },
    validationResults: [...new Set(validationResults)],
    ...(handoff ? { handoffAction: handoff } : {})
  };

  return { ok: true, output, plan: Object.freeze(plan) };
}

function composeCanonicalText(output: ModelTurnOutput): {
  finalText: string;
  question: ModelTurnOutput["message"]["question"];
} | null {
  let answerText = output.message.answerText.trim();
  const question = output.message.question
    ? {
        text: output.message.question.text.trim(),
        target: output.message.question.target
      }
    : null;

  if (question) {
    answerText = stripDuplicatedQuestionSuffix(answerText, question.text);

    if (
      !answerText ||
      countQuestions(answerText) !== 0 ||
      countQuestions(question.text) !== 1
    ) {
      return null;
    }
  } else if (countQuestions(answerText) > 1) {
    return null;
  }

  const finalText = question ? `${answerText}\n\n${question.text}` : answerText;
  return finalText.length <= 900 ? { finalText, question } : null;
}

function stripDuplicatedQuestionSuffix(answerText: string, questionText: string): string {
  const normalizedQuestion = normalizeLiveV2TextForComparison(questionText);
  if (!normalizedQuestion) return "";

  for (let index = 0; index < answerText.length; index += 1) {
    const suffix = answerText.slice(index).trim();

    if (
      normalizeLiveV2TextForComparison(suffix) !== normalizedQuestion ||
      !isTextBoundary(answerText, index)
    ) {
      continue;
    }

    const prefix = answerText
      .slice(0, index)
      .trim()
      .replace(/[,:;\-–—]+$/u, "")
      .trim();

    if (!prefix) return "";
    return /[.!?]$/u.test(prefix) ? prefix : `${prefix}.`;
  }

  return answerText;
}

function isTextBoundary(value: string, index: number): boolean {
  if (index === 0) return true;
  const previous = value[index - 1];
  const current = value[index];
  return (
    !previous ||
    !current ||
    !/[\p{L}\p{N}]/u.test(previous) ||
    !/[\p{L}\p{N}]/u.test(current)
  );
}

function validateStatePatches(
  patches: ProposedStatePatch[],
  turnInput: AiTurnInput
): {
  applied: Array<AiSlotUpdate | AiRequirementUpdate>;
  dropped: RejectedStatePatch[];
} {
  const applied: Array<AiSlotUpdate | AiRequirementUpdate> = [];
  const dropped: RejectedStatePatch[] = [];
  const seen = new Set<string>();

  for (const patch of patches) {
    const key = patch.operation === "set_slot"
      ? `slot:${patch.name}`
      : `requirement:${patch.category}:${patch.mode}:${normalizeLiveV2TextForComparison(patch.value)}`;

    if (seen.has(key)) {
      dropped.push({ patch, reason: "duplicate_patch" });
      continue;
    }
    seen.add(key);

    const evidence = locateUniqueEvidence(turnInput.inboundMessage.text, patch.evidence.quote);
    const valueIsSupported =
      patch.operation === "set_slot"
        ? isSlotValueSupportedByEvidence(patch.name, patch.value, patch.evidence.quote)
        : isRequirementValueSupportedByEvidence(patch.value, patch.evidence.quote);
    if (!evidence || !valueIsSupported) {
      dropped.push({ patch, reason: "invalid_patch_evidence" });
      continue;
    }

    if (patch.operation === "set_slot") {
      applied.push({
        name: patch.name,
        value: patch.value,
        confidence: patch.confidence,
        source: "ai_extraction",
        sourceMessageId: turnInput.inboundMessage.publicMessageId,
        evidence: {
          messageId: turnInput.inboundMessage.publicMessageId,
          quote: patch.evidence.quote,
          ...evidence
        }
      });
    } else {
      applied.push({
        category: patch.category,
        mode: patch.mode,
        value: patch.value,
        confidence: patch.confidence,
        source: "ai_extraction",
        sourceMessageId: turnInput.inboundMessage.publicMessageId,
        evidence: {
          messageId: turnInput.inboundMessage.publicMessageId,
          quote: patch.evidence.quote,
          ...evidence
        }
      });
    }
  }

  return { applied, dropped };
}

function locateUniqueEvidence(text: string, quote: string): { start: number; end: number } | null {
  const start = text.indexOf(quote);
  if (start < 0 || text.indexOf(quote, start + 1) >= 0) return null;
  return { start, end: start + quote.length };
}

function isKnownSlot(slot: AiSlotName, input: AiTurnInput): boolean {
  if (input.knownSlots.values[slot]) return true;
  if (slot === "customerName") return input.knownSlots.customerNameProvided;
  if (slot === "phone") return input.knownSlots.phoneProvided;
  if (slot === "preferredContact") return Boolean(input.knownSlots.preferredContact);
  if (slot === "city") return Boolean(input.knownSlots.city);
  return false;
}

function repeatsExistingReply(finalText: string, input: AiTurnInput): boolean {
  const normalized = normalizeLiveV2TextForComparison(finalText);
  return input.compactContext.messages.some(
    (message) =>
      message.senderRole === "ai_assistant" &&
      normalizeLiveV2TextForComparison(message.text) === normalized
  );
}

function countQuestions(value: string): number {
  return [...value].filter((character) => character === "?").length;
}

function toValidatedHandoff(reason: ModelTurnHandoffReason): {
  reason: AiHandoffReason;
  sourceReason: ModelTurnHandoffReason;
} {
  const reasons: Record<ModelTurnHandoffReason, AiHandoffReason> = {
    customer_requested_manager: "manager_requested",
    customer_wants_final_quote: "final_quote_pressure",
    customer_ready_to_order: "lead_ready"
  };
  return { reason: reasons[reason], sourceReason: reason };
}

function deriveRiskFlags(reason: ModelTurnHandoffReason | undefined): AiRiskFlag[] {
  if (reason === "customer_requested_manager") return ["manager_requested"];
  if (reason === "customer_wants_final_quote") {
    return ["exact_price_requested", "final_quote_pressure"];
  }
  return [];
}
