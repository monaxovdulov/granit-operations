import { randomUUID } from "node:crypto";

import type { PublicWidgetAiReplyGenerator } from "../../intake/ports/public-widget-ai-reply-generator.js";
import {
  buildStageASiteWidgetAiTurnInput,
  type AiReplyCandidateDecision,
  type AiTurnInput
} from "../ai-turn.js";
import type {
  AiKnownSlots,
  AiSlotName,
  AiTurnAction
} from "../ai-dialog-contract.js";
import {
  runWidgetAiEvalCase,
  type WidgetAiEvalCase,
  type WidgetAiEvalOutput
} from "./widget-ai-regression-corpus.js";

export type WidgetAiEvalCaseResult = {
  caseId: string;
  passed: boolean;
  failures: string[];
  action: AiTurnAction;
  requestedSlots: string[];
  latencyMs: number;
  metadata: Record<string, unknown>;
};

export type WidgetAiEvalReport = {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  cases: WidgetAiEvalCaseResult[];
};

export async function runWidgetAiEvals(
  generator: PublicWidgetAiReplyGenerator,
  cases: readonly WidgetAiEvalCase[]
): Promise<WidgetAiEvalReport> {
  const startedAt = Date.now();
  const results: WidgetAiEvalCaseResult[] = [];

  for (const evalCase of cases) {
    const caseStartedAt = Date.now();
    const rawDecision = await generator.generateReply(toEvalTurnInput(evalCase));

    if (!isAiReplyCandidateDecision(rawDecision)) {
      throw new Error(`invalid AI decision returned for eval case ${evalCase.caseId}`);
    }

    const decision = rawDecision;
    const latencyMs = Date.now() - caseStartedAt;
    const output: WidgetAiEvalOutput =
      decision.decision === "reply_candidate"
        ? {
            action: decision.action ?? "answer",
            replyText: decision.text,
            requestedSlots: decision.requestedSlots ?? [],
            slotUpdates: decision.slotUpdates,
            requirementUpdates: decision.requirementUpdates,
            groundingVerified: decision.metadata.grounding_verified === true,
            claimCoverageComplete:
              decision.metadata.claim_coverage_complete === true,
            verifierVerdict:
              typeof decision.metadata.verifier_verdict === "string"
                ? decision.metadata.verifier_verdict
                : undefined,
            verifierViolations: readStringArray(
              decision.metadata.verifier_violations
            ),
            latencyMs
          }
        : {
            action: "fallback",
            replyText: "",
            requestedSlots: [],
            latencyMs
          };
    const evaluation = runWidgetAiEvalCase(evalCase, output);

    results.push({
      caseId: evalCase.caseId,
      passed: evaluation.passed,
      failures: evaluation.failures,
      action: output.action,
      requestedSlots: output.requestedSlots,
      latencyMs,
      metadata: decision.metadata
    });
  }

  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    durationMs: Date.now() - startedAt,
    cases: results
  };
}

