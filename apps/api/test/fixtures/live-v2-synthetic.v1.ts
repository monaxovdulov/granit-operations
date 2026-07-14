import { vi } from "vitest";

import {
  buildStageASiteWidgetAiTurnInput,
  type AiTurnContextMessage,
  type AiTurnInput
} from "../../src/modules/ai/ai-turn.js";
import {
  LIVE_V2_FACTS_VERSION,
  parseLiveV2FactsSnapshot
} from "../../src/modules/ai/profiles/live-v2/live-v2-assets.js";
import type { LiveV2GateReader } from "../../src/modules/ai/profiles/live-v2/live-v2-orchestrator.js";
import {
  LIVE_V2_CANDIDATE_VERSION,
  LIVE_V2_DECISION_PROFILE,
  type LiveV2AnswerCandidate,
  type LiveV2ClarifyingQuestionCandidate,
  type LiveV2Gate,
  type LiveV2HandoffCandidate,
  type LiveV2ManagerRequest,
  type LiveV2NoReplyCandidate,
  type LiveV2Slot
} from "../../src/modules/ai/profiles/live-v2/live-v2-contract.js";

const SOURCE_COMMIT = "23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a";
export const TEST_LIVE_V2_AS_OF_DATE = "2026-07-14";

export function buildLiveV2TestGateReader(
  turnInput: ReturnType<typeof buildLiveV2TestTurn>,
  overrideGate: LiveV2Gate = {
    aiState: turnInput.gateSnapshot.aiState,
    agentAllowedToReply: turnInput.gateSnapshot.agentAllowedToReply
  }
) {
  const readGate = vi.fn(async () => ({
    aiState: overrideGate.aiState,
    agentAllowedToReply: overrideGate.agentAllowedToReply
  }));

  return { readGate } satisfies LiveV2GateReader;
}

/** Test-only approved registry. It proves schema/source enforcement, not owner approval. */
export const TEST_LIVE_V2_FACTS = parseLiveV2FactsSnapshot(
  {
    version: LIVE_V2_FACTS_VERSION,
    ownerReviewId: "test-only-p1q-fixture",
    facts: [
      {
        id: "P1Q-TYPE-001",
        category: "product_type",
        allowedCustomerWording: "В каталоге представлены вертикальные памятники.",
        forbiddenExtrapolations: ["Не обещать наличие модели, цену или срок."],
        sources: [
          {
            repo: "granit-site-cms",
            commit: SOURCE_COMMIT,
            path: "apps/site/src/imported-pages/index.html",
            lines: "191",
            blobSha: "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          }
        ],
        ownerApproved: true,
        validFrom: "2026-07-14",
        reviewBy: "2026-10-14"
      },
      {
        id: "P1Q-TYPE-002",
        category: "product_type",
        allowedCustomerWording:
          "В каталоге представлены горизонтальные памятники — широкие стелы для семейных надписей и двух портретов.",
        forbiddenExtrapolations: ["Не назначать размеры или комплект сверх источника."],
        sources: [
          {
            repo: "granit-site-cms",
            commit: SOURCE_COMMIT,
            path: "apps/site/src/imported-pages/index.html",
            lines: "192",
            blobSha: "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          }
        ],
        ownerApproved: true,
        validFrom: "2026-07-14",
        reviewBy: "2026-10-14"
      },
      {
        id: "P1Q-MAT-001",
        category: "material",
        allowedCustomerWording: "В каталоге указан материал «габбро-диабаз».",
        forbiddenExtrapolations: ["Не приписывать свойства, долговечность или наличие."],
        sources: [
          {
            repo: "granit-site-cms",
            commit: SOURCE_COMMIT,
            path: "apps/site/src/imported-pages/index.html",
            lines: "236",
            blobSha: "fcae3a14c48fdb9900404ef60e9aa6d465f8071f"
          }
        ],
        ownerApproved: true,
        validFrom: "2026-07-14",
        reviewBy: "2026-10-14"
      }
    ]
  },
  { asOfDate: TEST_LIVE_V2_AS_OF_DATE }
);

export function buildLiveV2TestTurn(input: {
  inbound?: string;
  previousMessagesNewestFirst?: AiTurnContextMessage[];
  city?: string;
  phoneProvided?: boolean;
  emailProvided?: boolean;
  gate?: {
    aiState: AiTurnInput["gateSnapshot"]["aiState"];
    agentAllowedToReply: boolean;
  };
} = {}): AiTurnInput {
  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: "00000000-0000-4000-8000-000000000101",
    publicMessageId: "00000000-0000-4000-8000-000000000102",
    requestFingerprint: "live-v2-test-request-fingerprint",
    submittedAt: "2026-07-14T12:00:00.000Z",
    text: input.inbound ?? "Подскажите подходящий вариант",
    page: {
      url: "https://granit.example/catalog",
      widgetInstanceId: "landing-main"
    },
    customer: {
      phoneProvided: input.phoneProvided ?? false,
      emailProvided: input.emailProvided ?? false,
      city: input.city
    },
    visitor: {
      locale: "ru-RU"
    },
    gate: {
      aiState: input.gate?.aiState ?? "ai_collecting_info",
      agentAllowedToReply: input.gate?.agentAllowedToReply ?? true
    },
    previousMessagesNewestFirst: input.previousMessagesNewestFirst
  });
}

