import { randomUUID } from "node:crypto";

import { sha256Hex, stableStringify } from "@granit/shared";

import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord
} from "../repositories/ai-run-repository.js";
import type { RecordedAiTurnService } from "../ports/recorded-ai-turn.js";
import type { RecordedSiteWidgetAiReplyRepository } from "../repositories/recorded-site-widget-ai-reply-repository.js";
import type {
  PublicWidgetAiTurnExecutionInput,
  PublicWidgetAiTurnExecutor
} from "../../intake/ports/public-widget-ai-turn-executor.js";

export class RecordedPublicWidgetAiTurnExecutor implements PublicWidgetAiTurnExecutor {
  constructor(
    private readonly turnService: RecordedAiTurnService,
    private readonly replyRepository: RecordedSiteWidgetAiReplyRepository,
    private readonly idGenerator: () => string = randomUUID
  ) {}

  execute(input: PublicWidgetAiTurnExecutionInput) {
    const attemptIdempotencyKey = input.outbound.jobCommit
      ? `${input.executionContext.turn.idempotencyKey}:attempt:${input.outbound.jobCommit.attemptCount}`
      : `${input.executionContext.turn.idempotencyKey}:attempt:1`;

    return this.turnService.execute({
      executionContext: input.executionContext,
      turnInput: input.turnInput,
      signal: input.signal,
      attempt: {
        attemptNumber: input.outbound.jobCommit?.attemptCount ?? 1,
        idempotencyKey: attemptIdempotencyKey,
        ...(input.outbound.jobCommit?.jobId ? { jobId: input.outbound.jobCommit.jobId } : {}),
        jobAttemptCount: input.outbound.jobCommit?.attemptCount ?? 1,
        ...(input.outbound.jobCommit?.maxAttempts === undefined
          ? {}
          : { maxAttempts: input.outbound.jobCommit.maxAttempts })
      },
      replyApplier: {
        persistReplyAndCompleteRun: async ({ run, reply, completionPlan }) => {
          if (reply.finalTextHash && sha256Hex(reply.replyDraft) !== reply.finalTextHash) {
            throw new Error("validated final text hash mismatch before commit");
          }

          const publicMessageId = this.idGenerator();
          const metadata = recordedReplyMetadata({
            run,
            action: reply.action,
            candidateMetadata: reply.metadata,
            completion: completionPlan.allowed,
            publicSessionId: input.outbound.publicSessionId,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            aiInputFingerprint: input.outbound.aiInputFingerprint,
            queueWaitMs: input.outbound.queueWaitMs,
            expectedGenerationEpoch: input.outbound.expectedGenerationEpoch,
            respondsThroughSequence: input.outbound.respondsThroughSequence
          });
          const persistedReply = {
            ...reply,
            metadata
          };
          const requestFingerprint = sha256Hex(
            stableStringify({
              outbound_kind: "site_widget_ai_reply",
              inbound_public_message_id: input.outbound.inboundPublicMessageId,
              public_conversation_id: input.turnInput.conversation.publicConversationId,
              expected_generation_epoch: input.outbound.expectedGenerationEpoch,
              responds_through_sequence: input.outbound.respondsThroughSequence,
              runtime_mode: input.outbound.runtimeMode,
              body: reply.replyDraft,
              slot_updates: reply.slotUpdates ?? [],
              requirement_updates: reply.requirementUpdates ?? [],
              handoff: reply.handoff ?? null,
              metadata
            })
          );

          return this.replyRepository.persistRecordedSiteWidgetAiReply({
            run,
            reply: persistedReply,
            completionPlan,
            publicMessageId,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            idempotencyKey:
              input.outbound.idempotencyKey ?? `ai:${input.outbound.inboundPublicMessageId}`,
            requestFingerprint,
            sourcePageUrl: input.outbound.sourcePageUrl,
            metadata,
            expectedGenerationEpoch: input.outbound.expectedGenerationEpoch,
            respondsThroughSequence: input.outbound.respondsThroughSequence,
            runtimeMode: input.outbound.runtimeMode,
            jobCommit: input.outbound.jobCommit
          });
        }
      },
      noReplyApplier: {
        completeWithoutReply: ({ run, completion }) =>
          this.replyRepository.completeRecordedSiteWidgetAiNoReply({
            run,
            completion,
            publicConversationId: input.turnInput.conversation.publicConversationId,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            expectedGenerationEpoch: input.outbound.expectedGenerationEpoch,
            respondsThroughSequence: input.outbound.respondsThroughSequence,
            runtimeMode: input.outbound.runtimeMode,
            jobCommit: input.outbound.jobCommit
          }),
        failAttempt: ({ run, completion }) =>
          this.replyRepository.failRecordedSiteWidgetAiAttempt({
            run,
            completion,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            expectedGenerationEpoch: input.outbound.expectedGenerationEpoch,
            respondsThroughSequence: input.outbound.respondsThroughSequence,
            runtimeMode: input.outbound.runtimeMode,
            jobCommit: input.outbound.jobCommit
          }),
        fenceAttempt: ({ run, completion }) =>
          this.replyRepository.fenceRecordedSiteWidgetAiAttempt({
            run,
            completion
          })
      }
    });
  }
}

