import type { PublicWidgetAiReplyGenerator } from "../../intake/ports/public-widget-ai-reply-generator.js";
import {
  WIDGET_AI_DISCLOSURE_VERSION
} from "../../intake/ports/public-widget-ai-reply-generator.js";
import type {
  AiReplyCandidateDecision,
  AiTurnInput,
  AiUnavailableReason
} from "../ai-turn.js";
import type {
  CatalogKnowledgePort,
  CatalogRecord,
  CatalogSnapshot
} from "../catalog/catalog-knowledge-port.js";
import { EmptyCatalogKnowledgeProvider } from "../catalog/empty-catalog-knowledge-provider.js";
import {
  GROUNDED_AI_TURN_DECISION_VERSION,
  type GroundedAiTurnCandidateDecision
} from "../ai-dialog-contract.js";
import { validateGroundedAiDecision } from "../grounding/ai-decision-validator.js";
import {
  buildWidgetAiCalculationPolicyReply,
  WIDGET_AI_POLICY_VERSION,
  type WidgetAiPolicyReply
} from "../policy/widget-ai-policy.js";
import {
  buildGroundedWidgetAiInstructions,
  buildGroundedWidgetAiUserInput,
  GROUNDED_WIDGET_AI_PROMPT_VERSION
} from "../prompts/widget-ai-prompt.js";
import {
  buildWidgetAiVerifierInstructions,
  buildWidgetAiVerifierUserInput,
  WIDGET_AI_VERIFIER_VERSION,
  type WidgetAiSemanticVerifier,
  type WidgetAiVerification,
  type WidgetAiVerificationViolation,
  type WidgetAiVerifierResult
} from "../verification/widget-ai-semantic-verifier.js";
import {
  validateWidgetAiVerification,
  type WidgetAiVerificationContractIssue
} from "../verification/widget-ai-verification-validator.js";
import type { WidgetAiUsage } from "./widget-ai-service.js";

export const GROUNDED_WIDGET_AI_POLICY_VERSION =
  "granit_widget_ai_policy.semantic_verifier.v2";

export type GroundedWidgetAiProviderInput = {
  turn: AiTurnInput;
  snapshot: CatalogSnapshot;
  selectedRecords: readonly CatalogRecord[];
  instructions: string;
  userInput: string;
  attempt: "initial" | "repair";
};

export type GroundedWidgetAiProviderResult = {
  decision: GroundedAiTurnCandidateDecision;
  modelProvider: "openai" | "fake";
  modelName: string;
  responseId?: string;
  usage?: WidgetAiUsage;
};

export interface GroundedWidgetAiProvider {
  generateGroundedReply(
    input: GroundedWidgetAiProviderInput,
    signal?: AbortSignal
  ): Promise<GroundedWidgetAiProviderResult>;
}

export type GroundedWidgetAiServiceOptions = {
  provider: GroundedWidgetAiProvider;
  verifier: WidgetAiSemanticVerifier;
  catalog?: CatalogKnowledgePort;
  modelName?: string;
  verifierModelName?: string;
  deadlineMs?: number;
  minimumRepairBudgetMs?: number;
};

type GroundedAttempt = {
  decision: GroundedAiTurnCandidateDecision;
  verification: WidgetAiVerification;
  generator: GroundedWidgetAiProviderResult;
  verifierModelName: string;
  verifierResponseId?: string;
  verifierUsage?: WidgetAiUsage;
  verificationIssues: WidgetAiVerificationContractIssue[];
};

export class GroundedWidgetAiService implements PublicWidgetAiReplyGenerator {
  private readonly catalog: CatalogKnowledgePort;

  constructor(private readonly options: GroundedWidgetAiServiceOptions) {
    this.catalog = options.catalog ?? new EmptyCatalogKnowledgeProvider();
  }

  async generateReply(input: AiTurnInput): Promise<AiReplyCandidateDecision> {
    const deadlineMs = this.options.deadlineMs ?? 18000;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);

