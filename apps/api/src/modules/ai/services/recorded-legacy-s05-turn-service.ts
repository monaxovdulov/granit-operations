import { randomUUID } from "node:crypto";

import type { AiTurnExecutionContext, AiTurnInput } from "../ai-turn.js";
import {
  executeLegacyS05Turn,
  legacyS05ExecutionContextMatchesTurnInput,
  type LegacyS05DecisionGenerator,
  type LegacyS05PersistReplyInput
} from "../profiles/legacy-s05/legacy-s05-orchestrator.js";
import type {
  RecordedLegacyS05PersistReplyResult,
  RecordedLegacyS05ReplyApplier,
  RecordedLegacyS05TurnResult
} from "../ports/recorded-legacy-s05-turn.js";
import type {
  AiRunModelConfig,
  BeginAiRunResult,
  AiRunRepository,
  AiRunSpanWrite,
  AiRunTerminalCompletion,
  AiRunVersions,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../repositories/ai-run-repository.js";
import {
  legacyS05AgentReplyBlockedState,
  legacyS05AllowedReplyState,
  legacyS05ExecutionFailedState,
  legacyS05GeneratorSpanDescriptor,
  legacyS05NoReplyGeneratorSpan,
  legacyS05NoReplyState,
  legacyS05PersistenceUnconfirmedState,
  legacyS05ValidationSpanError,
  type LegacyS05TerminalState
} from "./legacy-s05-observability.js";
import {
  readTrustedWidgetAiProviderObservation,
  type TrustedWidgetAiProviderObservation
} from "./widget-ai-service.js";

export type RecordedLegacyS05TurnServiceOptions = {
  repository: AiRunRepository;
  versions: AiRunVersions;
  model: AiRunModelConfig;
  clock?: () => Date;
  idGenerator?: () => string;
};

export class AiRunRecorderUnavailableError extends Error {
  constructor() {
    super("AI run recorder is unavailable");
    this.name = "AiRunRecorderUnavailableError";
  }
}

export class RecordedLegacyS05ExecutionError extends Error {
  constructor() {
    super("Recorded legacy_s05 execution failed");
    this.name = "RecordedLegacyS05ExecutionError";
  }
}

export class RecordedLegacyS05TurnService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;

  constructor(private readonly options: RecordedLegacyS05TurnServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async execute(input: {
    executionContext: AiTurnExecutionContext;
    turnInput: AiTurnInput;
    generator: LegacyS05DecisionGenerator;
    replyApplier: RecordedLegacyS05ReplyApplier;
  }): Promise<RecordedLegacyS05TurnResult> {
    const inputFingerprint = input.executionContext.turn.inputFingerprint;

    if (!inputFingerprint) {
      throw new AiRunRecorderUnavailableError();
    }

    const startedAt = this.clock();
    const executionContextMismatch = !legacyS05ExecutionContextMatchesTurnInput(
      input.executionContext,
      input.turnInput
    );
    let beginResult: BeginAiRunResult;

    try {
      beginResult = await this.options.repository.beginOrReplay({
        traceId: this.idGenerator(),
        leadId: input.executionContext.internal.leadId,
        conversationId: input.executionContext.internal.conversationId,
        inboundMessageId: input.executionContext.internal.inboundMessageId,
        channel: input.executionContext.channel,
        runtimeMode: "direct_openai",
        decisionProfile: "legacy_s05",
        idempotencyKey: input.executionContext.turn.idempotencyKey,
        inputFingerprint,
        versions: this.options.versions,
        model: this.options.model,
        startedAt
      });
    } catch {
      throw new AiRunRecorderUnavailableError();
    }

    if (beginResult.kind === "terminal_replay") {
      return { kind: "terminal_replay", run: beginResult.run };
    }

    if (beginResult.kind === "running_replay") {
      return { kind: "running_replay", run: beginResult.run };
    }

    const run = beginResult.run;
    const spans: AiRunSpanWrite[] = [];
    let generatorStartedAt: Date | undefined;
    let generatorCompletedAt: Date | undefined;
    let replyApplyStartedAt: Date | undefined;
    let atomicCompletion: TerminalAiRunRecord | undefined;
    let providerObservation: TrustedWidgetAiProviderObservation = {
      observedModelProvider: "none"
    };
    let replyInProgress:
      | {
          action: LegacyS05PersistReplyInput["action"];
          providerObservation: TrustedWidgetAiProviderObservation;
        }
      | undefined;

    try {
      const outcome = await executeLegacyS05Turn({
        executionContext: input.executionContext,
        turnInput: input.turnInput,
        generator: {
          generateReply: async (turnInput) => {
            generatorStartedAt = this.clock();

            try {
              const candidate = await input.generator.generateReply(turnInput);
              providerObservation = readTrustedWidgetAiProviderObservation(candidate) ?? {
                observedModelProvider: "none"
              };
              generatorCompletedAt = this.clock();
              return candidate;
            } catch {
              generatorCompletedAt = this.clock();
              spans.push(
                this.span(
                  "runtime",
                  "decision_generation",
                  "failed",
                  elapsedMs(generatorStartedAt, generatorCompletedAt),
                  "runtime_failed"
                )
              );
              throw new RecordedLegacyS05ExecutionError();
            }
          }
        },
        applier: {
          persistReply: async (reply) => {
            const beforeApply = this.clock();
            replyApplyStartedAt = beforeApply;
            const descriptor = legacyS05GeneratorSpanDescriptor(
              providerObservation.observedModelProvider
            );
            const generatorSpan = this.span(
              descriptor.kind,
              descriptor.name,
              "succeeded",
              elapsedMs(generatorStartedAt ?? startedAt, generatorCompletedAt ?? beforeApply)
            );
            const validationLatency = elapsedMs(generatorCompletedAt ?? startedAt, beforeApply);
            const validationSpan = this.span(
              "validation",
              "candidate_validation",
              "succeeded",
              validationLatency
            );
            const action = reply.action;
            spans.push(
              generatorSpan,
              validationSpan,
              this.span(
                "runtime",
                "runtime_execution",
                "succeeded",
                elapsedMs(startedAt, beforeApply)
              )
            );
            const baseSpans = [...spans];
            const usage = providerObservation.usage;
            replyInProgress = { action, providerObservation };

            const result = await input.replyApplier.persistReplyAndCompleteRun({
              run,
              reply,
              completionPlan: {
                allowed: this.completion(
                  run,
                  legacyS05AllowedReplyState(
                    action,
                    providerObservation.observedModelProvider
                  ),
                  baseSpans,
                  usage,
                  providerObservation,
                  true
                ),
                agentReplyBlocked: this.completion(
                  run,
                  legacyS05AgentReplyBlockedState(
                    action,
                    providerObservation.observedModelProvider
                  ),
                  baseSpans,
                  usage,
                  providerObservation,
                  true
                ),
                persistenceUnconfirmed: this.completion(
                  run,
                  legacyS05PersistenceUnconfirmedState(
                    action,
                    providerObservation.observedModelProvider
                  ),
                  baseSpans,
                  usage,
                  providerObservation,
                  false
                )
              }
            });

            atomicCompletion = result.completedRun;
            assertAtomicCompletion(action, result);
            return result;
          }
        }
      });

      if (atomicCompletion) {
        return { kind: "executed", run: atomicCompletion, outcome };
      }

      const now = this.clock();
      if (
        outcome.decision.action === "no_reply" &&
        generatorStartedAt &&
        generatorCompletedAt &&
        spans.length === 0
      ) {
        const observation = legacyS05NoReplyGeneratorSpan(
          outcome.decision,
          providerObservation.observedModelProvider
        );
        spans.push(
          this.span(
            observation.kind,
            observation.name,
            observation.status,
            elapsedMs(generatorStartedAt, generatorCompletedAt),
            observation.errorCode
          )
        );
      }

      if (outcome.decision.action !== "no_reply") {
        throw new RecordedLegacyS05ExecutionError();
      }

      const terminalState = legacyS05NoReplyState(outcome.decision, {
        observedProvider: providerObservation.observedModelProvider,
        executionContextMismatch
      });
      spans.push(
        this.span(
          "validation",
          "candidate_validation",
          terminalState.validatorResult === "not_run"
            ? "skipped"
            : terminalState.validatorResult === "rejected" ||
                terminalState.validatorResult === "failed"
              ? "failed"
              : "succeeded",
          elapsedMs(generatorCompletedAt ?? startedAt, now),
          legacyS05ValidationSpanError(terminalState)
        )
      );
      spans.push(
        this.span(
          "runtime",
          "runtime_execution",
          "succeeded",
          elapsedMs(startedAt, now)
        )
      );

      const completed = await this.completeWithoutReply(
        run,
        this.completion(
          run,
          terminalState,
          spans,
          providerObservation.usage,
          providerObservation,
          false
        )
      );
      return { kind: "executed", run: completed, outcome };
    } catch (error) {
      if (error instanceof AiRunRecorderUnavailableError) {
        throw error;
      }

      if (atomicCompletion) {
        throw new RecordedLegacyS05ExecutionError();
      }

      const failedState = replyInProgress
        ? legacyS05PersistenceUnconfirmedState(
            replyInProgress.action,
            replyInProgress.providerObservation.observedModelProvider
          )
        : legacyS05ExecutionFailedState();
      const failedAt = this.clock();
      const failedSpans = [...spans];
      if (replyInProgress) {
        failedSpans.push(
          this.span(
            "runtime",
            "reply_persistence",
            "failed",
            elapsedMs(replyApplyStartedAt ?? startedAt, failedAt),
            "persistence_failed"
          )
        );
      }
      failedSpans.push(
        this.span(
          "runtime",
          "turn_execution",
          "failed",
          elapsedMs(startedAt, failedAt),
          "runtime_failed"
        )
      );

      await this.completeWithoutReply(
        run,
        this.completion(
          run,
          failedState,
          failedSpans,
          replyInProgress?.providerObservation.usage,
          replyInProgress?.providerObservation ?? { observedModelProvider: "none" },
          false
        )
      );
      throw new RecordedLegacyS05ExecutionError();
    }
  }

  private async completeWithoutReply(
    run: RunningAiRunRecord,
    completion: AiRunTerminalCompletion
  ): Promise<TerminalAiRunRecord> {
    try {
      return await this.options.repository.completeWithoutReply({ run, completion });
    } catch {
      throw new AiRunRecorderUnavailableError();
    }
  }

  private completion(
    run: RunningAiRunRecord,
    state: LegacyS05TerminalState,
    spans: AiRunSpanWrite[],
    usage: AiRunTerminalCompletion["usage"],
    observation: TrustedWidgetAiProviderObservation,
    sendGateChecked: boolean
  ): AiRunTerminalCompletion {
    const completedAt = this.clock();
    if (state.observedModelProvider !== observation.observedModelProvider) {
      throw new RecordedLegacyS05ExecutionError();
    }

    return {
      ...state,
      ...(observation.observedModelName
        ? { observedModelName: observation.observedModelName }
        : {}),
      ...(usage ? { usage } : {}),
      ...(sendGateChecked ? { sendGateCheckedAt: completedAt } : {}),
      completedAt,
      latencyMs: elapsedMs(run.startedAt, completedAt),
      spans: [...spans],
      qualityEvents: [...state.qualityEvents]
    };
  }

  private span(
    kind: AiRunSpanWrite["kind"],
    name: AiRunSpanWrite["name"],
    status: AiRunSpanWrite["status"],
    latencyMs: number,
    errorCode?: AiRunSpanWrite["errorCode"]
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

function assertAtomicCompletion(
  action: LegacyS05PersistReplyInput["action"],
  result: RecordedLegacyS05PersistReplyResult
): void {
  if (result.status === "persisted") {
    const expectedStatus = action === "handoff_to_manager" ? "handed_off" : "persisted";
    if (result.completedRun.status !== expectedStatus) {
      throw new RecordedLegacyS05ExecutionError();
    }
    return;
  }

  const expectedStatus =
    result.reason === "agent_reply_blocked" ? "blocked" : "failed";
  if (result.completedRun.status !== expectedStatus) {
    throw new RecordedLegacyS05ExecutionError();
  }
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime());
}