const ALLOWED_HANDOFF_REASONS = new Set([
  "manager_requested",
  "final_quote_pressure",
  "lead_ready",
  "out_of_scope_legal_funeral_inheritance",
  "price_requires_approved_source",
  "deadline_requires_manager_confirmation",
  "binding_terms_require_manager_confirmation"
]);

function recordedReplyMetadata(input: {
  run: RunningAiRunRecord;
  action: "answer" | "ask_clarifying_question" | "handoff_to_manager";
  candidateMetadata: Record<string, unknown>;
  completion: AiRunTerminalCompletion;
  publicSessionId: string;
  inboundPublicMessageId: string;
  aiInputFingerprint: string;
  queueWaitMs?: number;
  expectedGenerationEpoch?: number;
  respondsThroughSequence?: number;
}): Record<string, unknown> {
  const handoffReason = input.candidateMetadata.handoff_reason;
  const turnContract = input.candidateMetadata.turn_contract;
  const finalTextHash = input.candidateMetadata.final_text_hash;
  const appliedPatchCount = input.candidateMetadata.applied_patch_count;
  const droppedPatchCount = input.candidateMetadata.dropped_patch_count;
  const droppedRecommendationCount = input.candidateMetadata.dropped_recommendation_count;
  const catalogSchemaVersion = input.candidateMetadata.catalog_schema_version;
  const catalogVersion = input.candidateMetadata.catalog_version;
  const catalogContentHash = input.candidateMetadata.catalog_content_hash;
  const catalogReferences = input.candidateMetadata.catalog_references;
  const usage = input.completion.usage;

  return {
    decision_profile: input.run.decisionProfile,
    normalized_action: input.action,
    channel: "site_widget",
    public_session_id: input.publicSessionId,
    inbound_public_message_id: input.inboundPublicMessageId,
    ai_input_fingerprint: input.aiInputFingerprint,
    ...(input.queueWaitMs === undefined ? {} : { queue_wait_ms: input.queueWaitMs }),
    ...(input.expectedGenerationEpoch === undefined
      ? {}
      : { response_window_epoch: input.expectedGenerationEpoch }),
    ...(input.respondsThroughSequence === undefined
      ? {}
      : { responds_through_sequence: input.respondsThroughSequence }),
    policy_version: input.run.versions.policyVersion,
    prompt_version: input.run.versions.promptVersion,
    tool_version: input.run.versions.toolVersion,
    ai_disclosure_shown: true,
    ai_disclosure_version: input.run.versions.disclosureVersion,
    price_list_version: null,
    model_provider: input.completion.observedModelProvider,
    ...(input.completion.observedModelName
      ? { model_name: input.completion.observedModelName }
      : {}),
    fallback_mode:
      input.completion.observedModelProvider === "policy" ? "manager_required" : "none",
    ...(typeof handoffReason === "string" && ALLOWED_HANDOFF_REASONS.has(handoffReason)
      ? { handoff_reason: handoffReason }
      : {}),
    ...(turnContract === "granit_model_turn.v1" ? { turn_contract: turnContract } : {}),
    ...(typeof finalTextHash === "string" && /^[a-f0-9]{64}$/.test(finalTextHash)
      ? { final_text_hash: finalTextHash }
      : {}),
    ...(isNonNegativeInteger(appliedPatchCount) ? { applied_patch_count: appliedPatchCount } : {}),
    ...(isNonNegativeInteger(droppedPatchCount) ? { dropped_patch_count: droppedPatchCount } : {}),
    ...(isNonNegativeInteger(droppedRecommendationCount)
      ? { dropped_recommendation_count: droppedRecommendationCount }
      : {}),
    ...(catalogSchemaVersion === "catalog-index.v1"
      ? { catalog_schema_version: catalogSchemaVersion }
      : {}),
    ...(typeof catalogVersion === "string" ? { catalog_version: catalogVersion } : {}),
    ...(typeof catalogContentHash === "string"
      ? { catalog_content_hash: catalogContentHash }
      : {}),
    ...(Array.isArray(catalogReferences)
      ? { catalog_references: catalogReferences }
      : {}),
    ...(usage?.inputTokens === undefined ? {} : { input_tokens: usage.inputTokens }),
    ...(usage?.outputTokens === undefined ? {} : { output_tokens: usage.outputTokens }),
    ...(usage?.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    ...(input.run.versions.assetVersion ? { asset_version: input.run.versions.assetVersion } : {}),
    ...(input.run.versions.toneVersion ? { tone_version: input.run.versions.toneVersion } : {}),
    ...(input.run.versions.factsVersion ? { facts_version: input.run.versions.factsVersion } : {})
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}
