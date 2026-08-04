import { randomUUID } from "node:crypto";

import {
  aiTurnExecutionContextMatchesInput,
  type AiTurnExecutionContext,
  type AiTurnInput
} from "../ai-turn.js";
import {
  MastraLiveV2GenerationError,
  type RejectedLiveV2RuntimeObservation,
  type ObservedLiveV2DecisionGenerator,
  type TrustedLiveV2RuntimeObservation
} from "../adapters/mastra-live-v2-decision-generator.js";
import type { LiveV2FactsSnapshot } from "../profiles/live-v2/live-v2-assets.js";
import {
  executeLiveV2Turn,
  type LiveV2TurnOutcome
} from "../profiles/live-v2/live-v2-orchestrator.js";
import type { LiveV2Candidate } from "../profiles/live-v2/live-v2-contract.js";
import type {
  RecordedAiPersistReplyResult,
  RecordedAiTurnOutcome,
  RecordedAiTurnResult,
  RecordedAiTurnService
} from "../ports/recorded-ai-turn.js";
import type {
  RecordedSiteWidgetAiGateRepository
} from "../repositories/recorded-site-widget-ai-reply-repository.js";
import type {
  AiModelProvider,
  AiQualityEventWrite,
  AiRunModelConfig,
  AiRunRepository,
  AiRunSpanErrorCode,
  AiRunSpanWrite,
  AiRunTerminalCompletion,
  AiRunUsage,
  AiRunVersions,
  BeginAiRunResult,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";

export type RecordedLiveV2TurnServiceOptions = {
  repository: AiRunRepository;
  gateRepository: RecordedSiteWidgetAiGateRepository;
  generator: ObservedLiveV2DecisionGenerator;
  approvedFacts: LiveV2FactsSnapshot;
  versions: AiRunVersions;
  model: AiRunModelConfig;
  clock?: () => Date;
  idGenerator?: () => string;
};

type TrustedObservation = {
  observedModelProvider: AiModelProvider;
  observedModelName?: string;
  runtimeRunId?: string;
  usage?: AiRunUsage;
};

type TerminalState = Pick<
  AiRunTerminalCompletion,
  | "status"
  | "normalizedAction"
  | "outcomeReason"
  | "failureCode"
  | "validatorResult"
  | "sendGateResult"
  | "qualityEvents"
>;

export class RecordedLiveV2ExecutionError extends Error {
  constructor() {
    super("Recorded live_v2 execution failed");
    this.name = "RecordedLiveV2ExecutionError";
  }
}

export class RecordedLiveV2TurnService implements RecordedAiTurnService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;

  constructor(private readonly options: RecordedLiveV2TurnServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async execute(
    input: Parameters<RecordedAiTurnService["execute"]>[0]
  ): Promise<RecordedAiTurnResult> {
    const inputFingerprint = input.executionContext.turn.inputFingerprint;

    if (!inputFingerprint) {
      throw new RecordedLiveV2ExecutionError();
    }

    const startedAt = this.clock();
    let beginResult: BeginAiRunResult;

    try {
      beginResult = await this.options.repository.beginOrReplay({
        traceId: this.idGenerator(),
        leadId: input.executionContext.internal.leadId,
        conversationId: input.executionContext.internal.conversationId,
        inboundMessageId: input.executionContext.internal.inboundMessageId,
        channel: input.executionContext.channel,
        runtimeMode: "mastra_openai_api",
        decisionProfile: "live_v2",
        idempotencyKey: input.executionContext.turn.idempotencyKey,
        inputFingerprint,
        versions: this.options.versions,
        model: this.options.model,
        startedAt
      });
    } catch (error) {
      throw new RecordedLiveV2ExecutionError();
    }

    throwIfRecordedTurnAborted(input.signal);

    if (beginResult.kind === "terminal_replay") {
      return { kind: "terminal_replay", run: beginResult.run };
    }

    if (beginResult.kind === "running_replay") {
      return { kind: "running_replay", run: beginResult.run };
    }

    const run = beginResult.run;

    if (!aiTurnExecutionContextMatchesInput(input.executionContext, input.turnInput)) {
      const completed = await this.completeWithoutReply(
        run,
        this.completion(
          run,
          contextMismatchState(),
          [
            this.span(
              "validation",
              "candidate_validation",
              "failed",
              elapsedMs(startedAt, this.clock()),
              "validation_failed"
            )
          ],
          { observedModelProvider: "none" },
          false
        ),
        input.noReplyApplier
      );

      return {
        kind: "executed",
        run: completed,
        outcome: noReplyOutcome("execution_context_mismatch")
      };
    }

    let observation: TrustedObservation = { observedModelProvider: "none" };
    let generatorStartedAt: Date | undefined;
    let generatorCompletedAt: Date | undefined;
    let generatorSucceeded = false;
    let gateStartedAt: Date | undefined;
    let gateCompletedAt: Date | undefined;
    let atomicCompletion: TerminalAiRunRecord | undefined;

    try {
      const liveOutcome = await executeLiveV2Turn({
        turnInput: input.turnInput,
        approvedFacts: this.options.approvedFacts,
        generator: {
          generateDecision: async (generatorInput) => {
            generatorStartedAt = this.clock();
            try {
              throwIfRecordedTurnAborted(input.signal);
              const generation = await this.options.generator.generateDecision(generatorInput, {
                appTraceId: run.traceId,
                signal: input.signal
              });
              throwIfRecordedTurnAborted(input.signal);
              observation = toTrustedObservation(generation.observation);
              generatorSucceeded = true;
              return generation.candidate;
            } catch (error) {
              if (
                error instanceof MastraLiveV2GenerationError &&
                error.observation
              ) {
                observation = toTrustedObservation(error.observation);
              }

              throw error;
            } finally {
              generatorCompletedAt = this.clock();
            }
          }
        },
        gateReader: {
          readGate: async () => {
            gateStartedAt = this.clock();
            try {
              return await this.options.gateRepository.readRecordedSiteWidgetAiGate({
                leadId: run.leadId,
                conversationId: run.conversationId
              });
            } finally {
              gateCompletedAt = this.clock();
            }
          }
        }
      });
      const baseSpans = this.outcomeSpans({
        startedAt,
        liveOutcome,
        generatorStartedAt,
        generatorCompletedAt,
        generatorSucceeded,
        gateStartedAt,
        gateCompletedAt
      });

      if (liveOutcome.plan.kind === "persist_reply") {
        throwIfRecordedTurnAborted(input.signal);
        const action = liveOutcome.plan.action;
        const result = await input.replyApplier.persistReplyAndCompleteRun({
          run,
          reply: {
            executionContext: input.executionContext,
            action,
            replyDraft: liveOutcome.plan.replyDraft,
            metadata: decisionMetadata(liveOutcome.plan.decision),
            ...(liveOutcome.plan.agentAllowedToReplyAfterSend === false
              ? { agentAllowedToReplyAfterSend: false }
              : {})
          },
          completionPlan: {
            allowed: this.completion(
              run,
              allowedReplyState(action),
              baseSpans,
              observation,
              true
            ),
            agentReplyBlocked: this.completion(
              run,
              agentReplyBlockedState(action),
              baseSpans,
              observation,
              true
            ),
            persistenceUnconfirmed: this.completion(
              run,
              persistenceUnconfirmedState(action),
              baseSpans,
              observation,
              false
            )
          }
        });
        atomicCompletion = result.completedRun;
        assertAtomicCompletion(action, result);

        return {
          kind: "executed",
          run: atomicCompletion,
          outcome: persistedOutcome(liveOutcome.plan.decision, result)
        };
      }

      const state = terminalStateFor(liveOutcome);
      throwIfRecordedTurnAborted(input.signal);
      const completed = await this.completeWithoutReply(
        run,
        this.completion(
          run,
          state,
          baseSpans,
          observation,
          state.sendGateResult !== "not_checked"
        ),
        input.noReplyApplier
      );

      return {
        kind: "executed",
        run: completed,
        outcome: terminalOutcome(liveOutcome, completed)
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }

      if (atomicCompletion) {
        throw new RecordedLiveV2ExecutionError();
      }

      const failedAt = this.clock();
      const failedSpans: AiRunSpanWrite[] = [
        this.span(
          "runtime",
          "turn_execution",
          "failed",
          elapsedMs(startedAt, failedAt),
          "runtime_failed"
        )
      ];

      try {
        await this.completeWithoutReply(
          run,
          this.completion(
            run,
            executionFailedState(),
            failedSpans,
            observation,
            false
          ),
          input.noReplyApplier
        );
      } catch {
        // Preserve a fenced stale-attempt error so the durable worker can supersede it.
        throw error;
      }

      throw new RecordedLiveV2ExecutionError();
    }
  }

  private outcomeSpans(input: {
    startedAt: Date;
    liveOutcome: LiveV2TurnOutcome;
    generatorStartedAt?: Date;
    generatorCompletedAt?: Date;
    generatorSucceeded: boolean;
    gateStartedAt?: Date;
    gateCompletedAt?: Date;
  }): AiRunSpanWrite[] {
    const now = this.clock();
    const spans: AiRunSpanWrite[] = [];

    if (input.generatorStartedAt) {
      spans.push(
        this.span(
          "model",
          "model_generation",
          input.generatorSucceeded ? "succeeded" : "failed",
          elapsedMs(input.generatorStartedAt, input.generatorCompletedAt ?? now),
          input.generatorSucceeded ? undefined : "model_error"
        )
      );
    }

    if (input.liveOutcome.validation) {
      spans.push(
        this.span(
          "validation",
          "candidate_validation",
          input.liveOutcome.validation.ok ? "succeeded" : "failed",
          elapsedMs(input.generatorCompletedAt ?? input.startedAt, input.gateStartedAt ?? now),
          input.liveOutcome.validation.ok ? undefined : "validation_failed"
        )
      );
    } else if (
      input.liveOutcome.status === "context_invalid" ||
      input.liveOutcome.status === "assets_invalid"
    ) {
      spans.push(
        this.span(
          "validation",
          "candidate_validation",
          "failed",
          elapsedMs(input.generatorCompletedAt ?? input.startedAt, now),
          "validation_failed"
        )
      );
    }

    if (
      input.liveOutcome.plan.kind === "blocked" &&
      input.liveOutcome.plan.reason === "gate_closed"
    ) {
      spans.push(
        this.span(
          "send_gate",
          "send_gate_check",
          "blocked",
          elapsedMs(input.gateStartedAt ?? input.startedAt, input.gateCompletedAt ?? now),
          "send_gate_blocked"
        )
      );
    } else if (input.liveOutcome.status === "gate_unavailable") {
      spans.push(
        this.span(
          "send_gate",
          "send_gate_check",
          "failed",
          elapsedMs(input.gateStartedAt ?? input.startedAt, input.gateCompletedAt ?? now),
          "runtime_failed"
        )
      );
    }

    spans.push(
      this.span(
        "runtime",
        "runtime_execution",
        input.liveOutcome.status === "generator_failed" ||
          input.liveOutcome.status === "gate_unavailable"
          ? "failed"
          : "succeeded",
        elapsedMs(input.startedAt, now),
        input.liveOutcome.status === "generator_failed" ||
          input.liveOutcome.status === "gate_unavailable"
          ? "runtime_failed"
          : undefined
      )
    );

    return spans;
  }

  private completion(
    run: RunningAiRunRecord,
    state: TerminalState,
    spans: AiRunSpanWrite[],
    observation: TrustedObservation,
    sendGateChecked: boolean
  ): AiRunTerminalCompletion {
    const completedAt = this.clock();

    return {
      ...state,
      ...(observation.runtimeRunId ? { runtimeRunId: observation.runtimeRunId } : {}),
      observedModelProvider: observation.observedModelProvider,
      ...(observation.observedModelName
        ? { observedModelName: observation.observedModelName }
        : {}),
      ...(observation.usage ? { usage: observation.usage } : {}),
      ...(sendGateChecked ? { sendGateCheckedAt: completedAt } : {}),
      completedAt,
      latencyMs: elapsedMs(run.startedAt, completedAt),
      spans: [...spans],
      qualityEvents: [...state.qualityEvents]
    };
  }

  private async completeWithoutReply(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    applier?: NonNullable<Parameters<RecordedAiTurnService["execute"]>[0]["noReplyApplier"]>
  ): Promise<TerminalAiRunRecord> {
    if (applier) {
      return applier.completeWithoutReply({ run, completion });
    }
    return this.options.repository.completeWithoutReply({ run, completion });
  }

  private span(
    kind: AiRunSpanWrite["kind"],
    name: AiRunSpanWrite["name"],
    status: AiRunSpanWrite["status"],
    latencyMs: number,
    errorCode?: AiRunSpanErrorCode
  ): AiRunSpanWrite {
    return {
      spanId: this.idGenerator(),
      kind,
      name,
      status,
      latencyMs,
      ...(errorCode ? { errorCode } : {})
    };
  }
}

function throwIfRecordedTurnAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RecordedLiveV2ExecutionError();
  }
}

