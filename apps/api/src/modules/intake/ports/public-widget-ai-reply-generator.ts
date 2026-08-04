import type {
  AiReplyCandidateDecision,
  AiTurnInput,
  AiUnavailableReason
} from "../../ai/ai-turn.js";

export const WIDGET_AI_DISCLOSURE_VERSION = "granit_widget_ai_disclosure.s05.v1";
export const WIDGET_AI_DISCLOSURE_TEXT =
  "Вам помогает AI-помощник компании.\nОн может ответить на общие вопросы и собрать детали заявки.\nВажные условия, цену и сроки подтвердит менеджер.";

export type PublicWidgetAiUnavailableReason = AiUnavailableReason;

export type PublicWidgetAiReplyResult = AiReplyCandidateDecision;

export interface PublicWidgetAiReplyGenerator {
  generateReply(input: AiTurnInput, options?: { signal?: AbortSignal }): Promise<unknown>;
}