export function validateWidgetAiEvalCorpus(cases: readonly WidgetAiEvalCase[]) {
  const failures: string[] = [];
  const ids = new Set<string>();

  for (const evalCase of cases) {
    if (ids.has(evalCase.caseId)) {
      failures.push(`duplicate_case_id:${evalCase.caseId}`);
    }

    ids.add(evalCase.caseId);

    if (!evalCase.sanitizedInput.messages.length) {
      failures.push(`empty_dialog:${evalCase.caseId}`);
    }

    if (evalCase.sanitizedInput.messages.some((message) => !message.trim())) {
      failures.push(`empty_message:${evalCase.caseId}`);
    }

    const selfCheck = runWidgetAiEvalCase(evalCase, {
      action: evalCase.expected.action,
      replyText:
        evalCase.expected.requiredPhrasesAny?.join(" ") ??
        "Нейтральный проверочный ответ без коммерческих обещаний.",
      requestedSlots: evalCase.expected.requestedSlot
        ? [evalCase.expected.requestedSlot]
        : [],
      slotUpdates: Object.entries(evalCase.expected.extractedSlots ?? {}).map(
        ([name, expected]) => ({
          name: name as AiSlotName,
          value: expected.value,
          evidence: evalEvidence(evalCase, expected.evidenceIncludes)
        })
      ),
      requirementUpdates: (evalCase.expected.requirements ?? []).map(
        (requirement) => ({
          category: requirement.category,
          mode: requirement.mode,
          value: requirement.value,
          evidence: evalEvidence(evalCase, requirement.evidenceIncludes)
        })
      ),
      groundingVerified: true,
      claimCoverageComplete: true,
      verifierVerdict: "pass",
      verifierViolations: [],
      latencyMs: 0
    });

    if (!selfCheck.passed) {
      failures.push(
        ...selfCheck.failures.map((failure) => `invalid_expectation:${evalCase.caseId}:${failure}`)
      );
    }
  }

  return { valid: failures.length === 0, failures };
}

function evalEvidence(evalCase: WidgetAiEvalCase, quote: string) {
  const message =
    evalCase.sanitizedInput.messages.find((candidate) => candidate.includes(quote)) ??
    evalCase.sanitizedInput.messages.at(-1) ??
    quote;
  const start = Math.max(0, message.indexOf(quote));

  return {
    messageId: "11111111-1111-4111-8111-111111111111",
    quote,
    start,
    end: start + quote.length
  };
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function isAiReplyCandidateDecision(value: unknown): value is AiReplyCandidateDecision {
  if (!value || typeof value !== "object" || !("decision" in value)) {
    return false;
  }

  const decision = value as Record<string, unknown>;

  if (!decision.metadata || typeof decision.metadata !== "object") {
    return false;
  }

  return decision.decision === "reply_candidate"
    ? typeof decision.text === "string"
    : decision.decision === "no_reply" && typeof decision.reason === "string";
}

function toEvalTurnInput(evalCase: WidgetAiEvalCase): AiTurnInput {
  const messages = evalCase.sanitizedInput.messages;
  const inboundText = messages.at(-1) ?? "";
  const submittedAt = "2026-07-17T12:00:00.000Z";
  const recentMessages = messages.slice(0, -1).map((text, index, preceding) => {
    const distanceFromInbound = preceding.length - index;
    const assistant = distanceFromInbound % 2 === 1;

    return {
      publicMessageId: randomUUID(),
      direction: assistant ? ("outbound" as const) : ("inbound" as const),
      senderRole: assistant ? ("ai_assistant" as const) : ("visitor" as const),
      contentType: "text" as const,
      submittedAt,
      text
    };
  });
  const knownSlots: AiKnownSlots = Object.fromEntries(
    Object.entries(evalCase.sanitizedInput.knownSlots).map(([name, value]) => [
      name,
      {
        value,
        source: "ai_extraction" as const,
        confidence: 1,
        updatedAt: submittedAt
      }
    ])
  );

  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: randomUUID(),
    publicMessageId: randomUUID(),
    requestFingerprint: "0".repeat(64),
    submittedAt,
    text: inboundText,
    page: {
      url: "https://example.test/catalog",
      widgetInstanceId: "live-eval"
    },
    customer: {
      phoneProvided: Boolean(knownSlots.phone),
      emailProvided: false,
      preferredContact:
        knownSlots.preferredContact?.value === "phone" ||
        knownSlots.preferredContact?.value === "whatsapp" ||
        knownSlots.preferredContact?.value === "telegram" ||
        knownSlots.preferredContact?.value === "email"
          ? knownSlots.preferredContact.value
          : undefined,
      city: knownSlots.city?.value
    },
    visitor: { locale: "ru-RU", timezone: "Europe/Moscow" },
    gate: { aiState: "ai_collecting_info", agentAllowedToReply: true },
    recentMessages,
    persistedSlots: knownSlots
  });
}