function toTrustedObservation(
  observation: TrustedLiveV2RuntimeObservation | RejectedLiveV2RuntimeObservation
): TrustedObservation {
  const usage = observation.usage
    ? {
        ...(observation.usage.inputTokens === undefined
          ? {}
          : { inputTokens: observation.usage.inputTokens }),
        ...(observation.usage.outputTokens === undefined
          ? {}
          : { outputTokens: observation.usage.outputTokens }),
        ...(observation.usage.totalTokens === undefined
          ? {}
          : { totalTokens: observation.usage.totalTokens })
      }
    : undefined;

  return {
    observedModelProvider: observation.observedModelProvider,
    ...(observation.observedModelName
      ? { observedModelName: observation.observedModelName }
      : {}),
    ...(observation.runtimeRunId ? { runtimeRunId: observation.runtimeRunId } : {}),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {})
  };
}

function allowedReplyState(
  action: Exclude<LiveV2Candidate["action"], "no_reply">
): TerminalState {
  if (action === "handoff_to_manager") {
    return {
      status: "handed_off",
      normalizedAction: action,
      outcomeReason: "handoff_to_manager",
      validatorResult: "passed",
      sendGateResult: "allowed",
      qualityEvents: [event("handoff", "handoff_to_manager", "info")]
    };
  }

  return {
    status: "persisted",
    normalizedAction: action,
    outcomeReason: "reply_persisted",
    validatorResult: "passed",
    sendGateResult: "allowed",
    qualityEvents: []
  };
}