    try {
      const policyReply = buildWidgetAiCalculationPolicyReply(input);

      if (policyReply) {
        return this.toPolicyReply(policyReply, startedAt);
      }

      const snapshot = await this.catalog.getSnapshot();
      const selectedRecords = await this.catalog.search(snapshot, {
        query: buildCatalogQuery(input),
        at: input.inboundMessage.submittedAt,
        limit: 12
      });
      const initial = await this.runAttempt(
        input,
        snapshot,
        selectedRecords,
        "initial",
        undefined,
        controller.signal
      );

      if (initial?.verification.verdict === "handoff") {
        return this.toSafeHandoff(input, snapshot, initial, startedAt);
      }

      if (initial && isPass(initial)) {
        return initial.decision.action === "handoff"
          ? this.toSafeHandoff(input, snapshot, initial, startedAt)
          : this.toReplyCandidate(input, snapshot, initial, startedAt);
      }

      const remainingMs = deadlineMs - (Date.now() - startedAt);

      if (
        initial &&
        initial.verification.verdict === "repair" &&
        remainingMs >= (this.options.minimumRepairBudgetMs ?? 3500)
      ) {
        const repaired = await this.runAttempt(
          input,
          snapshot,
          selectedRecords,
          "repair",
          {
            previousDecision: initial.decision,
            verification: initial.verification
          },
          controller.signal
        );

        if (repaired?.verification.verdict === "handoff") {
          return this.toSafeHandoff(input, snapshot, repaired, startedAt, true);
        }

        if (repaired && isPass(repaired)) {
          return repaired.decision.action === "handoff"
            ? this.toSafeHandoff(input, snapshot, repaired, startedAt, true)
            : this.toReplyCandidate(input, snapshot, repaired, startedAt, true);
        }
      }

      return this.unavailable(
        controller.signal.aborted ? "turn_timeout" : "grounding_validation_failed",
        snapshot,
        startedAt,
        initial?.verification
      );
    } catch (error) {
      return this.unavailable(
        controller.signal.aborted || isAbortError(error)
          ? "turn_timeout"
          : error instanceof SemanticVerifierCallError
          ? "semantic_verifier_error"
          : "model_error",
        undefined,
        startedAt
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runAttempt(
    input: AiTurnInput,
    snapshot: CatalogSnapshot,
    selectedRecords: readonly CatalogRecord[],
    attempt: "initial" | "repair",
    repairContext:
      | {
          previousDecision: GroundedAiTurnCandidateDecision;
          verification: WidgetAiVerification;
        }
      | undefined,
    signal: AbortSignal
  ): Promise<GroundedAttempt | null> {
    const baseUserInput = buildGroundedWidgetAiUserInput({
      turn: input,
      snapshot,
      selectedRecords
    });
    const generator = await this.options.provider.generateGroundedReply(
      {
        turn: input,
        snapshot,
        selectedRecords,
        instructions: buildGroundedWidgetAiInstructions(),
        userInput: repairContext
          ? JSON.stringify({
              input: JSON.parse(baseUserInput),
              repair: {
                previousDecision: repairContext.previousDecision,
                verifierVerdict: repairContext.verification
              }
            })
          : baseUserInput,
        attempt
      },
      signal
    );
    const validation = validateGroundedAiDecision(generator.decision, input);

    if (!validation.valid) {
      if (attempt === "initial" && !signal.aborted) {
        const syntheticVerification: WidgetAiVerification = {
          version: WIDGET_AI_VERIFIER_VERSION,
          verdict: "repair",
          requiredAction: null,
          violations: validation.issues.map((issue) => ({
            code:
              issue === "invalid_slot_evidence"
                ? "invalid_slot_evidence"
                : issue === "invalid_requirement_evidence"
                ? "invalid_requirement_evidence"
                : "unsupported_claim",
            detail: issue,
            claimStart: null,
            claimEnd: null
          })),
          factualClaimsPresent: false,
          claimCoverageComplete: false,
          claimVerdicts: [],
          slotVerdicts: [],
          requirementVerdicts: [],
          confidence: 1
        };

        return {
          decision: generator.decision,
          verification: syntheticVerification,
          generator,
          verifierModelName: "app_structural_validation",
          verificationIssues: []
        };
      }

      return null;
    }

    let verifierResult: WidgetAiVerifierResult;

    try {
      verifierResult = await this.options.verifier.verify(
        {
          turn: input,
          decision: validation.decision,
          snapshot,
          selectedRecords,
          instructions: buildWidgetAiVerifierInstructions(),
          userInput: buildWidgetAiVerifierUserInput({
            turn: input,
            decision: validation.decision,
            snapshot,
            selectedRecords
          })
        },
        signal
      );
    } catch (error) {
      throw new SemanticVerifierCallError(error);
    }

    const verificationIssues = validateWidgetAiVerification({
      turn: input,
      decision: validation.decision,
      verification: verifierResult.verification,
      snapshot,
      selectedRecords
    });

    return {
      decision: validation.decision,
      verification: verifierResult.verification,
      generator,
      verifierModelName: verifierResult.modelName,
      verifierResponseId: verifierResult.responseId,
      verifierUsage: verifierResult.usage,
      verificationIssues
    };
  }

  private toReplyCandidate(
    input: AiTurnInput,
    snapshot: CatalogSnapshot,
    attempt: GroundedAttempt,
    startedAt: number,
    repaired = false
  ): AiReplyCandidateDecision {
    return {
      decision: "reply_candidate",
      text: attempt.decision.replyText.trim(),
      agentAllowedToReplyAfterSend:
        attempt.decision.action === "handoff" ? false : undefined,
      action: attempt.decision.action,
      intent: attempt.decision.intent,
      slotUpdates: attempt.decision.extractedSlots.map((slot) => ({
        name: slot.name,
        value: slot.value,
        confidence: slot.confidence,
        evidence: slot.evidence,
        source: "ai_extraction" as const,
        sourceMessageId: slot.evidence.messageId
      })),
      requirementUpdates: attempt.decision.extractedRequirements.map((requirement) => ({
        ...requirement,
        source: "ai_extraction" as const,
        sourceMessageId: requirement.evidence.messageId
      })),
      requestedSlots: attempt.decision.requestedSlots,
      riskFlags: attempt.decision.riskFlags,
      handoffReason: attempt.decision.handoffReason ?? undefined,
      confidence: Math.min(attempt.decision.confidence, attempt.verification.confidence),
      metadata: {
        ...this.baseMetadata(snapshot, startedAt),
        model_provider: attempt.generator.modelProvider,
        model_name: attempt.generator.modelName,
        openai_response_id: attempt.generator.responseId,
        verifier_model_name: attempt.verifierModelName,
        verifier_response_id: attempt.verifierResponseId,
        verifier_verdict: attempt.verification.verdict,
        verifier_violations: attempt.verification.violations.map((item) => item.code),
        verifier_contract_issues: attempt.verificationIssues,
        claim_coverage_complete: attempt.verification.claimCoverageComplete,
        claim_verdict_count: attempt.verification.claimVerdicts.length,
        slot_verdict_count: attempt.verification.slotVerdicts.length,
        requirement_verdict_count: attempt.verification.requirementVerdicts.length,
        grounding_verified: true,
        fallback_mode: "none",
        repair_applied: repaired,
        generator_usage: usageMetadata(attempt.generator.usage),
        verifier_usage: usageMetadata(attempt.verifierUsage)
      }
    };
  }

  private toPolicyReply(
    policyReply: WidgetAiPolicyReply,
    startedAt: number
  ): AiReplyCandidateDecision {
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
        ...this.baseMetadata(undefined, startedAt),
        model_provider: "policy",
        model_name: "deterministic",
        fallback_mode: policyReply.fallbackMode,
        deterministic_policy_version: WIDGET_AI_POLICY_VERSION,
        policy_reason: policyReply.reason,
        ...(policyReply.handoffReason
          ? {
              handoff_reason: policyReply.reason,
              safe_handoff_reply: true
            }
          : {})
      }
    };
  }

