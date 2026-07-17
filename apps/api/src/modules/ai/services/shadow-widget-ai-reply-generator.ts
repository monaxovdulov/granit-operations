import type {
  PublicWidgetAiReplyGenerator,
  PublicWidgetAiReplyResult
} from "../../intake/ports/public-widget-ai-reply-generator.js";
import type { AiTurnInput } from "../ai-turn.js";

export class ShadowWidgetAiReplyGenerator implements PublicWidgetAiReplyGenerator {
  constructor(
    private readonly legacy: PublicWidgetAiReplyGenerator,
    private readonly grounded: PublicWidgetAiReplyGenerator
  ) {}

  async generateReply(input: AiTurnInput): Promise<PublicWidgetAiReplyResult> {
    const [legacyResult, groundedResult] = await Promise.all([
      this.legacy.generateReply(input) as Promise<PublicWidgetAiReplyResult>,
      this.grounded
        .generateReply(input)
        .then((result) => result as PublicWidgetAiReplyResult)
        .catch(() => undefined)
    ]);

    if (!groundedResult) {
      return legacyResult;
    }

    return {
      ...legacyResult,
      metadata: {
        ...legacyResult.metadata,
        grounded_shadow: shadowSummary(groundedResult)
      }
    };
  }
}

function shadowSummary(result: PublicWidgetAiReplyResult) {
  return result.decision === "reply_candidate"
    ? {
        decision: result.decision,
        action: result.action ?? null,
        intent: result.intent ?? null,
        handoff_reason: result.handoffReason ?? null,
        verifier_verdict: result.metadata.verifier_verdict ?? null,
        verifier_violations: result.metadata.verifier_violations ?? []
      }
    : {
        decision: result.decision,
        reason: result.reason,
        verifier_verdict: result.metadata.verifier_verdict ?? null,
        verifier_violations: result.metadata.verifier_violations ?? []
      };
}