function agentReplyBlockedState(
  action: Exclude<LiveV2Candidate["action"], "no_reply">
): TerminalState {
  return {
    status: "blocked",
    normalizedAction: action,
    outcomeReason: "agent_reply_blocked",
    failureCode: "send_gate_blocked",
    validatorResult: "passed",
    sendGateResult: "blocked",
    qualityEvents: [event("blocked", "agent_reply_blocked", "warning")]
  };
}

function persistenceUnconfirmedState(
  action: Exclude<LiveV2Candidate["action"], "no_reply">
): TerminalState {
  return {
    status: "failed",
    normalizedAction: action,
    outcomeReason: "ai_persistence_unconfirmed",
    failureCode: "persistence_failure",
    validatorResult: "passed",
    sendGateResult: "not_checked",
    qualityEvents: [event("runtime_failure", "ai_persistence_unconfirmed", "critical")]
  };
}

function terminalStateFor(outcome: LiveV2TurnOutcome): TerminalState {
  const normalizedAction =
    outcome.validation?.ok === true ? outcome.validation.decision.action : "no_reply";

  if (outcome.plan.kind === "blocked" && outcome.plan.reason === "gate_closed") {
    return {
      status: "blocked",
      normalizedAction,
      outcomeReason: "gate_closed",
      failureCode: "send_gate_blocked",
      validatorResult: outcome.validation?.ok === true ? "passed" : "not_run",
      sendGateResult: "blocked",
      qualityEvents: [event("blocked", "gate_closed", "warning")]
    };
  }

  if (outcome.status === "generator_failed") {
    return executionFailedState();
  }

  if (outcome.status === "context_invalid") {
    return contextMismatchState();
  }

  if (outcome.status === "gate_unavailable") {
    return {
      status: "failed",
      normalizedAction: "no_reply",
      outcomeReason: "recorder_failure",
      failureCode: "recorder_failure",
      validatorResult: outcome.validation.ok ? "passed" : "rejected",
      sendGateResult: "not_checked",
      qualityEvents: [event("runtime_failure", "recorder_failed", "critical")]
    };
  }

  if (outcome.validation?.ok === true && outcome.validation.decision.action === "no_reply") {
    const reason = outcome.validation.decision.reason;

    return {
      status: "fallback_unavailable",
      normalizedAction: "no_reply",
      outcomeReason: reason,
      validatorResult: "passed",
      sendGateResult: "not_checked",
      qualityEvents: [event("degradation", reason, "info")]
    };
  }

  return {
    status: "blocked",
    normalizedAction: "no_reply",
    outcomeReason: "candidate_invalid",
    failureCode: "invalid_candidate",
    validatorResult: outcome.validation?.ok === false ? "rejected" : "failed",
    sendGateResult: "not_checked",
    qualityEvents: [event("policy_violation", "candidate_invalid", "warning")]
  };
}

