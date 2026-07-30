import type { AiReplyCandidateDecision, AiTurnInput } from "../ai-turn.js";
import type { AiTurnCandidateDecision } from "../ai-dialog-contract.js";
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
import { isSafeWidgetAiModelName } from "../widget-ai-model-name.js";

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
  text: string;
  modelProvider: "openai" | "fake";
  modelName: string;
  responseId?: string;
  usage?: WidgetAiUsage;
  decision?: AiTurnCandidateDecision;
};

export interface WidgetAiProvider {
  /** App-owned adapter identity used only for configured-provider truth. */
  readonly providerKind: "openai" | "fake";
  generateReply(input: WidgetAiProviderInput): Promise<WidgetAiProviderResult>;
}

export type TrustedWidgetAiProviderObservation = {
  observedModelProvider: "openai" | "fake" | "policy" | "none";
  observedModelName?: string;
  usage?: WidgetAiUsage;
};

const trustedProviderObservations = new WeakMap<object, TrustedWidgetAiProviderObservation>();

/**
 * Returns an observation only for the exact result object produced by WidgetAiService. Plain
 * candidate fields and metadata cannot manufacture an observation.
 */
export function readTrustedWidgetAiProviderObservation(
  value: unknown
): TrustedWidgetAiProviderObservation | undefined {
  return typeof value === "object" && value !== null
    ? trustedProviderObservations.get(value)
    : undefined;
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

    if (
      this.options.modelName !== undefined &&
      !isSafeWidgetAiModelName(this.options.modelName)
    ) {
      return unavailableResult(baseMetadata);
    }

    const policyReply = buildWidgetAiPolicyReply(input);

    if (policyReply) {
      return observed({
        decision: "reply_candidate",
        text: policyReply.text,
        agentAllowedToReplyAfterSend: policyReply.stopAiAfterReply ? false : undefined,
        metadata: {
          ...baseMetadata,
          model_provider: "policy",
          model_name: "deterministic",
          fallback_mode: policyReply.fallbackMode,
          policy_reason: policyReply.reason,
          decision_profile: "legacy_s05",
          normalized_action:
            policyReply.action === "handoff" ? "handoff_to_manager" : policyReply.action,
          ai_action: policyReply.action,
          ai_intent: policyReply.intent,
          handoff_reason: policyReply.reason
        },
        action: policyReply.action,
        intent: policyReply.intent,
        requestedSlots: policyReply.requestedSlots,
        riskFlags: policyReply.riskFlags,
        handoffReason: policyReply.handoffReason ?? undefined
      }, {
        observedModelProvider: "policy",
        observedModelName: "deterministic"
      });
    }

    if (!this.options.provider) {
      return unavailableResult(baseMetadata);
    }

    try {
      const providerResult = await this.options.provider.generateReply({
        turn: input,
        instructions: buildWidgetAiInstructions(),
        userInput: buildWidgetAiUserInput(input)
      });
      const observation = trustedObservation(
        providerResult,
        this.options.provider.providerKind
      );

      if (!observation) {
        return observed({
          decision: "no_reply",
          reason: "model_error",
          metadata: {
            ...baseMetadata,
            model_provider: "none",
            fallback_mode: "manager_required",
            error_type: "model_error"
          }
        }, { observedModelProvider: "none" });
      }

      const text = normalizeReply(providerResult.text);

      if (!text) {
        return observed({
          decision: "no_reply",
          reason: "empty_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: observation.observedModelProvider,
            ...(observation.observedModelName
              ? { model_name: observation.observedModelName }
              : {}),
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            error_type: "empty_model_response",
            ...usageMetadata(observation.usage)
          }
        }, observation);
      }

      const unsafeReason = unsafeWidgetAiModelReplyReason(text);

      if (unsafeReason) {
        return observed({
          decision: "no_reply",
          reason: "unsafe_model_response",
          metadata: {
            ...baseMetadata,
            model_provider: observation.observedModelProvider,
            ...(observation.observedModelName
              ? { model_name: observation.observedModelName }
              : {}),
            openai_response_id: providerResult.responseId,
            fallback_mode: "manager_required",
            handoff_reason: unsafeReason,
            blocked_model_reply: true,
            error_type: "unsafe_model_response",
            ...usageMetadata(observation.usage)
          }
        }, observation);
      }

      if (providerResult.decision) {
        return observed(
          providerDecisionResult({
            decision: providerResult.decision,
            text,
            baseMetadata,
            observation,
            responseId: providerResult.responseId,
            usage: observation.usage,
            input
          }),
          observation
        );
      }

      return observed({
        decision: "reply_candidate",
        text,
        metadata: {
          ...baseMetadata,
          model_provider: observation.observedModelProvider,
          ...(observation.observedModelName
            ? { model_name: observation.observedModelName }
            : {}),
          openai_response_id: providerResult.responseId,
          ...usageMetadata(observation.usage)
        }
      }, observation);
    } catch {
      return observed({
        decision: "no_reply",
        reason: "model_error",
        metadata: {
          ...baseMetadata,
          model_provider: "none",
          fallback_mode: "manager_required",
          error_type: "model_error"
        }
      }, { observedModelProvider: "none" });
    }
  }
}

