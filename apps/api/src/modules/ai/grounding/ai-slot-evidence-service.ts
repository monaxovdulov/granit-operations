import type { AiSlotName, AiTextEvidence } from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export type AiSlotEvidenceIssue = {
  slot: AiSlotName;
  code:
    | "message_not_found"
    | "message_not_from_visitor"
    | "invalid_offsets"
    | "quote_mismatch"
    | "value_mismatch";
};

export function validateSlotEvidence(
  slot: AiSlotName,
  value: string,
  evidence: AiTextEvidence,
  input: AiTurnInput
): AiSlotEvidenceIssue | null {
  const evidenceIssue = validateTextEvidence(evidence, input);

  if (evidenceIssue) {
    return { slot, code: evidenceIssue };
  }

  return isSlotValueSupportedByEvidence(slot, value, evidence.quote)
    ? null
    : { slot, code: "value_mismatch" };
}

export function validateTextEvidence(
  evidence: AiTextEvidence,
  input: AiTurnInput
): Exclude<AiSlotEvidenceIssue["code"], "value_mismatch"> | null {
  const message = visitorMessages(input).find(
    (candidate) => candidate.publicMessageId === evidence.messageId
  );

  if (!message) {
    return isPersistedEvidence(evidence, input) ? null : "message_not_found";
  }

  if (message.senderRole !== "visitor") {
    return "message_not_from_visitor";
  }

  if (
    !Number.isInteger(evidence.start) ||
    !Number.isInteger(evidence.end) ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > message.text.length
  ) {
    return "invalid_offsets";
  }

  return message.text.slice(evidence.start, evidence.end) === evidence.quote
    ? null
    : "quote_mismatch";
}

function isPersistedEvidence(evidence: AiTextEvidence, input: AiTurnInput): boolean {
  const knownSlotEvidence = Object.values(input.knownSlots.values).flatMap((slot) =>
    slot?.evidence ? [slot.evidence] : []
  );
  const knownRequirementEvidence = input.knownRequirements.map(
    (requirement) => requirement.evidence
  );

  return [...knownSlotEvidence, ...knownRequirementEvidence].some(
    (candidate) =>
      candidate.end - candidate.start === candidate.quote.length &&
      candidate.messageId === evidence.messageId &&
      candidate.quote === evidence.quote &&
      candidate.start === evidence.start &&
      candidate.end === evidence.end
  );
}

export function isSlotValueSupportedByEvidence(
  slot: AiSlotName,
  value: string,
  quote: string
): boolean {
  if (isContextualAnswer(quote)) {
    return true;
  }

  if (slot === "monumentType") {
    const valueKinds = monumentKinds(value);
    const quoteKinds = monumentKinds(quote);

    if (valueKinds.size && quoteKinds.size) {
      return intersects(valueKinds, quoteKinds);
    }
  }

  if (slot === "preferredContact") {
    const valueChannels = contactChannels(value);
    const quoteChannels = contactChannels(quote);

    if (valueChannels.size && quoteChannels.size) {
      return intersects(valueChannels, quoteChannels);
    }
  }

  if (slot === "size") {
    const valueNumbers = numbers(value);
    const quoteNumbers = numbers(quote);

    if (valueNumbers.length && quoteNumbers.length) {
      return valueNumbers.every((item) => quoteNumbers.includes(item));
    }
  }

  return hasLexicalSupport(value, quote);
}

export function isRequirementValueSupportedByEvidence(value: string, quote: string): boolean {
  return isContextualAnswer(quote) || hasLexicalSupport(value, quote);
}

function visitorMessages(input: AiTurnInput) {
  return [
    ...input.compactContext.messages,
    {
      publicMessageId: input.inboundMessage.publicMessageId,
      direction: "inbound" as const,
      senderRole: "visitor" as const,
      contentType: "text" as const,
      submittedAt: input.inboundMessage.submittedAt,
      text: input.inboundMessage.text
    }
  ];
}

function hasLexicalSupport(value: string, quote: string): boolean {
  const normalizedValue = normalize(value);
  const normalizedQuote = normalize(quote);

  if (
    !normalizedValue ||
    !normalizedQuote ||
    normalizedQuote.includes(normalizedValue) ||
    normalizedValue.includes(normalizedQuote)
  ) {
    return Boolean(normalizedValue && normalizedQuote);
  }

  const valueTokens = tokenStems(normalizedValue);
  const quoteTokens = tokenStems(normalizedQuote);
  return valueTokens.some((token) => quoteTokens.includes(token));
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function tokenStems(value: string): string[] {
  return value
    .split(/\s+/u)
    .filter((token) => token.length >= 3)
    .map((token) => token.slice(0, Math.min(5, token.length)));
}

function numbers(value: string): string[] {
  return normalize(value).match(/\d+(?:[.,]\d+)?/gu) ?? [];
}

function isContextualAnswer(value: string): boolean {
  return /^(?:да|нет|ага|угу|точно|верно|не нужно|нужно|хочу|не хочу)[.!?\s]*$/iu.test(
    normalize(value)
  );
}

function monumentKinds(value: string): Set<string> {
  return classify(value, [
    ["single", /(?:одинар|одиноч|одномест)/iu],
    ["double", /(?:двойн|двухмест)/iu],
    ["family", /семейн/iu],
    ["complex", /комплекс/iu]
  ]);
}

function contactChannels(value: string): Set<string> {
  return classify(value, [
    ["phone", /(?:телефон|звон|позвон)/iu],
    ["whatsapp", /(?:whats?app|ватсап|вотсап)/iu],
    ["telegram", /(?:telegram|телеграм)/iu],
    ["email", /(?:e-?mail|почт)/iu]
  ]);
}

function classify(value: string, patterns: ReadonlyArray<readonly [string, RegExp]>): Set<string> {
  const matches = new Set<string>();

  for (const [kind, pattern] of patterns) {
    if (pattern.test(value)) {
      matches.add(kind);
    }
  }

  return matches;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((item) => right.has(item));
}