function contextMismatchState(): TerminalState {
  return {
    status: "blocked",
    normalizedAction: "no_reply",
    outcomeReason: "execution_context_mismatch",
    failureCode: "execution_context_mismatch",
    validatorResult: "failed",
    sendGateResult: "not_checked",
    qualityEvents: [event("policy_violation", "execution_context_mismatch", "critical")]
  };
}

function executionFailedState(): TerminalState {
  return {
    status: "fallback_unavailable",
    normalizedAction: "no_reply",
    outcomeReason: "generator_failed",
    failureCode: "runtime_failure",
    validatorResult: "not_run",
    sendGateResult: "not_checked",
    qualityEvents: [event("runtime_failure", "runtime_failed", "critical")]
  };
}

function event(
  eventType: AiQualityEventWrite["eventType"],
  reasonCode: AiQualityEventWrite["reasonCode"],
  severity: AiQualityEventWrite["severity"]
): AiQualityEventWrite {
  return { eventType, reasonCode, severity, managerVisible: true };
}

function decisionMetadata(decision: Exclude<LiveV2Candidate, { action: "no_reply" }>) {
  return {
    normalized_action: decision.action,
    ...(decision.action === "handoff_to_manager"
      ? { handoff_reason: "manager_requested" }
      : {})
  };
}

