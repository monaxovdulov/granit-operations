import type { AiReplyCandidateDecision, AiTurnInput } from "../ai-turn.js";
import {
  AiTurnCandidateDecisionSchema,
  type AiSlotName,
  type AiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import {
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator
} from "../../intake/ports/public-widget-ai-reply-generator.js";
import {
  buildWidgetAiPolicyReply,
  unsafeWidgetAiModelReplyReason,
  WIDGET_AI_POLICY_VERSION
} from "../policy/widget-ai-policy.js";
import {
  buildWidgetAiInstructions,
  buildWidgetAiUserInput,
  WIDGET_AI_PROMPT_VERSION
} from "../prompts/widget-ai-prompt.js";

export {
  WIDGET_AI_DISCLOSURE_TEXT,
  WIDGET_AI_DISCLOSURE_VERSION,
  type PublicWidgetAiReplyGenerator,
  type PublicWidgetAiReplyResult
} from "../../intake/ports/public-widget-ai-reply-generator.js";
export { WIDGET_AI_POLICY_VERSION } from "../policy/widget-ai-policy.js";
export { WIDGET_AI_PROMPT_VERSION } from "../prompts/widget-ai-prompt.js";

export type WidgetAiUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type WidgetAiProviderInput = {
  turn: AiTurnInput;
  instructions: string;
  userInput: string;
};

export type WidgetAiProviderResult = {
  decision: AiTurnCandidateDecision;
  modelProvider: "openai" | "fake";
  modelName: string;
  responseId?: string;
  usage?: WidgetAiUsage;
};

export interface WidgetAiProvider {
  generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult>;
}

export type WidgetAiReplyResult = AiReplyCandidateDecision;

export type WidgetAiServiceOptions = {
  provider?: WidgetAiProvider;
  modelName?: string;
};

export class WidgetAiService implements PublicWidgetAiReplyGenerator {
  constructor(private readonly options: WidgetAiServiceOptions = {}) {}

  async generateReply(input: AiTurnInput): Promise<WidgetAiReplyResult> {
    const baseMetadata = {
      prompt_version: WIDGET_AI_PROMPT_VERSION,
      policy_version: WIDGET_AI_POLICY_VERSION,
      ai_disclosure_shown: true,
      ai_disclosure_version: WIDGET_AI_DISCLOSURE_VERSION,
      price_list_version: null,
      fallback_mode: "none"
    };

    const policyReply = buildWidgetAiPolicyReply(input);

    if (policyReply) {
      return {
        decision: "reply_candidate",
        text: policyReply.text,
        agentAllowedToReplyAfterSend: policyReply.stopAiAfterReply ? false : undefined,
        action: policyReply.action,
        intent: policyReply.intent,
        requestedSlots: policyReply.requestedSlots,
        riskFlags: policyReply.riskFlags,
        handoffReason: policyReply.handoffReason,
        confidence: 1,
        metadata: {
          ...baseMetadata,
          model_provider: "policy",
          model_name: "deterministic",
          fallback_mode: policyReply.fallbackMode,
          handoff_reason: policyReply.reason
        }
      };
    }

    if (!this.options.provider) {
      return {
        decision: "no_reply",
        reason: "missing_openai_config",
        metadata: {
          ...baseMetadata,
          model_provider: "openai",
          model_name: this.options.modelName ?? "gpt-5.5",
          fallback_mode: "manager_required",
          error_type: "missing_openai_config"
        }
      };
    }

    try {
      const providerResult = await this.options.provider.generateReply({
        turn: input,
        instructions: buildWidgetAiInstructions(),
        userInput: buildWidgetAiUserInput(input)
      });
      const candidate = validateProviderDecision(providerResult.decision, input);

      if (!candidate) {
        return {
          decision: "no_reply",
          reason: "unsafe_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: providerResult.modelProvider,
            model_name: providerResult.modelName,
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            error_type: "invalid_typed_decision",
            ...usageMetadata(providerResult.usage)
          }
        };
      }

      const text = normalizeReply(candidate.replyText ?? "");

      if (!text) {
        return {
          decision: "no_reply",
          reason: "empty_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: providerResult.modelProvider,
            model_name: providerResult.modelName,
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            error_type: "empty_model_response",
            ...usageMetadata(providerResult.usage)
          }
        };
      }

      const unsafeReason = unsafeWidgetAiModelReplyReason(text);

      if (unsafeReason) {
        return {
          decision: "no_reply",
          reason: "unsafe_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: providerResult.modelProvider,
            model_name: providerResult.modelName,
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            handoff_reason: unsafeReason,
            blocked_model_reply: true,
            error_type: "unsafe_model_response",
            ...usageMetadata(providerResult.usage)
          }
        };
      }

      return {
        decision: "reply_candidate",
        text,
        agentAllowedToReplyAfterSend: candidate.action === "handoff" ? false : undefined,
        action: candidate.action,
        intent: candidate.intent,
        slotUpdates: candidate.extractedSlots.map((slot) => ({
          ...slot,
          source: "ai_extraction" as const,
          sourceMessageId: input.inboundMessage.publicMessageId
        })),
        requestedSlots: candidate.requestedSlots,
        riskFlags: candidate.riskFlags,
        handoffReason: candidate.handoffReason ?? undefined,
        sourceEvidence: candidate.sourceEvidence,
        confidence: candidate.confidence,
        metadata: {
          ...baseMetadata,
          model_provider: providerResult.modelProvider,
          model_name: providerResult.modelName,
          openai_response_id: providerResult.responseId,
          ai_decision_version: candidate.version,
          ai_action: candidate.action,
          ai_intent: candidate.intent,
          requested_slots: candidate.requestedSlots,
          risk_flags: candidate.riskFlags,
          handoff_reason: candidate.handoffReason,
          confidence: candidate.confidence,
          ...usageMetadata(providerResult.usage)
        }
      };
    } catch {
      return {
        decision: "no_reply",
        reason: "model_error",
        metadata: {
          ...baseMetadata,
          model_provider: "openai",
          model_name: this.options.modelName ?? "gpt-5.5",
          fallback_mode: "manager_required",
          error_type: "model_error"
        }
      };
    }
  }
}

