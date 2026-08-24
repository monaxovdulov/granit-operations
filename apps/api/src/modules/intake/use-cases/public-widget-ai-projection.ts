import type { SiteWidgetV2SuccessResponse } from "@granit/contracts";

import type { AiState } from "../../conversations/repositories/lead-conversation-types.js";
import type { SiteWidgetAiJobStatus } from "../../conversations/repositories/public-intake-repository.js";
import type { PublicWidgetAiUnavailableReason } from "../ports/public-widget-ai-reply-generator.js";

export type PublicWidgetConversationState =
  | "ai_active"
  | "manager_pending"
  | "manager_active"
  | "closed";

export type PublicWidgetAiJobObservation = {
  id?: string;
  inboundPublicMessageId: string;
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
  status: SiteWidgetAiJobStatus;
  terminalReason?: string;
};

export type PublicWidgetAiCurrentWindow = {
  inboundPublicMessageId: string;
  respondsThroughSequence: number;
  generationEpoch: number;
};

type PublicWidgetAiIntrinsicJobObservation = Pick<
  PublicWidgetAiJobObservation,
  "status" | "terminalReason"
>;

export type PublicWidgetHistoryAutomationReason =
  | PublicWidgetAiUnavailableReason
  | "ai_persistence_unconfirmed"
  | "worker_failed"
  | "agent_reply_blocked"
  | "handoff";

type PublicWidgetV2Automation = SiteWidgetV2SuccessResponse["automation"];

export function toPublicWidgetConversationState(aiState: AiState): PublicWidgetConversationState {
  if (aiState === "manager_active") return "manager_active";
  if (aiState === "needs_manager") return "manager_pending";
  if (aiState === "closed") return "closed";
  return "ai_active";
}

export function projectPublicWidgetAi(input: {
  conversationState: PublicWidgetConversationState;
  agentAllowedToReply: boolean;
  runtimeAvailable: boolean;
  replayedInboundPublicMessageId: string;
  currentWindow?: PublicWidgetAiCurrentWindow;
  hasReply: boolean;
  inboundJob?: PublicWidgetAiJobObservation;
  latestJob?: PublicWidgetAiJobObservation;
}): {
  automation: PublicWidgetV2Automation;
  messageToUser: string;
} {
  const currentJob = selectCurrentWindowJob(input.currentWindow, [
    input.latestJob,
    input.inboundJob
  ]);

  if (
    input.conversationState === "manager_pending" ||
    input.conversationState === "manager_active"
  ) {
    return {
      automation: {
        status: "manager_pending",
        next_step: "manager_review",
        conversation_state: input.conversationState,
        reason: toManagerReason(currentJob?.terminalReason)
      },
      messageToUser:
        input.conversationState === "manager_active"
          ? "Сообщение принято. Диалог уже ведёт менеджер."
          : "Сообщение принято. Менеджер увидит его в панели."
    };
  }

  if (input.conversationState === "closed") {
    return {
      automation: {
        status: "disabled",
        next_step: "manager_review",
        conversation_state: "manager_pending"
      },
      messageToUser: "Сообщение принято. Диалог закрыт; менеджер увидит сообщение в панели."
    };
  }

  if (!input.runtimeAvailable || !input.agentAllowedToReply) {
    return degraded("worker_failed");
  }

  const hasCurrentReply =
    input.hasReply &&
    input.currentWindow?.inboundPublicMessageId === input.replayedInboundPublicMessageId;

  if (hasCurrentReply || currentJob?.status === "replied") {
    return {
      automation: {
        status: "replied",
        next_step: "history_available",
        conversation_state: "ai_active"
      },
      messageToUser: "Сообщение принято, ответ доступен в истории диалога."
    };
  }

  if (
    currentJob?.status === "pending" ||
    currentJob?.status === "processing" ||
    currentJob?.status === "retrying"
  ) {
    if (currentJob.expectedGenerationEpoch !== input.currentWindow?.generationEpoch) {
      return degraded("worker_failed");
    }

    return {
      automation: {
        status: "processing",
        next_step: "poll_history",
        conversation_state: "ai_active",
        poll_after_ms: 700
      },
      messageToUser: "Сообщение принято. AI-помощник готовит ответ."
    };
  }

  if (
    currentJob?.status === "degraded" ||
    currentJob?.status === "failed" ||
    currentJob?.status === "blocked" ||
    currentJob?.status === "superseded"
  ) {
    return degraded(toAiActiveReason(currentJob.status, currentJob.terminalReason));
  }

  return degraded("ai_persistence_unconfirmed");
}

