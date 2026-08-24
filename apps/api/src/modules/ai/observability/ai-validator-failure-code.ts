export const AI_VALIDATOR_FAILURE_CODES = [
  "invalid_shape",
  "invalid_answer",
  "duplicate_question",
  "invalid_question",
  "unsafe_claim",
  "tone_violation",
  "repeated_reply",
  "known_slot_requested"
] as const;

export type AiValidatorFailureCode = (typeof AI_VALIDATOR_FAILURE_CODES)[number];

export function isAiValidatorFailureCode(value: unknown): value is AiValidatorFailureCode {
  return (
    typeof value === "string" &&
    (AI_VALIDATOR_FAILURE_CODES as readonly string[]).includes(value)
  );
}
