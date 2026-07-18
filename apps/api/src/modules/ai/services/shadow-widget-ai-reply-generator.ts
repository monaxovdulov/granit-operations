import type {
  PublicWidgetAiReplyGenerator,
  PublicWidgetAiReplyResult
} from "../../intake/ports/public-widget-ai-reply-generator.js";
import type { AiTurnInput } from "../ai-turn.js";

export const WIDGET_AI_SHADOW_OBSERVATION_VERSION =
  "granit_widget_ai_shadow_comparison.v2" as const;

export type WidgetAiShadowObservation = {
  version: typeof WIDGET_AI_SHADOW_OBSERVATION_VERSION;
  publicConversationId: string;
  inboundPublicMessageId: string;
  inputFingerprint?: string;
  startedAt: string;
  completedAt: string;
  legacyLatencyMs: number;
  groundedLatencyMs: number;
  legacyResult: Record<string, unknown>;
  groundedResult?: Record<string, unknown>;
  groundedErrorCode?: string;
};

export interface WidgetAiShadowObservationSink {
  record(observation: WidgetAiShadowObservation): Promise<void>;
}

export class ShadowWidgetAiReplyGenerator implements PublicWidgetAiReplyGenerator {
  constructor(
    private readonly legacy: PublicWidgetAiReplyGenerator,
    private readonly grounded: PublicWidgetAiReplyGenerator,
    private readonly sink?: WidgetAiShadowObservationSink
  ) {}

  async generateReply(input: AiTurnInput): Promise<PublicWidgetAiReplyResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const groundedStartedAtMs = Date.now();
    const groundedSettled = Promise.resolve(this.grounded.generateReply(input)).then(
      (result) => ({
        status: "fulfilled" as const,
        result: result as PublicWidgetAiReplyResult,
        latencyMs: Date.now() - groundedStartedAtMs
      }),
      (error: unknown) => ({
        status: "rejected" as const,
        errorCode: safeErrorCode(error),
        latencyMs: Date.now() - groundedStartedAtMs
      })
    );

    const legacyResult = (await this.legacy.generateReply(
      input
    )) as PublicWidgetAiReplyResult;
    const legacyLatencyMs = Date.now() - startedAtMs;

    void groundedSettled
      .then((grounded) =>
        this.sink?.record({
          version: WIDGET_AI_SHADOW_OBSERVATION_VERSION,
          publicConversationId: input.conversation.publicConversationId,
          inboundPublicMessageId: input.inboundMessage.publicMessageId,
          inputFingerprint: input.turn.inputFingerprint,
          startedAt,
          completedAt: new Date().toISOString(),
          legacyLatencyMs,
          groundedLatencyMs: grounded.latencyMs,
          legacyResult: shadowSummary(legacyResult),
          groundedResult:
            grounded.status === "fulfilled" ? shadowSummary(grounded.result) : undefined,
          groundedErrorCode:
            grounded.status === "rejected" ? grounded.errorCode : undefined
        })
      )
      .catch(() => undefined);

    return legacyResult;
  }
}

export function shadowSummary(result: PublicWidgetAiReplyResult): Record<string, unknown> {
  return result.decision === "reply_candidate"
    ? {
        decision: result.decision,
        reply_text: result.text,
        action: result.action ?? null,
        intent: result.intent ?? null,
        requested_slots: result.requestedSlots ?? [],
        slot_updates: (result.slotUpdates ?? []).map((slot) => ({
          name: slot.name,
          value: slot.value,
          confidence: slot.confidence,
          evidence: slot.evidence ?? null
        })),
        requirement_updates: (result.requirementUpdates ?? []).map((requirement) => ({
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          confidence: requirement.confidence,
          evidence: requirement.evidence
        })),
        risk_flags: result.riskFlags ?? [],
        handoff_reason: result.handoffReason ?? null,
        confidence: result.confidence ?? null,
        grounding_verified: result.metadata.grounding_verified === true,
        claim_coverage_complete: result.metadata.claim_coverage_complete ?? null,
        verifier_verdict: result.metadata.verifier_verdict ?? null,
        verifier_violations: result.metadata.verifier_violations ?? [],
        verifier_contract_issues: result.metadata.verifier_contract_issues ?? [],
        model_name: result.metadata.model_name ?? null,
        verifier_model_name: result.metadata.verifier_model_name ?? null,
        latency_ms: result.metadata.latency_ms ?? null
      }
    : {
        decision: result.decision,
        reason: result.reason,
        verifier_verdict: result.metadata.verifier_verdict ?? null,
        verifier_violations: result.metadata.verifier_violations ?? [],
        verifier_contract_issues: result.metadata.verifier_contract_issues ?? [],
        model_name: result.metadata.model_name ?? null,
        verifier_model_name: result.metadata.verifier_model_name ?? null,
        latency_ms: result.metadata.latency_ms ?? null
      };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && error.name.trim()) {
    return error.name.slice(0, 120);
  }

  return "unknown_error";
}
