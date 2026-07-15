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
    return this.turnService.execute({
      executionContext: input.executionContext,
      turnInput: input.turnInput,
      replyApplier: {
        persistReplyAndCompleteRun: async ({ run, reply, completionPlan }) => {
          const publicMessageId = this.idGenerator();
          const metadata = recordedReplyMetadata({
            run,
            action: reply.action,
            candidateMetadata: reply.metadata,
            completion: completionPlan.allowed,
            publicSessionId: input.outbound.publicSessionId,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            aiInputFingerprint: input.outbound.aiInputFingerprint
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
              body: reply.replyDraft,
              metadata
            })
          );

          return this.replyRepository.persistRecordedSiteWidgetAiReply({
            run,
            reply: persistedReply,
            completionPlan,
            publicMessageId,
            inboundPublicMessageId: input.outbound.inboundPublicMessageId,
            idempotencyKey: `ai:${input.outbound.inboundPublicMessageId}`,
            requestFingerprint,
            sourcePageUrl: input.outbound.sourcePageUrl,
            metadata
          });
        }
      }
    });
  }
}

const ALLOWED_HANDOFF_REASONS = new Set([
  "manager_requested",
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
}): Record<string, unknown> {
  const handoffReason = input.candidateMetadata.handoff_reason;
  const usage = input.completion.usage;

  return {
    decision_profile: input.run.decisionProfile,
    normalized_action: input.action,
    channel: "site_widget",
    public_session_id: input.publicSessionId,
    inbound_public_message_id: input.inboundPublicMessageId,
    ai_input_fingerprint: input.aiInputFingerprint,
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
    ...(usage?.inputTokens === undefined ? {} : { input_tokens: usage.inputTokens }),
    ...(usage?.outputTokens === undefined ? {} : { output_tokens: usage.outputTokens }),
    ...(usage?.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    ...(input.run.versions.assetVersion ? { asset_version: input.run.versions.assetVersion } : {}),
    ...(input.run.versions.toneVersion ? { tone_version: input.run.versions.toneVersion } : {}),
    ...(input.run.versions.factsVersion ? { facts_version: input.run.versions.factsVersion } : {})
  };
}