export function projectPublicWidgetHistoryAutomation(
  job: PublicWidgetAiIntrinsicJobObservation
): {
  status: SiteWidgetAiJobStatus;
  reason?: PublicWidgetHistoryAutomationReason;
} {
  const reason = toIntrinsicHistoryReason(job.status, job.terminalReason);
  return {
    status: job.status,
    ...(reason ? { reason } : {})
  };
}

export function shouldPollPublicWidgetHistory(input: {
  conversationState: PublicWidgetConversationState;
  agentAllowedToReply: boolean;
  runtimeAvailable: boolean;
  currentWindow?: PublicWidgetAiCurrentWindow;
  jobs: PublicWidgetAiJobObservation[];
}): boolean {
  const currentJob = selectCurrentWindowJob(input.currentWindow, input.jobs);

  return (
    input.conversationState === "ai_active" &&
    input.agentAllowedToReply &&
    input.runtimeAvailable &&
    Boolean(
      currentJob &&
        currentJob.expectedGenerationEpoch === input.currentWindow?.generationEpoch &&
        isActiveJobStatus(currentJob.status)
    )
  );
}

export function isPublicWidgetAiUnavailableReason(
  value: unknown
): value is PublicWidgetAiUnavailableReason {
  return (
    value === "missing_openai_config" ||
    value === "model_error" ||
    value === "empty_model_response" ||
    value === "unsafe_model_response" ||
    value === "semantic_verifier_error" ||
    value === "grounding_validation_failed" ||
    value === "turn_timeout"
  );
}

function selectCurrentWindowJob(
  currentWindow: PublicWidgetAiCurrentWindow | undefined,
  jobs: Array<PublicWidgetAiJobObservation | undefined>
): PublicWidgetAiJobObservation | undefined {
  if (!currentWindow) return undefined;

  return jobs.find(
    (job) =>
      job?.inboundPublicMessageId === currentWindow.inboundPublicMessageId &&
      job.respondsThroughSequence === currentWindow.respondsThroughSequence
  );
}

function degraded(
  reason: PublicWidgetAiUnavailableReason | "ai_persistence_unconfirmed" | "worker_failed"
): {
  automation: PublicWidgetV2Automation;
  messageToUser: string;
} {
  return {
    automation: {
      status: "degraded",
      next_step: "retry_or_manager",
      conversation_state: "ai_active",
      reason
    },
    messageToUser:
      "Сообщение сохранено, но AI не смог ответить на этот ход. Можно продолжить диалог или повторить вопрос."
  };
}

function toManagerReason(reason: string | undefined): "agent_reply_blocked" | "handoff" {
  return reason === "handoff" ? "handoff" : "agent_reply_blocked";
}

function toIntrinsicHistoryReason(
  status: SiteWidgetAiJobStatus,
  reason: string | undefined
): PublicWidgetHistoryAutomationReason | undefined {
  if (status === "pending" || status === "processing" || status === "retrying") {
    return undefined;
  }

  if (status === "replied") return reason === "handoff" ? "handoff" : undefined;
  if (status === "superseded") return undefined;

  return toAiActiveReason(status, reason);
}

function toAiActiveReason(
  status: SiteWidgetAiJobStatus,
  reason: string | undefined
): PublicWidgetAiUnavailableReason | "ai_persistence_unconfirmed" | "worker_failed" {
  if (
    reason === "candidate_invalid" ||
    reason === "no_safe_answer" ||
    reason === "missing_approved_fact"
  ) {
    return "unsafe_model_response";
  }

  if (reason === "missing_provider_config") return "missing_openai_config";
  if (reason === "generator_failed") return "model_error";
  if (reason === "recorder_failure") return "ai_persistence_unconfirmed";
  if (isPublicWidgetAiUnavailableReason(reason)) return reason;
  if (reason === "ai_persistence_unconfirmed" || reason === "worker_failed") return reason;

  return "worker_failed";
}

function isActiveJobStatus(status: SiteWidgetAiJobStatus): boolean {
  return status === "pending" || status === "processing" || status === "retrying";
}