function providerDecisionResult(input: {
  decision: AiTurnCandidateDecision;
  text: string;
  baseMetadata: Record<string, unknown>;
  observation: TrustedWidgetAiProviderObservation;
  responseId?: string;
  usage?: WidgetAiUsage;
  input: AiTurnInput;
}): AiReplyCandidateDecision {
  const decision = input.decision;
  const metadata = {
    ...input.baseMetadata,
    model_provider: input.observation.observedModelProvider,
    ...(input.observation.observedModelName
      ? { model_name: input.observation.observedModelName }
      : {}),
    openai_response_id: input.responseId,
    ai_action: decision.action,
    ai_intent: decision.intent,
    confidence: decision.confidence,
    ...(decision.riskFlags.length ? { risk_flags: decision.riskFlags } : {}),
    ...(decision.handoffReason ? { handoff_reason: decision.handoffReason } : {}),
    ...usageMetadata(input.usage)
  };

  if (decision.action === "block" || decision.action === "fallback") {
    return {
      decision: "no_reply",
      reason: "unsafe_model_response",
      metadata: {
        ...metadata,
        fallback_mode: "manager_required",
        error_type: "unsafe_model_response"
      }
    };
  }

  return {
    decision: "reply_candidate",
    text: input.text,
    agentAllowedToReplyAfterSend: decision.action === "handoff" ? false : undefined,
    metadata,
    action: decision.action,
    intent: decision.intent,
    requestedSlots: decision.requestedSlots,
    riskFlags: decision.riskFlags,
    handoffReason: decision.handoffReason ?? undefined,
    sourceEvidence: decision.sourceEvidence,
    confidence: decision.confidence,
    slotUpdates: decision.extractedSlots.map((slot) => ({
      ...slot,
      source: "ai_extraction" as const,
      sourceMessageId: input.input.inboundMessage.publicMessageId
    }))
  };
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

function observed<T extends object>(
  result: T,
  observation: TrustedWidgetAiProviderObservation
): T {
  trustedProviderObservations.set(result, observation);
  return result;
}

function trustedObservation(
  result: WidgetAiProviderResult,
  providerKind: WidgetAiProvider["providerKind"]
): TrustedWidgetAiProviderObservation | undefined {
  if (
    result.modelProvider !== providerKind ||
    !isSafeWidgetAiModelName(result.modelName)
  ) {
    return undefined;
  }

  const usage = trustedUsage(result.usage);
  return {
    observedModelProvider: result.modelProvider,
    observedModelName: result.modelName,
    ...(usage ? { usage } : {})
  };
}

function unavailableResult(baseMetadata: Record<string, unknown>): WidgetAiReplyResult {
  return observed({
    decision: "no_reply",
    reason: "missing_openai_config",
    metadata: {
      ...baseMetadata,
      model_provider: "none",
      fallback_mode: "manager_required",
      error_type: "missing_openai_config"
    }
  }, { observedModelProvider: "none" });
}

function trustedUsage(usage: WidgetAiUsage | undefined): WidgetAiUsage | undefined {
  const valid = (value: number | undefined) =>
    value !== undefined && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647
      ? value
      : undefined;
  const sanitized = {
    ...(valid(usage?.inputTokens) === undefined
      ? {}
      : { inputTokens: valid(usage?.inputTokens) }),
    ...(valid(usage?.outputTokens) === undefined
      ? {}
      : { outputTokens: valid(usage?.outputTokens) }),
    ...(valid(usage?.totalTokens) === undefined
      ? {}
      : { totalTokens: valid(usage?.totalTokens) })
  };

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