  private toSafeHandoff(
    input: AiTurnInput,
    snapshot: CatalogSnapshot,
    attempt: GroundedAttempt,
    startedAt: number,
    repaired = false
  ): AiReplyCandidateDecision {
    return safeHandoffResult(
      input,
      snapshot,
      attempt.verification,
      {
        ...this.baseMetadata(snapshot, startedAt),
        model_provider: attempt.generator.modelProvider,
        model_name: attempt.generator.modelName,
        openai_response_id: attempt.generator.responseId,
        verifier_model_name: attempt.verifierModelName,
        verifier_response_id: attempt.verifierResponseId,
        verifier_contract_issues: attempt.verificationIssues,
        repair_applied: repaired
      },
      attempt.decision.handoffReason ?? undefined
    );
  }

  private unavailable(
    reason: AiUnavailableReason,
    snapshot: CatalogSnapshot | undefined,
    startedAt: number,
    verification?: WidgetAiVerification
  ): AiReplyCandidateDecision {
    return {
      decision: "no_reply",
      reason,
      metadata: {
        ...this.baseMetadata(snapshot, startedAt),
        error_type: reason,
        verifier_verdict: verification?.verdict,
        verifier_violations: verification?.violations.map((item) => item.code) ?? []
      }
    };
  }

  private baseMetadata(snapshot: CatalogSnapshot | undefined, startedAt: number) {
    return {
      prompt_version: GROUNDED_WIDGET_AI_PROMPT_VERSION,
      policy_version: GROUNDED_WIDGET_AI_POLICY_VERSION,
      ai_decision_version: GROUNDED_AI_TURN_DECISION_VERSION,
      verifier_version: WIDGET_AI_VERIFIER_VERSION,
      ai_disclosure_shown: true,
      ai_disclosure_version: WIDGET_AI_DISCLOSURE_VERSION,
      catalog_schema_version: snapshot?.schemaVersion ?? null,
      catalog_version: snapshot?.catalogVersion ?? null,
      catalog_content_hash: snapshot?.contentHash ?? null,
      model_name: this.options.modelName ?? null,
      verifier_model_name: this.options.verifierModelName ?? null,
      latency_ms: Date.now() - startedAt,
      fallback_mode: "manager_required"
    };
  }
}