export function contextMessage(input: {
  id: number;
  role: "visitor" | "assistant";
  text: string;
}): AiTurnContextMessage {
  const isVisitor = input.role === "visitor";

  return {
    publicMessageId: `00000000-0000-4000-8000-${String(input.id).padStart(12, "0")}`,
    direction: isVisitor ? "inbound" : "outbound",
    senderRole: isVisitor ? "visitor" : "ai_assistant",
    contentType: "text",
    submittedAt: `2026-07-14T11:${String(input.id).padStart(2, "0")}:00.000Z`,
    text: input.text
  };
}

export function answerCandidate(input: {
  replyDraft?: string;
  factIds?: string[];
  managerRequest?: LiveV2ManagerRequest;
  mixedIntent?: boolean;
  useRecentContext?: boolean;
} = {}): LiveV2AnswerCandidate {
  const factIds = input.factIds ?? ["P1Q-TYPE-001"];

  return {
    schemaVersion: LIVE_V2_CANDIDATE_VERSION,
    decisionProfile: LIVE_V2_DECISION_PROFILE,
    action: "answer",
    replyDraft:
      input.replyDraft ??
      "В каталоге есть вертикальные памятники. Какой вариант оформления вам ближе?",
    reason: "answer_ready",
    missingSlots: [],
    signals: {
      managerRequest: input.managerRequest ?? "absent",
      mixedIntent: input.mixedIntent ?? false
    },
    evidence: {
      basis: [
        "current_message",
        ...(input.useRecentContext ? (["recent_context"] as const) : []),
        ...(factIds.length > 0 ? (["approved_facts"] as const) : [])
      ],
      usedFactIds: factIds
    }
  };
}

export function clarifyingCandidate(input: {
  slot: LiveV2Slot;
  replyDraft: string;
  factIds?: string[];
}): LiveV2ClarifyingQuestionCandidate {
  const factIds = input.factIds ?? [];

  return {
    schemaVersion: LIVE_V2_CANDIDATE_VERSION,
    decisionProfile: LIVE_V2_DECISION_PROFILE,
    action: "ask_clarifying_question",
    replyDraft: input.replyDraft,
    reason: "missing_required_slot",
    missingSlots: [input.slot],
    signals: {
      managerRequest: "absent",
      mixedIntent: false
    },
    evidence: {
      basis: [
        "current_message",
        ...(factIds.length > 0 ? (["approved_facts"] as const) : [])
      ],
      usedFactIds: factIds
    }
  };
}

export function handoffCandidate(input: {
  managerRequest?: "explicit" | "absent";
  mixedIntent?: boolean;
  reason?: "explicit_manager_request" | "manager_required";
} = {}): LiveV2HandoffCandidate {
  const managerRequest = input.managerRequest ?? "explicit";

  return {
    schemaVersion: LIVE_V2_CANDIDATE_VERSION,
    decisionProfile: LIVE_V2_DECISION_PROFILE,
    action: "handoff_to_manager",
    replyDraft: "Передам диалог менеджеру, чтобы он продолжил здесь.",
    reason:
      input.reason ??
      (managerRequest === "explicit" ? "explicit_manager_request" : "manager_required"),
    missingSlots: [],
    signals: {
      managerRequest,
      mixedIntent: input.mixedIntent ?? false
    },
    evidence: {
      basis: ["current_message"],
      usedFactIds: []
    }
  };
}

export function noReplyCandidate(
  reason: "no_safe_answer" | "missing_approved_fact" = "no_safe_answer"
): LiveV2NoReplyCandidate {
  return {
    schemaVersion: LIVE_V2_CANDIDATE_VERSION,
    decisionProfile: LIVE_V2_DECISION_PROFILE,
    action: "no_reply",
    replyDraft: null,
    reason,
    missingSlots: [],
    signals: {
      managerRequest: "absent",
      mixedIntent: false
    },
    evidence: {
      basis: ["current_message"],
      usedFactIds: []
    }
  };
}
