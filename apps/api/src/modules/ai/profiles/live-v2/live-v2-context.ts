import type { AiTurnContextMessage, AiTurnInput } from "../../ai-turn.js";
import {
  LIVE_V2_KNOWN_REQUIREMENTS_MAX_ITEMS,
  LIVE_V2_TURN_VIEW_VERSION,
  type LiveV2KnownSlots,
  type LiveV2KnownRequirement,
  type LiveV2KnownSlotProvenance,
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

  if (!currentInbound.text) {
    throw new Error("live_v2 current inbound is empty");
  }

  const previousMessages = input.compactContext.messages.filter(
    (message) => message.publicMessageId !== currentInbound.publicMessageId
  );
  const selectedNewestFirst: AiTurnContextMessage[] = [];
  const seenPublicMessageIds = new Set<string>([currentInbound.publicMessageId]);

  for (let index = previousMessages.length - 1; index >= 0; index -= 1) {
    const message = previousMessages[index];

    if (!message) continue;

    assertModelSafeMessageShape(message);

    if (seenPublicMessageIds.has(message.publicMessageId)) {
      continue;
    }

    selectedNewestFirst.push(message);
    seenPublicMessageIds.add(message.publicMessageId);
  }

  const selectedPrevious = selectedNewestFirst.reverse();
  const messages = [
    ...selectedPrevious.map(toTurnViewMessage),
    {
      role: "visitor" as const,
      text: currentInbound.text
    }
  ];

  const knownSlots = buildKnownSlots(input);
  return {
    version: LIVE_V2_TURN_VIEW_VERSION,
    messages,
    knownSlots,
    knownSlotProvenance: buildKnownSlotProvenance(input, knownSlots),
    knownRequirements: buildKnownRequirements(input),
    gate: {
      aiState: input.gateSnapshot.aiState,
      agentAllowedToReply: input.gateSnapshot.agentAllowedToReply
    }
  };
}

function buildKnownRequirements(input: AiTurnInput): LiveV2KnownRequirement[] {
  return input.knownRequirements
    .slice(0, LIVE_V2_KNOWN_REQUIREMENTS_MAX_ITEMS)
    .flatMap((requirement) => {
      const value = modelSafeTextValue(requirement.value);
      if (!value) return [];

      return [
        {
          category: requirement.category,
          mode: requirement.mode,
          value,
          provenance: {
            origin: "saved_requirement" as const,
            source: requirement.source
          }
        }
      ];
    });
}

function buildKnownSlotProvenance(
  input: AiTurnInput,
  knownSlots: LiveV2KnownSlots
): LiveV2KnownSlotProvenance {
  const result: LiveV2KnownSlotProvenance = {};
  const names = [
    "monumentType",
    "material",
    "size",
    "city",
    "cemetery",
    "installation",
    "desiredTiming"
  ] as const;

  for (const name of names) {
    const saved = input.knownSlots.values[name];
    if (knownSlots[name] && saved) {
      result[name] = { origin: "saved_field", source: saved.source };
    }
  }

  return result;
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
  if (!modelSafeTextValue(normalized)) return {};
  return { [name]: normalized } as Partial<Record<Name, string>>;
}

function modelSafeTextValue(value: string | undefined): string | undefined {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    !normalized ||
    normalized.length > 240 ||
    /(?:@|https?:\/\/|\+?\d[\d\s()\-]{6,}\d)/iu.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
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