function persistedOutcome(
  decision: Exclude<LiveV2Candidate, { action: "no_reply" }>,
  result: RecordedAiPersistReplyResult
): RecordedAiTurnOutcome {
  if (result.status === "blocked") {
    return {
      decision: { action: decision.action, reason: decision.reason },
      result: {
        status: "blocked",
        reason: result.reason,
        evidence: { decision_profile: "live_v2", normalized_action: decision.action }
      }
    };
  }

  const persistedReply = {
    internalMessageId: result.internalMessageId,
    publicMessageId: result.publicMessageId,
    body: result.body
  };

  return {
    decision: { action: decision.action, reason: decision.reason },
    result:
      decision.action === "handoff_to_manager"
        ? {
            status: "handed_off",
            reason: "live_v2_handoff_to_manager",
            evidence: { decision_profile: "live_v2", normalized_action: decision.action }
          }
        : {
            status: "persisted",
            publicMessageId: result.publicMessageId,
            evidence: { decision_profile: "live_v2", normalized_action: decision.action }
          },
    persistedReply
  };
}

function terminalOutcome(
  outcome: LiveV2TurnOutcome,
  run: TerminalAiRunRecord
): RecordedAiTurnOutcome {
  const decision = outcome.validation?.ok ? outcome.validation.decision : undefined;
  const action = decision?.action ?? "no_reply";

  return {
    decision: {
      action,
      reason:
        decision?.reason ??
        (outcome.plan.kind === "blocked" || outcome.plan.kind === "no_reply"
          ? outcome.plan.reason
          : run.outcomeReason)
    },
    result:
      run.sendGateResult === "blocked"
        ? {
            status: "blocked",
            reason: "agent_reply_blocked",
            evidence: { decision_profile: "live_v2", normalized_action: action }
          }
        : {
            status: "fallback_unavailable",
            reason: run.outcomeReason,
            evidence: { decision_profile: "live_v2", normalized_action: action }
          }
  };
}

function noReplyOutcome(reason: string): RecordedAiTurnOutcome {
  return {
    decision: { action: "no_reply", reason },
    result: {
      status: "fallback_unavailable",
      reason,
      evidence: { decision_profile: "live_v2", normalized_action: "no_reply" }
    }
  };
}

function assertAtomicCompletion(
  action: Exclude<LiveV2Candidate["action"], "no_reply">,
  result: RecordedAiPersistReplyResult
): void {
  if (result.status === "persisted") {
    const expectedStatus = action === "handoff_to_manager" ? "handed_off" : "persisted";
    if (result.completedRun.status !== expectedStatus) {
      throw new RecordedLiveV2ExecutionError();
    }
    return;
  }

  const expectedStatus = result.reason === "agent_reply_blocked" ? "blocked" : "failed";
  if (result.completedRun.status !== expectedStatus) {
    throw new RecordedLiveV2ExecutionError();
  }
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}