function isPass(attempt: GroundedAttempt): boolean {
  const { verification } = attempt;
  return (
    verification.verdict === "pass" &&
    verification.violations.length === 0 &&
    verification.claimCoverageComplete &&
    attempt.verificationIssues.length === 0
  );
}

function safeHandoffResult(
  input: AiTurnInput,
  snapshot: CatalogSnapshot,
  verification: WidgetAiVerification,
  metadata: Record<string, unknown>,
  decisionHandoffReason?: GroundedAiTurnCandidateDecision["handoffReason"]
): AiReplyCandidateDecision {
  const violationCodes = verification.violations.map((item) => item.code);
  const handoffReason =
    decisionHandoffReason ?? handoffReasonForViolations(violationCodes);
  const contactKnown = Boolean(
    input.customer.phoneProvided ||
      input.customer.emailProvided ||
      input.customer.preferredContact ||
      input.knownSlots.values.phone ||
      input.knownSlots.values.preferredContact
  );

  return {
    decision: "reply_candidate",
    text: contactKnown
      ? "Передам диалог менеджеру вместе с уже указанным контактом."
      : "Передам вопрос менеджеру. Напишите телефон или удобный способ связи.",
    agentAllowedToReplyAfterSend: false,
    action: "handoff",
    intent:
      handoffReason === "manager_requested"
        ? "manager_request"
        : handoffReason === "out_of_scope"
        ? "out_of_scope"
        : "binding_terms",
    requestedSlots: [],
    riskFlags:
      handoffReason === "manager_requested" ? ["manager_requested"] : ["binding_terms_requested"],
    handoffReason,
    confidence: verification.confidence,
    metadata: {
      ...metadata,
      catalog_version: snapshot.catalogVersion,
      grounding_verified: true,
      claim_coverage_complete: true,
      claim_verdict_count: 0,
      verifier_verdict: "handoff",
      verifier_violations: violationCodes,
      safe_handoff_reply: true
    }
  };
}

class SemanticVerifierCallError extends Error {
  constructor(readonly cause: unknown) {
    super("semantic verifier call failed");
    this.name = "SemanticVerifierCallError";
  }
}

function handoffReasonForViolations(violations: WidgetAiVerificationViolation[]) {
  if (violations.includes("missed_manager_request")) {
    return "manager_requested" as const;
  }

  if (violations.includes("legal_advice")) {
    return "out_of_scope" as const;
  }

  if (violations.includes("low_confidence")) {
    return "low_confidence" as const;
  }

  return "binding_terms" as const;
}

function usageMetadata(usage?: WidgetAiUsage) {
  return {
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null
  };
}

function buildCatalogQuery(input: AiTurnInput) {
  const recentVisitorText = input.compactContext.messages
    .filter((message) => message.senderRole === "visitor")
    .slice(-4)
    .map((message) => message.text);
  const knownValues = Object.values(input.knownSlots.values)
    .flatMap((slot) => (slot?.value ? [slot.value] : []))
    .slice(0, 13);
  const knownRequirements = input.knownRequirements
    .map((requirement) => requirement.value)
    .slice(0, 24);

  return [
    ...recentVisitorText,
    input.inboundMessage.text,
    ...knownValues,
    ...knownRequirements
  ]
    .join("\n")
    .slice(-6000);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