function validateProviderDecision(
  value: unknown,
  input: AiTurnInput
): AiTurnCandidateDecision | null {
  const parsed = AiTurnCandidateDecisionSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const decision = parsed.data;
  const replyRequired =
    decision.action === "answer" ||
    decision.action === "clarify" ||
    decision.action === "handoff";

  if (!replyRequired || !decision.replyText?.trim()) {
    return null;
  }

  if (decision.action === "clarify" && decision.requestedSlots.length !== 1) {
    return null;
  }

  const extractedNames = new Set<AiSlotName>();

  for (const slot of decision.extractedSlots) {
    if (extractedNames.has(slot.name)) {
      return null;
    }

    extractedNames.add(slot.name);
  }

  const requestedSlot = decision.requestedSlots[0];

  if (
    requestedSlot &&
    (input.knownSlots.values[requestedSlot] || extractedNames.has(requestedSlot))
  ) {
    return null;
  }

  if (!hasOnlyApprovedSourceEvidence(decision, input)) {
    return null;
  }

  return decision;
}

function hasOnlyApprovedSourceEvidence(
  decision: AiTurnCandidateDecision,
  input: AiTurnInput
): boolean {
  return decision.sourceEvidence.every((evidence) => {
    if (evidence.kind === "price") {
      return false;
    }

    return input.approvedSources.businessFacts.some(
      (source) =>
        source.sourceId === evidence.sourceId &&
        source.version === evidence.version
    );
  });
}

function normalizeReply(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n").slice(0, 900);
}

function usageMetadata(usage?: WidgetAiUsage): Record<string, unknown> {
  return {
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null
  };
}
