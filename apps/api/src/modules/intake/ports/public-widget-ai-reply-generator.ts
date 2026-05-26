import type { SiteWidgetMessageRequest } from "@granit/contracts";

export const WIDGET_AI_DISCLOSURE_VERSION = "granit_widget_ai_disclosure.s05.v1";
export const WIDGET_AI_DISCLOSURE_TEXT =
  "Вам помогает AI-помощник компании.\nОн может ответить на общие вопросы и собрать детали заявки.\nВажные условия, цену и сроки подтвердит менеджер.";

export type PublicWidgetAiUnavailableReason =
  | "missing_openai_config"
  | "model_error"
  | "empty_model_response"
  | "unsafe_model_response";

export type PublicWidgetAiReplyResult =
  | {
      status: "replied";
      text: string;
      agentAllowedToReplyAfterSend?: boolean;
      metadata: Record<string, unknown>;
    }
  | {
      status: "unavailable";
      reason: PublicWidgetAiUnavailableReason;
      metadata: Record<string, unknown>;
    };

export interface PublicWidgetAiReplyGenerator {
  generateReply(request: SiteWidgetMessageRequest): Promise<PublicWidgetAiReplyResult>;
}
