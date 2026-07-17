import type { AiSlotName, AiTextEvidence } from "../ai-dialog-contract.js";
import type { AiTurnInput } from "../ai-turn.js";

export type AiSlotEvidenceIssue = {
  slot: AiSlotName;
  code:
    | "message_not_found"
    | "message_not_from_visitor"
    | "invalid_offsets"
    | "quote_mismatch";
};

export function validateSlotEvidence(
  slot: AiSlotName,
  evidence: AiTextEvidence,
  input: AiTurnInput
): AiSlotEvidenceIssue | null {
  const message = visitorMessages(input).find(
    (candidate) => candidate.publicMessageId === evidence.messageId
  );

  if (!message) {
    return { slot, code: "message_not_found" };
  }

  if (message.senderRole !== "visitor") {
    return { slot, code: "message_not_from_visitor" };
  }

  if (
    !Number.isInteger(evidence.start) ||
    !Number.isInteger(evidence.end) ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > message.text.length
  ) {
    return { slot, code: "invalid_offsets" };
  }

  return message.text.slice(evidence.start, evidence.end) === evidence.quote
    ? null
    : { slot, code: "quote_mismatch" };
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

