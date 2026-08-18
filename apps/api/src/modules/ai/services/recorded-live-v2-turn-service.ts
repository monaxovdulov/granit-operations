import { randomUUID } from "node:crypto";

import {
  aiTurnExecutionContextMatchesInput,
  type AiTurnExecutionContext,
  type AiTurnInput
} from "../ai-turn.js";
import {
  LiveV2GenerationError,
  type RejectedLiveV2RuntimeObservation,
  type ObservedLiveV2DecisionGenerator,
  type TrustedLiveV2RuntimeObservation
} from "../ports/live-v2-runtime.js";
import type { LiveV2FactsSnapshot } from "../profiles/live-v2/live-v2-assets.js";
import {
  executeLiveV2Turn,
  type LiveV2TurnOutcome
} from "../profiles/live-v2/live-v2-orchestrator.js";
import type {
  LiveV2Candidate,
  LiveV2ValidationFailureCode
} from "../profiles/live-v2/live-v2-contract.js";
import {
  executeModelTurn,
  type ModelTurnApplyPlan,
  type ModelTurnOutcome
} from "../profiles/live-v2/model-turn-orchestrator.js";
import type {
  ModelTurnValidationIssue,
  ValidatedTurnPlan
} from "../profiles/live-v2/model-turn-contract.js";
import type { AiRequirementUpdate, AiSlotUpdate } from "../ai-dialog-contract.js";
import type {
  RecordedAiPersistReplyInput,
  RecordedAiPersistReplyResult,
  RecordedAiTurnOutcome,
  RecordedAiTurnResult,
  RecordedAiTurnService
} from "../ports/recorded-ai-turn.js";
import type { RecordedSiteWidgetAiGateRepository } from "../repositories/recorded-site-widget-ai-reply-repository.js";
import type {
  AiModelProvider,
  AiQualityEventWrite,
  AiRunModelConfig,
  AiRunRepository,
  AiRunRuntimeMode,
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
  runtimeMode?: AiRunRuntimeMode;
  turnContract?: "legacy_live_v2_candidate" | "model_turn_v1";
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

type RecordedPipelineOutcome = LiveV2TurnOutcome | ModelTurnOutcome;
type RecordedReplyDecision = {
  action: "answer" | "ask_clarifying_question" | "handoff_to_manager";
  reason: string;
};

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
    const attempt = input.attempt ?? {
      attemptNumber: 1,
      idempotencyKey: `${input.executionContext.turn.idempotencyKey}:attempt:1`,
      jobAttemptCount: 1
    };
    let beginResult: BeginAiRunResult;

    try {
      beginResult = await this.options.repository.beginOrReplay({
        traceId: this.idGenerator(),
        leadId: input.executionContext.internal.leadId,
        conversationId: input.executionContext.internal.conversationId,
        inboundMessageId: input.executionContext.internal.inboundMessageId,
        channel: input.executionContext.channel,
        runtimeMode: this.options.runtimeMode ?? "direct_openai",
        decisionProfile: "live_v2",
        idempotencyKey: input.executionContext.turn.idempotencyKey,
        attemptIdempotencyKey: attempt.idempotencyKey,
        attemptNumber: attempt.attemptNumber,
        ...(attempt.jobId ? { jobId: attempt.jobId } : {}),
        jobAttemptCount: attempt.jobAttemptCount,
        ...(attempt.maxAttempts === undefined ? {} : { maxAttempts: attempt.maxAttempts }),
        inputFingerprint,
        versions: this.options.versions,
        model: this.options.model,
        startedAt
      });
    } catch (error) {
      throw new RecordedLiveV2ExecutionError();
    }

    if (beginResult.kind === "terminal_replay") {
      return { kind: "terminal_replay", run: beginResult.run };
    }

    if (beginResult.kind === "running_replay") {
      return { kind: "running_replay", run: beginResult.run };
    }

    const run = beginResult.run;

    if (input.signal?.aborted) {
      await this.fenceAttempt(
        run,
        this.completion(
          run,
          executionFailedState(),
          [
            this.span(
              "runtime",
              "turn_execution",
              "blocked",
              elapsedMs(startedAt, this.clock()),
              "runtime_failed"
            )
          ],
          { observedModelProvider: "none" },
          false
        ),
        input.noReplyApplier
      ).catch(() => undefined);
      throw new RecordedLiveV2ExecutionError();
    }

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
      const executeTurn =
        this.options.turnContract === "model_turn_v1" ? executeModelTurn : executeLiveV2Turn;
      const liveOutcome: RecordedPipelineOutcome = await executeTurn({
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
              if (error instanceof LiveV2GenerationError && error.observation) {
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
        const decision = replyDecision(liveOutcome.plan);
        const validatedPlan = modelTurnPlan(liveOutcome.plan);
        const appliedPatches = validatedPlan
          ? splitAppliedPatches(validatedPlan.appliedPatches)
          : undefined;
        const handoff = validatedPlan
          ? buildRecordedHandoff(input.turnInput, validatedPlan, appliedPatches)
          : undefined;
        const result = await input.replyApplier.persistReplyAndCompleteRun({
          run,
          reply: {
            executionContext: input.executionContext,
            action,
            replyDraft: liveOutcome.plan.replyDraft,
            ...(validatedPlan ? { finalTextHash: validatedPlan.finalTextHash } : {}),
            metadata: decisionMetadata(decision, validatedPlan),
            ...(appliedPatches?.slotUpdates.length
              ? { slotUpdates: appliedPatches.slotUpdates }
              : {}),
            ...(appliedPatches?.requirementUpdates.length
              ? { requirementUpdates: appliedPatches.requirementUpdates }
              : {}),
            ...(handoff ? { handoff } : {}),
            ...(liveOutcome.plan.agentAllowedToReplyAfterSend === false
              ? { agentAllowedToReplyAfterSend: false }
              : {})
          },
          completionPlan: {
            allowed: this.completion(run, allowedReplyState(action), baseSpans, observation, true),
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
        assertCommittedText(validatedPlan, result);

        return {
          kind: "executed",
          run: atomicCompletion,
          outcome: persistedOutcome(decision, result)
        };
      }

      const state = terminalStateFor(liveOutcome);
      throwIfRecordedTurnAborted(input.signal);
      const completed = await this.completeWithoutReply(
        run,
        this.completion(run, state, baseSpans, observation, state.sendGateResult !== "not_checked"),
        input.noReplyApplier
      );

      return {
        kind: "executed",
        run: completed,
        outcome: terminalOutcome(liveOutcome, completed)
      };
    } catch (error) {
      if (input.signal?.aborted) {
        await this.fenceAttempt(
          run,
          this.completion(
            run,
            executionFailedState(),
            [
              this.span(
                "runtime",
                "turn_execution",
                "blocked",
                elapsedMs(startedAt, this.clock()),
                "runtime_failed"
              )
            ],
            observation,
            false
          ),
          input.noReplyApplier
        ).catch(() => undefined);
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
        await this.failAttempt(
          run,
          this.completion(run, executionFailedState(), failedSpans, observation, false),
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
    liveOutcome: RecordedPipelineOutcome;
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
          input.liveOutcome.validation.ok ? undefined : "validation_failed",
          input.liveOutcome.validation.ok
            ? undefined
            : candidateValidationDiagnosticVersion(input.liveOutcome.validation.code)
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

  private async failAttempt(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    applier?: NonNullable<Parameters<RecordedAiTurnService["execute"]>[0]["noReplyApplier"]>
  ): Promise<void> {
    if (applier?.failAttempt) {
      return applier.failAttempt({ run, completion });
    }
    return this.options.repository.failAttempt({ run, completion });
  }

  private async fenceAttempt(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion,
    applier?: NonNullable<Parameters<RecordedAiTurnService["execute"]>[0]["noReplyApplier"]>
  ): Promise<void> {
    if (applier?.fenceAttempt) {
      return applier.fenceAttempt({ run, completion });
    }
    return this.options.repository.fenceAttempt({ run, completion });
  }

  private span(
    kind: AiRunSpanWrite["kind"],
    name: AiRunSpanWrite["name"],
    status: AiRunSpanWrite["status"],
    latencyMs: number,
    errorCode?: AiRunSpanErrorCode,
    toolVersion?: string
  ): AiRunSpanWrite {
    return {
      spanId: this.idGenerator(),
      kind,
      name,
      status,
      latencyMs,
      ...(errorCode ? { errorCode } : {}),
      ...(toolVersion ? { toolVersion } : {})
    };
  }
}

function candidateValidationDiagnosticVersion(
  code: LiveV2ValidationFailureCode | ModelTurnValidationIssue
): string {
  return `candidate_validator.${code}.v1`;
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
    ...(observation.observedModelName ? { observedModelName: observation.observedModelName } : {}),
    ...(observation.runtimeRunId ? { runtimeRunId: observation.runtimeRunId } : {}),
    ...(usage && Object.keys(usage).length > 0 ? { usage } : {})
  };
}

function allowedReplyState(action: Exclude<LiveV2Candidate["action"], "no_reply">): TerminalState {
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

function terminalStateFor(outcome: RecordedPipelineOutcome): TerminalState {
  const decision = validatedDecision(outcome);
  const normalizedAction = decision?.action ?? "no_reply";

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
      validatorResult: outcome.validation?.ok ? "passed" : "rejected",
      sendGateResult: "not_checked",
      qualityEvents: [event("runtime_failure", "recorder_failed", "critical")]
    };
  }

  if (decision?.action === "no_reply") {
    const reason = decision.reason as "no_safe_answer" | "missing_approved_fact";

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

function decisionMetadata(decision: RecordedReplyDecision, plan?: ValidatedTurnPlan) {
  return {
    normalized_action: decision.action,
    ...(plan
      ? {
          turn_contract: "granit_model_turn.v1",
          final_text_hash: plan.finalTextHash,
          applied_patch_count: plan.appliedPatches.length,
          dropped_patch_count: plan.droppedPatches.length,
          dropped_recommendation_count: plan.droppedRecommendationIds.length,
          validation_results: plan.validationResults
        }
      : {}),
    ...(decision.action === "handoff_to_manager"
      ? {
          handoff_reason: plan?.handoffAction?.reason ?? "manager_requested"
        }
      : {})
  };
}

function persistedOutcome(
  decision: RecordedReplyDecision,
  result: RecordedAiPersistReplyResult
): RecordedAiTurnOutcome {
  if (result.status === "blocked") {
    return {
      decision: { action: decision.action, reason: decision.reason },
      result: {
        status: "blocked",
        reason: result.reason,
        evidence: {
          decision_profile: "live_v2",
          normalized_action: decision.action
        }
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
            evidence: {
              decision_profile: "live_v2",
              normalized_action: decision.action
            }
          }
        : {
            status: "persisted",
            publicMessageId: result.publicMessageId,
            evidence: {
              decision_profile: "live_v2",
              normalized_action: decision.action
            }
          },
    persistedReply
  };
}

function terminalOutcome(
  outcome: RecordedPipelineOutcome,
  run: TerminalAiRunRecord
): RecordedAiTurnOutcome {
  const decision = validatedDecision(outcome);
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
            evidence: {
              decision_profile: "live_v2",
              normalized_action: action
            }
          }
        : {
            status: "fallback_unavailable",
            reason: run.outcomeReason,
            evidence: {
              decision_profile: "live_v2",
              normalized_action: action
            }
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

function validatedDecision(
  outcome: RecordedPipelineOutcome
): RecordedReplyDecision | { action: "no_reply"; reason: string } | undefined {
  if (!outcome.validation?.ok) return undefined;

  if ("decision" in outcome.validation) {
    return {
      action: outcome.validation.decision.action,
      reason: outcome.validation.decision.reason
    };
  }

  return {
    action: outcome.validation.plan.action,
    reason: outcome.validation.plan.reason
  };
}

function replyDecision(
  plan: Extract<RecordedPipelineOutcome["plan"], { kind: "persist_reply" }>
): RecordedReplyDecision {
  if ("validatedPlan" in plan) {
    return { action: plan.action, reason: plan.validatedPlan.reason };
  }

  return { action: plan.action, reason: plan.decision.reason };
}

function modelTurnPlan(
  plan: Extract<RecordedPipelineOutcome["plan"], { kind: "persist_reply" }>
): ValidatedTurnPlan | undefined {
  return "validatedPlan" in plan ? plan.validatedPlan : undefined;
}

function splitAppliedPatches(patches: ValidatedTurnPlan["appliedPatches"]): {
  slotUpdates: AiSlotUpdate[];
  requirementUpdates: AiRequirementUpdate[];
} {
  const slotUpdates: AiSlotUpdate[] = [];
  const requirementUpdates: AiRequirementUpdate[] = [];

  for (const patch of patches) {
    if ("name" in patch) slotUpdates.push(patch);
    else requirementUpdates.push(patch);
  }

  return { slotUpdates, requirementUpdates };
}

function buildRecordedHandoff(
  turnInput: AiTurnInput,
  plan: ValidatedTurnPlan,
  patches: { slotUpdates: AiSlotUpdate[]; requirementUpdates: AiRequirementUpdate[] } | undefined
): RecordedAiPersistReplyInput["handoff"] {
  if (!plan.handoffAction) return undefined;

  const slotsSnapshot: Record<string, unknown> = {};
  for (const [name, slot] of Object.entries(turnInput.knownSlots.values)) {
    if (slot) slotsSnapshot[name] = slot.value;
  }
  for (const slot of patches?.slotUpdates ?? []) {
    slotsSnapshot[slot.name] = slot.value;
  }

  const requirements = [...turnInput.knownRequirements, ...(patches?.requirementUpdates ?? [])].map(
    (requirement) => ({
      category: requirement.category,
      mode: requirement.mode,
      value: requirement.value
    })
  );
  if (requirements.length > 0) slotsSnapshot.requirements = requirements;

  const summaryUpdate = patches?.slotUpdates.find((slot) => slot.name === "questionSummary");
  const summary = (summaryUpdate?.value ?? turnInput.inboundMessage.text).trim().slice(0, 900);

  return {
    reason: plan.handoffAction.reason,
    summary,
    slotsSnapshot
  };
}

function assertCommittedText(
  plan: ValidatedTurnPlan | undefined,
  result: RecordedAiPersistReplyResult
): void {
  if (!plan || result.status !== "persisted") return;

  if (result.body !== plan.finalText) {
    throw new RecordedLiveV2ExecutionError();
  }
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
