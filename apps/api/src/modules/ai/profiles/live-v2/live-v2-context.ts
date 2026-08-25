import type { AiTurnContextMessage, AiTurnInput } from "../../ai-turn.js";
import {
  LIVE_V2_CONTEXT_MAX_CHARACTERS,
  LIVE_V2_CONTEXT_MAX_MESSAGES,
  LIVE_V2_LAST_AI_QUESTION_MAX_CHARACTERS,
  LIVE_V2_TURN_VIEW_VERSION,
  type LiveV2KnownSlots,
  type LiveV2TurnView,
  type LiveV2TurnViewMessage
} from "./live-v2-contract.js";

/**
 * Builds the model-safe live_v2 view. The output deliberately omits persistence/public IDs,
 * timestamps, URLs, contact values and unrestricted metadata. The final message is always the
 * accepted current inbound message and appears exactly once.
 */
export function buildLiveV2TurnView(input: AiTurnInput): LiveV2TurnView {
  const currentInbound = input.inboundMessage;

  if (!currentInbound.text || currentInbound.text.length > LIVE_V2_CONTEXT_MAX_CHARACTERS) {
    throw new Error("live_v2 current inbound exceeds the context character limit");
  }

  const previousMessages = input.compactContext.messages.filter(
    (message) => message.publicMessageId !== currentInbound.publicMessageId
  );
  const selectedNewestFirst: AiTurnContextMessage[] = [];
  const seenPublicMessageIds = new Set<string>([currentInbound.publicMessageId]);
  let characterCount = currentInbound.text.length;

  for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
    const message = previousMessages[index];

    if (!message || selectedNewestFirst.length >= LIVE_V2_CONTEXT_MAX_MESSAGES - 1) {
      break;
    }

    assertModelSafeMessageShape(message);

    if (seenPublicMessageIds.has(message.publicMessageId)) {
      continue;
    }

    if (characterCount + message.text.length > LIVE_V2_CONTEXT_MAX_CHARACTERS) {
      continue;
    }

    selectedNewestFirst.push(message);
    seenPublicMessageIds.add(message.publicMessageId);
    characterCount += message.text.length;
  }

  const selectedPrevious = selectedNewestFirst.reverse();
  const messages = [
    ...selectedPrevious.map(toTurnViewMessage),
    {
      role: "visitor" as const,
      text: currentInbound.text
    }
  ];

  return {
    version: LIVE_V2_TURN_VIEW_VERSION,
    messages,
    lastAiQuestion: findLastAiQuestion(selectedPrevious),
    knownSlots: buildKnownSlots(input),
    gate: {
      aiState: input.gateSnapshot.aiState,
      agentAllowedToReply: input.gateSnapshot.agentAllowedToReply
    }
  };
}

function toTurnViewMessage(message: AiTurnContextMessage): LiveV2TurnViewMessage {
  assertModelSafeMessageShape(message);

  return {
    role: message.senderRole === "visitor" ? "visitor" : "assistant",
    text: message.text
  };
}

function assertModelSafeMessageShape(message: AiTurnContextMessage): void {
  const isVisitorInbound = message.direction === "inbound" && message.senderRole === "visitor";
  const isAiOutbound =
    message.direction === "outbound" && message.senderRole === "ai_assistant";

  if (!isVisitorInbound && !isAiOutbound) {
    throw new Error("live_v2 context contains an unsupported message role");
  }

  if (!message.text) {
    throw new Error("live_v2 context contains an empty text message");
  }
}

function findLastAiQuestion(messages: AiTurnContextMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (
      !message ||
      message.direction !== "outbound" ||
      message.senderRole !== "ai_assistant"
    ) {
      continue;
    }

    const questionMarkIndex = message.text.lastIndexOf("?");

    if (questionMarkIndex < 0) {
      continue;
    }

    const textBeforeQuestionMark = message.text.slice(0, questionMarkIndex);
    const previousSentenceBoundary = Math.max(
      textBeforeQuestionMark.lastIndexOf("."),
      textBeforeQuestionMark.lastIndexOf("!"),
      textBeforeQuestionMark.lastIndexOf("?"),
      textBeforeQuestionMark.lastIndexOf("\n")
    );
    const question = message.text
      .slice(previousSentenceBoundary + 1, questionMarkIndex + 1)
      .trim();

    if (!question) {
      continue;
    }

    return question.length <= LIVE_V2_LAST_AI_QUESTION_MAX_CHARACTERS
      ? question
      : question.slice(-LIVE_V2_LAST_AI_QUESTION_MAX_CHARACTERS);
  }

  return null;
}

function buildKnownSlots(input: AiTurnInput): LiveV2KnownSlots {
  const city = toModelSafeCity(input.knownSlots.city);
  const values = input.knownSlots.values;

  return {
    customerNameProvided: input.knownSlots.customerNameProvided,
    phoneProvided: input.knownSlots.phoneProvided,
    emailProvided: input.knownSlots.emailProvided,
    ...(input.knownSlots.preferredContact
      ? { preferredContact: input.knownSlots.preferredContact }
      : {}),
    ...modelSafeBusinessSlot("monumentType", values.monumentType?.value),
    ...modelSafeBusinessSlot("material", values.material?.value),
    ...modelSafeBusinessSlot("size", values.size?.value),
    ...(city ? { city } : modelSafeBusinessSlot("city", values.city?.value)),
    ...modelSafeBusinessSlot("cemetery", values.cemetery?.value),
    ...modelSafeBusinessSlot("installation", values.installation?.value),
    ...modelSafeBusinessSlot("desiredTiming", values.desiredTiming?.value)
  };
}

function modelSafeBusinessSlot<
  Name extends
    | "monumentType"
    | "material"
    | "size"
    | "city"
    | "cemetery"
    | "installation"
    | "desiredTiming"
>(name: Name, value: string | undefined): Partial<Record<Name, string>> {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    normalized.length > 240 ||
    /(?:@|https?:\/\/|\+?\d[\d\s()\-]{6,}\d)/iu.test(normalized)
  ) {
    return {};
  }
  return { [name]: normalized } as Partial<Record<Name, string>>;
}

function toModelSafeCity(value: string | undefined): string | undefined {
  const city = value?.normalize("NFKC").trim().replace(/\s+/gu, " ");

  if (
    !city ||
    city.length > 120 ||
    !/^[\p{L}][\p{L}\p{M} .’'()-]*$/u.test(city)
  ) {
    return undefined;
  }

  return city;
}
