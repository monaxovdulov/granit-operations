import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQLWrapper
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  aiQualityEvents,
  aiReviewLabels,
  aiRuntimeControls,
  aiRuns,
  channelIdentities,
  conversationAiMemory,
  conversationHandoffs,
  conversationMessages,
  conversationRequirements,
  conversationSlotEvents,
  conversationSlots,
  conversations,
  intakeSubmissions,
  leadTimelineEvents,
  leads,
  managerTelegramBindings,
  managerNotificationOutbox,
  managerUsers,
  messageDeliveries,
  widgetAiJobs,
  widgetSessions,
  type OperationsDb
} from "@granit/db";
import {
  SITE_WIDGET_V2_CONTRACT_VERSION,
  type SiteFormIntakeRequest,
  type SiteWidgetMessageRequest
} from "@granit/contracts";

import {
  buildSiteWidgetAiTurnExecutionContext,
  buildStageASiteWidgetAiTurnInput,
  type AiTurnInput,
  type WidgetCatalogReference
} from "../../ai/ai-turn.js";
import {
  AI_REQUIREMENT_CATEGORIES,
  AI_REQUIREMENT_MODES,
  AI_SLOT_NAMES,
  type AiKnownSlots,
  type AiSlotName
} from "../../ai/ai-dialog-contract.js";
import { sanitizeAiObservabilityMetadata } from "../../ai/observability/ai-observability-sanitizer.js";
import {
  completeAiRunInTransaction,
  failAiRunAttemptInTransaction,
  fenceAiRunAttemptInTransaction,
  finalizeExhaustedAiRunForJobInTransaction,
  finalizeSupersededAiRunForJobInTransaction
} from "../../ai/repositories/postgres-ai-run-repository.js";
import type {
  AiRunSpanWrite,
  AiRunTerminalCompletion,
  RunningAiRunRecord,
  TerminalAiRunRecord
} from "../../ai/repositories/ai-run-repository.js";
import type {
  CompleteRecordedSiteWidgetAiNoReplyInput,
  FailRecordedSiteWidgetAiAttemptInput,
  PersistRecordedSiteWidgetAiReplyInput
} from "../../ai/repositories/recorded-site-widget-ai-reply-repository.js";
import {
  aiMessageSentTimelineEvent,
  conversationMessageReceivedTimelineEvent,
  inboundLeadCreatedTimelineEvent,
  leadStatusChangedTimelineEvent,
  managerNotificationEnqueuedTimelineEvent,
  managerTakeoverTimelineEvent,
  manualContactRecordedTimelineEvent,
  nextStepUpdatedTimelineEvent,
  siteFormLeadCreatedTimelineEvent
} from "../../timeline/timeline-events.js";
import {
  AgentReplyBlockedError,
  IdempotencyConflictError,
  TelegramIdentityRequiredError,
  TelegramOutboundBlockedError,
  isAiState,
  isLeadStatus,
  type AiState,
  type ConversationContentType,
  type CustomerChannel,
  type LeadStatus,
  type MessageDeliveryStatus,
  type NeedsManagerReason,
  type NextStepChannel
} from "./lead-conversation-types.js";
import type {
  AcceptInboundMessageInput,
  AcceptInboundMessageResult,
  PersistAiReplyWithSendGateInput,
  SaveSiteWidgetAiMessageInput,
  SaveSiteWidgetAiMessageResult,
  SiteWidgetAiMessageLookupResult,
  SiteWidgetStoredAiReply
} from "./conversation-message-repository.js";
import { buildWidgetAiTurnIdempotencyKey } from "./conversation-message-repository.js";
import type { IntakeRepository } from "./intake-repository.js";
import { AI_REVIEW_LABELS } from "./manager-lead-repository.js";
import { AiControlVersionConflictError } from "./manager-lead-repository.js";
import type {
  AiReviewLabel,
  ChangeManagerLeadStatusInput,
  ManagerAiControl,
  ManagerAiQualitySummary,
  ManagerChannelIdentity,
  ManagerConversation,
  ManagerLeadDetail,
  ManagerLeadListItem,
  ManagerStructuredIntake,
  RecordManualContactInput,
  RecordAiReviewLabelInput,
  SetConversationAiControlInput,
  SetManagerAiControlInput,
  SetNextStepInput,
  TakeoverConversationByPublicIdInput,
  TakeoverConversationInput,
  TakeoverSiteWidgetConversationInput
} from "./manager-lead-repository.js";

import type {
  BindManagerTelegramChatInput,
  BindManagerTelegramChatResult,
  ClearManagerTelegramReplyContextInput,
  CreateManagerTelegramBindTokenInput,
  CreateManagerTelegramBindTokenResult,
  CreateManagerTelegramReplyContextInput,
  CreateManagerTelegramReplyContextResult,
  FindManagerTelegramActorInput,
  ManagerTelegramActor,
  ManagerTelegramBindingStatus,
  PersistManagerTelegramReplyInput,
  PersistManagerTelegramReplyResult
} from "./manager-telegram-repository.js";
import { PostgresManagerTelegramRepository } from "./postgres-manager-telegram-repository.js";
import type {
  SaveAcceptedSiteFormSubmissionInput,
  SaveAcceptedSiteFormSubmissionResult,
  SaveAcceptedSiteWidgetMessageInput,
  SaveAcceptedSiteWidgetMessageResult,
  RecordSiteWidgetAiDegradationInput,
  SiteWidgetHistoryResult,
  ClaimedSiteWidgetAiJob,
  FinishSiteWidgetAiJobInput,
  SiteWidgetAiJobStatus,
  SiteWidgetAiJobSummary
} from "./public-intake-repository.js";

const WIDGET_AI_MIN_DEBOUNCE_MS = 600;

export class PostgresIntakeRepository implements IntakeRepository {
  private readonly managerTelegramRepository: PostgresManagerTelegramRepository;

  constructor(private readonly db: OperationsDb) {
    this.managerTelegramRepository = new PostgresManagerTelegramRepository(db);
  }

  async saveAcceptedSiteFormSubmission(
    input: SaveAcceptedSiteFormSubmissionInput
  ): Promise<SaveAcceptedSiteFormSubmissionResult> {
    const existing = await this.findExistingByIdempotencyKey(input.request.idempotency_key);

    if (existing) {
      return this.replayExisting(existing, input.requestFingerprint);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [lead] = await tx
          .insert(leads)
          .values(toLeadInsert(input.request))
          .returning({ id: leads.id });

        if (!lead) {
          throw new Error("lead insert returned no row");
        }

        const [submission] = await tx
          .insert(intakeSubmissions)
          .values({
            publicSubmissionId: input.publicSubmissionId,
            schemaVersion: input.request.schema_version,
            eventType: input.request.event_type,
            idempotencyKey: input.request.idempotency_key,
            requestFingerprint: input.requestFingerprint,
            leadId: lead.id,
            sourceChannel: input.request.source.channel,
            sourcePageUrl: input.request.source.page_url,
            sourceFormKind: input.request.source.form_kind,
            requestPayload: input.request
          })
          .returning({
            leadId: intakeSubmissions.leadId,
            publicSubmissionId: intakeSubmissions.publicSubmissionId
          });

        if (!submission) {
          throw new Error("intake submission insert returned no row");
        }

        await tx.insert(leadTimelineEvents).values(
          siteFormLeadCreatedTimelineEvent({
            leadId: lead.id,
            publicSubmissionId: submission.publicSubmissionId,
            sourcePageUrl: input.request.source.page_url,
            sourceFormKind: input.request.source.form_kind
          })
        );

        return {
          leadId: submission.leadId,
          publicSubmissionId: submission.publicSubmissionId,
          replayed: false
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findExistingByIdempotencyKey(input.request.idempotency_key);

        if (replay) {
          return this.replayExisting(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  async acceptInboundMessage(
    input: AcceptInboundMessageInput
  ): Promise<AcceptInboundMessageResult> {
    if (input.serverTimestamped) {
      input = {
        ...input,
        message: {
          ...input.message,
          submittedAt: new Date().toISOString()
        }
      };
    }

    const existing = await this.findExistingInboundMessageByIdempotencyKey(input.idempotencyKey);

    if (existing) {
      return this.replayExistingInboundMessage(existing, input.requestFingerprint);
    }

    if (input.channel === "telegram" && (!input.providerAccountId || !input.externalChatId)) {
      throw new TelegramIdentityRequiredError();
    }

    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const contentType = normalizeContentType(input.message.contentType);
        const isMedia = contentType !== "text";
        const needsManagerReason =
          input.needsManagerReason ?? (isMedia ? "telegram_media" : undefined);
        const needsManager = Boolean(needsManagerReason);
        const widgetSession = await ensureWidgetSession(tx, input, now);
        let identity = await findOrCreateChannelIdentity(tx, input, widgetSession?.id ?? null, now);

        let [conversation] = await tx
          .select({
            id: conversations.id,
            publicConversationId: conversations.publicConversationId,
            leadId: conversations.leadId,
            agentAllowedToReply: conversations.agentAllowedToReply,
            aiState: conversations.aiState
          })
          .from(conversations)
          .where(eq(conversations.channelIdentityId, identity.id))
          .limit(1)
          .for("update");

        if (!conversation) {
          const [lead] = await tx
            .insert(leads)
            .values(toInboundLeadInsert(input, now))
            .returning({ id: leads.id });

          if (!lead) {
            throw new Error("inbound lead insert returned no row");
          }

          const [updatedIdentity] = await tx
            .update(channelIdentities)
            .set({
              leadId: lead.id,
              updatedAt: now,
              lastSeenAt: now
            })
            .where(eq(channelIdentities.id, identity.id))
            .returning({ id: channelIdentities.id });

          if (!updatedIdentity) {
            throw new Error("channel identity update returned no row");
          }

          identity = { ...identity, leadId: lead.id };

          const [createdConversation] = await tx
            .insert(conversations)
            .values({
              leadId: lead.id,
              widgetSessionId: widgetSession?.id ?? null,
              channelIdentityId: identity.id,
              channel: input.channel,
              status: "open",
              aiState: needsManager ? "needs_manager" : "ai_collecting_info",
              agentAllowedToReply: input.automationRequested && !needsManager,
              sourcePageUrl: input.sourcePageUrl ?? null,
              widgetInstanceId: input.widgetInstanceId ?? null,
              metadata: {
                ...input.metadata,
                automation_status:
                  input.automationRequested && !needsManager ? "enabled" : "disabled",
                needs_manager_reason: needsManagerReason ?? null
              },
              createdAt: now,
              updatedAt: now
            })
            .returning({
              id: conversations.id,
              publicConversationId: conversations.publicConversationId,
              leadId: conversations.leadId,
              agentAllowedToReply: conversations.agentAllowedToReply,
              aiState: conversations.aiState
            });

          if (!createdConversation) {
            throw new Error("conversation insert returned no row");
          }

          conversation = createdConversation;

          await tx.insert(leadTimelineEvents).values(
            inboundLeadCreatedTimelineEvent({
              leadId: lead.id,
              channel: input.channel,
              metadata: leadCreatedMetadata(input, identity.id),
              createdAt: now
            })
          );
        } else {
          const effectiveAgentAllowedToReply =
            input.automationRequested && !needsManager && conversation.agentAllowedToReply;
          const nextAiState = nextAiStateForInbound(conversation.aiState, needsManager);

          await tx
            .update(channelIdentities)
            .set({
              leadId: identity.leadId ?? conversation.leadId,
              displayName: input.displayName ?? input.contact?.name ?? identity.displayName,
              username: input.username ?? input.contact?.username ?? identity.username,
              metadata: {
                ...identity.metadata,
                ...channelIdentityMetadata(input)
              },
              updatedAt: now,
              lastSeenAt: now
            })
            .where(eq(channelIdentities.id, identity.id));

          await tx
            .update(leads)
            .set({
              requestText: input.message.text || input.message.caption || undefined,
              updatedAt: now
            })
            .where(eq(leads.id, conversation.leadId));

          await tx
            .update(conversations)
            .set({
              sourcePageUrl: input.sourcePageUrl ?? null,
              widgetInstanceId: input.widgetInstanceId ?? null,
              agentAllowedToReply: effectiveAgentAllowedToReply,
              aiState: nextAiState,
              metadata: {
                ...input.metadata,
                automation_status: effectiveAgentAllowedToReply ? "enabled" : "disabled",
                needs_manager_reason: needsManagerReason ?? null
              },
              updatedAt: now
            })
            .where(eq(conversations.id, conversation.id));

          conversation = {
            ...conversation,
            agentAllowedToReply: effectiveAgentAllowedToReply,
            aiState: nextAiState
          };
        }

        const providerReplay = await findExistingProviderInbound(tx, identity.id, input);

        if (providerReplay) {
          return this.replayExistingInboundMessage(providerReplay, input.requestFingerprint);
        }

        const [turnIdentity] = await tx
          .update(conversations)
          .set({
            lastMessageSequence: sql`${conversations.lastMessageSequence} + 1`,
            generationEpoch: sql`${conversations.generationEpoch} + 1`,
            updatedAt: now
          })
          .where(eq(conversations.id, conversation.id))
          .returning({
            expectedGenerationEpoch: conversations.generationEpoch,
            respondsThroughSequence: conversations.lastMessageSequence
          });

        if (!turnIdentity) {
          throw new Error("conversation turn identity update returned no row");
        }

        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: conversation.id,
            leadId: conversation.leadId,
            channelIdentityId: identity.id,
            providerMessageId: input.providerMessageId ?? null,
            providerUpdateId: input.providerUpdateId ?? null,
            providerSentAt: input.providerSentAt ? new Date(input.providerSentAt) : null,
            direction: "inbound",
            senderRole: "visitor",
            messageSequence: turnIdentity.respondsThroughSequence,
            body: messageBody(input, contentType),
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            sourcePageUrl: input.sourcePageUrl ?? null,
            contentType,
            providerFileId: input.message.providerFileId ?? null,
            providerFileUniqueId: input.message.providerFileUniqueId ?? null,
            mimeType: input.message.mimeType ?? null,
            fileSize: input.message.fileSize ?? null,
            durationSeconds: input.message.durationSeconds ?? null,
            caption: input.message.caption ?? null,
            metadata: {
              ...input.metadata,
              ...(input.message.metadata ?? {}),
              public_conversation_id: conversation.publicConversationId,
              channel_identity_id: identity.id,
              automation_status: conversation.agentAllowedToReply ? "enabled" : "disabled"
            },
            submittedAt: new Date(input.message.submittedAt),
            createdAt: now
          })
          .returning({
            id: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId,
            submittedAt: conversationMessages.submittedAt
          });

        if (!message) {
          throw new Error("inbound message insert returned no row");
        }

        await tx.insert(leadTimelineEvents).values(
          conversationMessageReceivedTimelineEvent({
            leadId: conversation.leadId,
            channel: input.channel,
            publicMessageId: message.publicMessageId,
            publicConversationId: conversation.publicConversationId,
            channelIdentityId: identity.id,
            contentType,
            automationStatus: conversation.agentAllowedToReply ? "enabled" : "disabled",
            publicSessionId: input.widgetPublicSessionId,
            sourcePageUrl: input.sourcePageUrl,
            widgetInstanceId: input.widgetInstanceId,
            providerMessageId: input.providerMessageId,
            providerUpdateId: input.providerUpdateId,
            createdAt: now
          })
        );

        if (input.channel === "telegram" && needsManager) {
          await enqueueTelegramManagerNotifications(tx, {
            input,
            leadId: conversation.leadId,
            conversationId: conversation.id,
            publicConversationId: conversation.publicConversationId,
            conversationMessageId: message.id,
            publicMessageId: message.publicMessageId,
            reason: needsManagerReason ?? "telegram_new_inbound",
            contentType,
            createdAt: now
          });
        }

        const [recentMessageRows, slotRows, requirementRows] =
          input.channel === "site_widget"
            ? await Promise.all([
                tx
                  .select({
                    publicMessageId: conversationMessages.publicMessageId,
                    direction: conversationMessages.direction,
                    senderRole: conversationMessages.senderRole,
                    contentType: conversationMessages.contentType,
                    submittedAt: conversationMessages.submittedAt,
                    body: conversationMessages.body,
                    createdAt: conversationMessages.createdAt,
                    messageSequence: conversationMessages.messageSequence
                  })
                  .from(conversationMessages)
                  .where(eq(conversationMessages.conversationId, conversation.id))
                  .orderBy(desc(conversationMessages.createdAt))
                  .limit(13),
                tx
                  .select({
                    name: conversationSlots.name,
                    value: conversationSlots.value,
                    source: conversationSlots.source,
                    sourcePublicMessageId: conversationSlots.sourcePublicMessageId,
                    evidenceQuote: conversationSlots.evidenceQuote,
                    evidenceStart: conversationSlots.evidenceStart,
                    evidenceEnd: conversationSlots.evidenceEnd,
                    confidencePermille: conversationSlots.confidencePermille,
                    updatedAt: conversationSlots.updatedAt
                  })
                  .from(conversationSlots)
                  .where(eq(conversationSlots.conversationId, conversation.id)),
                tx
                  .select({
                    category: conversationRequirements.category,
                    mode: conversationRequirements.mode,
                    value: conversationRequirements.value,
                    source: conversationRequirements.source,
                    sourcePublicMessageId: conversationRequirements.sourcePublicMessageId,
                    evidenceQuote: conversationRequirements.evidenceQuote,
                    evidenceStart: conversationRequirements.evidenceStart,
                    evidenceEnd: conversationRequirements.evidenceEnd,
                    confidencePermille: conversationRequirements.confidencePermille,
                    updatedAt: conversationRequirements.updatedAt
                  })
                  .from(conversationRequirements)
                  .where(eq(conversationRequirements.conversationId, conversation.id))
                  .orderBy(desc(conversationRequirements.updatedAt))
                  .limit(60)
              ])
            : [[], [], []];

        const rollingSummary =
          input.channel === "site_widget"
            ? await advanceAiRollingSummary(
                tx,
                conversation.id,
                message.publicMessageId,
                recentMessageRows,
                now
              )
            : undefined;
        const [runtimeControl] =
          input.channel === "site_widget"
            ? await tx
                .select({ enabled: aiRuntimeControls.enabled })
                .from(aiRuntimeControls)
                .where(eq(aiRuntimeControls.scope, "site_widget"))
                .limit(1)
            : [{ enabled: true }];
        const effectiveAgentAllowedToReply =
          conversation.agentAllowedToReply && runtimeControl?.enabled === true;

        const aiTurnInput = buildSiteWidgetAiTurnInput(input, {
          publicConversationId: conversation.publicConversationId,
          publicMessageId: message.publicMessageId,
          publicSessionId: widgetSession?.publicSessionId,
          agentAllowedToReply: effectiveAgentAllowedToReply,
          aiState: toAiState(conversation.aiState),
          recentMessages: toAiRecentMessages(recentMessageRows, message.publicMessageId),
          rollingSummary,
          persistedSlots: toAiKnownSlots(slotRows),
          persistedRequirements: toAiKnownRequirements(requirementRows)
        });
        let widgetAiJob:
          | {
              id: string;
              inboundPublicMessageId: string;
              status: string;
              attemptCount: number;
              maxAttempts: number;
              terminalReason: string | null;
              expectedGenerationEpoch: number;
              respondsThroughSequence: number;
            }
          | undefined;

        if (
          input.enqueueWidgetAiJob &&
          input.channel === "site_widget" &&
          effectiveAgentAllowedToReply &&
          aiTurnInput
        ) {
          const supersededJobs = await tx
            .select({ id: widgetAiJobs.id, attemptCount: widgetAiJobs.attemptCount })
            .from(widgetAiJobs)
            .where(
              and(
                eq(widgetAiJobs.conversationId, conversation.id),
                or(eq(widgetAiJobs.status, "pending"), eq(widgetAiJobs.status, "retrying"))
              )
            )
            .for("update");
          for (const superseded of supersededJobs) {
            await finalizeSupersededAiRunForJobInTransaction(tx, {
              jobId: superseded.id,
              jobAttemptCount: superseded.attemptCount,
              completedAt: now
            });
          }
          if (supersededJobs.length > 0) {
            await tx
              .update(widgetAiJobs)
              .set({
                status: "superseded",
                terminalReason: "newer_inbound",
                leaseExpiresAt: null,
                completedAt: now,
                updatedAt: now
              })
              .where(inArray(widgetAiJobs.id, supersededJobs.map((job) => job.id)));
          }

          [widgetAiJob] = await tx
            .insert(widgetAiJobs)
            .values({
              inboundMessageId: message.id,
              inboundPublicMessageId: message.publicMessageId,
              conversationId: conversation.id,
              leadId: conversation.leadId,
              status: "pending",
              expectedGenerationEpoch: turnIdentity.expectedGenerationEpoch,
              respondsThroughSequence: turnIdentity.respondsThroughSequence,
              runtimeMode: input.widgetAiRuntimeMode ?? "direct_openai",
              maxAttempts: Math.max(1, Math.min(input.widgetAiJobMaxAttempts ?? 3, 10)),
              availableAt: new Date(now.getTime() + WIDGET_AI_MIN_DEBOUNCE_MS),
              createdAt: now,
              updatedAt: now
            })
            .onConflictDoNothing({ target: widgetAiJobs.inboundMessageId })
            .returning({
              id: widgetAiJobs.id,
              inboundPublicMessageId: widgetAiJobs.inboundPublicMessageId,
              status: widgetAiJobs.status,
              attemptCount: widgetAiJobs.attemptCount,
              maxAttempts: widgetAiJobs.maxAttempts,
              terminalReason: widgetAiJobs.terminalReason,
              expectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
              respondsThroughSequence: widgetAiJobs.respondsThroughSequence
            });
        }

        return {
          leadId: conversation.leadId,
          conversationId: conversation.id,
          publicConversationId: conversation.publicConversationId,
          channelIdentityId: identity.id,
          inboundMessageId: message.id,
          publicMessageId: message.publicMessageId,
          submittedAt: message.submittedAt.toISOString(),
          widgetPublicSessionId: widgetSession?.publicSessionId ?? undefined,
          agentAllowedToReply: effectiveAgentAllowedToReply,
          aiState: toAiState(conversation.aiState),
          replayed: false,
          aiTurnInput,
          aiTurnExecutionContext: aiTurnInput
            ? buildSiteWidgetAiTurnExecutionContext({
                leadId: conversation.leadId,
                conversationId: conversation.id,
                inboundMessageId: message.id,
                publicConversationId: conversation.publicConversationId,
                publicInboundMessageId: message.publicMessageId,
                requestFingerprint: input.requestFingerprint
              })
            : undefined,
          turnIdentity,
          currentWidgetAiWindow:
            input.channel === "site_widget"
              ? {
                  inboundPublicMessageId: message.publicMessageId,
                  respondsThroughSequence: turnIdentity.respondsThroughSequence,
                  generationEpoch: turnIdentity.expectedGenerationEpoch
                }
              : undefined,
          aiRuntimeEnabled: runtimeControl?.enabled === true,
          widgetAiJob: widgetAiJob ? toSiteWidgetAiJobSummary(widgetAiJob) : undefined,
          latestWidgetAiJob: widgetAiJob ? toSiteWidgetAiJobSummary(widgetAiJob) : undefined
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findExistingInboundMessageByIdempotencyKey(input.idempotencyKey);

        if (replay) {
          return this.replayExistingInboundMessage(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  async saveAcceptedSiteWidgetMessage(
    input: SaveAcceptedSiteWidgetMessageInput
  ): Promise<SaveAcceptedSiteWidgetMessageResult> {
    const result = await this.acceptInboundMessage({
      publicMessageId: input.publicMessageId,
      channel: "site_widget",
      provider: "site_widget",
      widgetPublicSessionId: input.publicSessionId,
      widgetInstanceId: input.request.source.widget_instance_id,
      sourcePageUrl: input.request.source.page_url,
      referrerUrl: input.request.source.referrer_url,
      pageTitle: input.request.source.page_title,
      utm: input.request.source.utm ?? null,
      visitorContext: input.request.visitor_context ?? {},
      displayName: input.request.contact?.name,
      contact: {
        name: input.request.contact?.name,
        phone: input.request.contact?.phone,
        email: input.request.contact?.email,
        preferredContact: input.request.contact?.preferred_contact,
        city: input.request.contact?.city
      },
      message: {
        role: "visitor",
        text: input.request.message.text,
        submittedAt: input.request.submitted_at,
        contentType: "text"
      },
      idempotencyKey: input.request.idempotency_key,
      requestFingerprint: input.requestFingerprint,
      automationRequested: input.agentAllowedToReply,
      serverTimestamped: input.request.schema_version === SITE_WIDGET_V2_CONTRACT_VERSION,
      enqueueWidgetAiJob: input.enqueueAiJob,
      widgetAiJobMaxAttempts: input.aiJobMaxAttempts,
      widgetAiRuntimeMode: input.aiJobRuntimeMode,
      metadata: {
        schema_version: input.request.schema_version,
        event_type: input.request.event_type
      }
    });

    return {
      leadId: result.leadId,
      conversationId: result.conversationId,
      publicConversationId: result.publicConversationId,
      channelIdentityId: result.channelIdentityId,
      inboundMessageId: result.inboundMessageId,
      publicSessionId: result.widgetPublicSessionId ?? input.publicSessionId,
      publicMessageId: result.publicMessageId,
      submittedAt: result.submittedAt ?? input.request.submitted_at,
      agentAllowedToReply: result.agentAllowedToReply,
      aiState: result.aiState,
      replayed: result.replayed,
      aiReply: result.existingAiReply,
      aiTurnInput: result.aiTurnInput,
      aiTurnExecutionContext: result.aiTurnExecutionContext,
      turnIdentity: result.turnIdentity,
      currentWidgetAiWindow: result.currentWidgetAiWindow,
      aiRuntimeEnabled: result.aiRuntimeEnabled,
      widgetAiJob: result.widgetAiJob,
      latestWidgetAiJob: result.latestWidgetAiJob
    };
  }

  async persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    if (input.channel === "telegram") {
      throw new TelegramOutboundBlockedError();
    }

    try {
      const existing = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey);

      if (existing) {
        return this.replayExistingAiMessage(existing, input.requestFingerprint);
      }

      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
        const nextAiState =
          input.agentAllowedToReplyAfterSend === false ? "needs_manager" : "ai_collecting_info";
        const preserveWatching = input.agentAllowedToReplyAfterSend !== false;
        const [sendGate] = await tx
          .update(conversations)
          .set({
            agentAllowedToReply: preserveWatching
              ? sql<boolean>`CASE
                  WHEN ${conversations.aiState} = 'watching'
                  THEN ${conversations.agentAllowedToReply}
                  ELSE ${input.agentAllowedToReplyAfterSend ?? true}
                END`
              : false,
            aiState: preserveWatching
              ? sql<string>`CASE
                  WHEN ${conversations.aiState} = 'watching'
                  THEN ${conversations.aiState}
                  ELSE ${nextAiState}
                END`
              : nextAiState,
            lastMessageSequence: sql`${conversations.lastMessageSequence} + 1`,
            updatedAt: now
          })
          .where(
            and(
              eq(conversations.id, input.conversationId),
              eq(conversations.leadId, input.leadId),
              eq(conversations.status, "open"),
              eq(conversations.agentAllowedToReply, true),
              eq(conversations.generationEpoch, input.expectedGenerationEpoch),
              sql`(
                SELECT max(visitor_message.message_sequence)
                FROM conversation_messages visitor_message
                WHERE visitor_message.conversation_id = ${conversations.id}
                  AND visitor_message.direction = 'inbound'
                  AND visitor_message.sender_role = 'visitor'
              ) = ${input.respondsThroughSequence}`,
              sql`EXISTS (
                SELECT 1 FROM ${aiRuntimeControls}
                WHERE ${aiRuntimeControls.scope} = 'site_widget'
                  AND ${aiRuntimeControls.enabled} = true
              )`
            )
          )
          .returning({
            id: conversations.id,
            leadId: conversations.leadId,
            publicConversationId: conversations.publicConversationId,
            channelIdentityId: conversations.channelIdentityId,
            messageSequence: conversations.lastMessageSequence
          });

        if (!sendGate) {
          const replay = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey);

          if (replay) {
            return this.replayExistingAiMessage(replay, input.requestFingerprint);
          }

          const [existingConversation] = await tx
            .select({
              id: conversations.id,
              leadId: conversations.leadId
            })
            .from(conversations)
            .where(eq(conversations.id, input.conversationId))
            .limit(1);

          if (!existingConversation || existingConversation.leadId !== input.leadId) {
            throw new Error("conversation not found for AI reply");
          }

          throw new AgentReplyBlockedError();
        }

        const inboundMessages = await tx
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.publicMessageId, input.inboundPublicMessageId),
              eq(conversationMessages.conversationId, input.conversationId),
              eq(conversationMessages.leadId, input.leadId),
              eq(conversationMessages.direction, "inbound")
            )
          )
          .limit(2);

        if (inboundMessages.length !== 1) {
          throw new Error("AI run inbound message linkage is not unique");
        }

        const inboundMessage = inboundMessages[0];

        if (!inboundMessage) {
          throw new Error("AI run inbound message linkage is missing");
        }

        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: input.conversationId,
            leadId: input.leadId,
            channelIdentityId: sendGate.channelIdentityId ?? null,
            direction: "outbound",
            senderRole: "ai_assistant",
            messageSequence: sendGate.messageSequence,
            body: input.body,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            sourcePageUrl: input.sourcePageUrl ?? null,
            contentType: "text",
            metadata: {
              ...sanitizedMetadata,
              public_conversation_id: sendGate.publicConversationId
            },
            submittedAt: now,
            createdAt: now
          })
          .returning({
            id: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId,
            body: conversationMessages.body,
            createdAt: conversationMessages.createdAt
          });

        if (!message) {
          throw new Error("AI message insert returned no row");
        }

        if (input.slotUpdates?.length) {
          for (const slot of input.slotUpdates) {
            const [currentSlot] = await tx
              .select({
                value: conversationSlots.value,
                source: conversationSlots.source
              })
              .from(conversationSlots)
              .where(
                and(
                  eq(conversationSlots.conversationId, input.conversationId),
                  eq(conversationSlots.name, slot.name)
                )
              )
              .limit(1);
            const applied = currentSlot?.source !== "manager";
            const conflict = Boolean(currentSlot && currentSlot.value !== slot.value);
            const confidencePermille = Math.round(slot.confidence * 1000);

            await tx.insert(conversationSlotEvents).values({
              conversationId: input.conversationId,
              leadId: input.leadId,
              name: slot.name,
              value: slot.value,
              source: slot.source,
              sourcePublicMessageId: slot.sourceMessageId,
              evidenceQuote: slot.evidence?.quote ?? null,
              evidenceStart: slot.evidence?.start ?? null,
              evidenceEnd: slot.evidence?.end ?? null,
              confidencePermille,
              previousValue: currentSlot?.value ?? null,
              applied,
              conflict,
              createdAt: now
            });

            await tx
              .insert(conversationSlots)
              .values({
                conversationId: input.conversationId,
                leadId: input.leadId,
                name: slot.name,
                value: slot.value,
                source: slot.source,
                sourcePublicMessageId: slot.sourceMessageId,
                evidenceQuote: slot.evidence?.quote ?? null,
                evidenceStart: slot.evidence?.start ?? null,
                evidenceEnd: slot.evidence?.end ?? null,
                confidencePermille,
                createdAt: now,
                updatedAt: now
              })
              .onConflictDoUpdate({
                target: [conversationSlots.conversationId, conversationSlots.name],
                setWhere: ne(conversationSlots.source, "manager"),
                set: {
                  value: slot.value,
                  source: slot.source,
                  sourcePublicMessageId: slot.sourceMessageId,
                  evidenceQuote: slot.evidence?.quote ?? null,
                  evidenceStart: slot.evidence?.start ?? null,
                  evidenceEnd: slot.evidence?.end ?? null,
                  confidencePermille,
                  updatedAt: now
                }
              });
          }
        }

        if (input.requirementUpdates?.length) {
          for (const requirement of input.requirementUpdates) {
            await tx
              .insert(conversationRequirements)
              .values({
                conversationId: input.conversationId,
                leadId: input.leadId,
                category: requirement.category,
                mode: requirement.mode,
                value: requirement.value,
                source: requirement.source,
                sourcePublicMessageId: requirement.sourceMessageId,
                evidenceQuote: requirement.evidence.quote,
                evidenceStart: requirement.evidence.start,
                evidenceEnd: requirement.evidence.end,
                confidencePermille: Math.round(requirement.confidence * 1000),
                createdAt: now,
                updatedAt: now
              })
              .onConflictDoUpdate({
                target: [
                  conversationRequirements.conversationId,
                  conversationRequirements.category,
                  conversationRequirements.mode,
                  conversationRequirements.value
                ],
                set: {
                  source: requirement.source,
                  sourcePublicMessageId: requirement.sourceMessageId,
                  evidenceQuote: requirement.evidence.quote,
                  evidenceStart: requirement.evidence.start,
                  evidenceEnd: requirement.evidence.end,
                  confidencePermille: Math.round(requirement.confidence * 1000),
                  updatedAt: now
                }
              });
          }
        }

        if (input.aiRun) {
          const modelEvidence = toGroundedModelEvidence(
            sanitizedMetadata,
            input.aiRun.modelVersion
          );
          await tx.insert(aiRuns).values({
            recordingContract: "native_grounded",
            conversationId: input.conversationId,
            leadId: input.leadId,
            inboundMessageId: inboundMessage.id,
            inboundPublicMessageId: input.inboundPublicMessageId,
            outboundMessageId: message.id,
            outboundPublicMessageId: message.publicMessageId,
            channel: "site_widget",
            runtimeMode: "direct_openai",
            decisionProfile: "grounded_v1",
            decisionAction: toCanonicalAiRunAction(input.aiRun.action),
            idempotencyKey: input.idempotencyKey,
            status: input.handoff ? "handed_off" : "persisted",
            action: input.aiRun.action,
            intent: input.aiRun.intent,
            inputFingerprint: input.aiRun.inputFingerprint,
            promptVersion: input.aiRun.promptVersion ?? null,
            policyVersion: input.aiRun.policyVersion ?? null,
            knowledgeVersion: input.aiRun.knowledgeVersion ?? null,
            modelName: input.aiRun.modelVersion ?? null,
            generatorModelName: input.aiRun.generatorModelName ?? input.aiRun.modelVersion ?? null,
            verifierModelName: input.aiRun.verifierModelName ?? null,
            verifierVersion: input.aiRun.verifierVersion ?? null,
            verifierVerdict: input.aiRun.verifierVerdict ?? null,
            catalogVersion: input.aiRun.catalogVersion ?? null,
            catalogContentHash: input.aiRun.catalogContentHash ?? null,
            configuredModelProvider: modelEvidence.configuredProvider,
            configuredModelName: modelEvidence.modelName,
            observedModelProvider: modelEvidence.observedProvider,
            observedModelName: modelEvidence.observedModelName,
            sendGateResult: "allowed",
            sendGateCheckedAt: now,
            outcomeReason: input.handoff ? "handoff_to_manager" : "reply_persisted",
            profileValidatorResult: toProfileValidatorResult(input.aiRun.verifierVerdict),
            reason: input.handoff?.reason ?? null,
            metadata: sanitizedMetadata,
            completedAt: now,
            createdAt: now,
            updatedAt: now
          });
        }

        if (input.handoff) {
          await tx.insert(conversationHandoffs).values({
            conversationId: input.conversationId,
            leadId: input.leadId,
            inboundPublicMessageId: input.inboundPublicMessageId,
            outboundPublicMessageId: message.publicMessageId,
            reason: input.handoff.reason,
            summary: input.handoff.summary,
            status: "active",
            slotsSnapshot: input.handoff.slotsSnapshot,
            createdAt: now
          });

          await tx.insert(leadTimelineEvents).values({
            leadId: input.leadId,
            eventType: "conversation.ai_handoff_created",
            summary: "AI dialog handed to a manager",
            metadata: {
              public_conversation_id: sendGate.publicConversationId,
              inbound_public_message_id: input.inboundPublicMessageId,
              outbound_public_message_id: message.publicMessageId,
              reason: input.handoff.reason,
              handoff_summary: input.handoff.summary,
              slots: input.handoff.slotsSnapshot
            },
            createdAt: now
          });

          await enqueueAiHandoffManagerNotifications(tx, {
            leadId: input.leadId,
            conversationId: input.conversationId,
            conversationMessageId: message.id,
            publicConversationId: sendGate.publicConversationId,
            publicMessageId: message.publicMessageId,
            reason: input.handoff.reason,
            summary: input.handoff.summary,
            slotsSnapshot: input.handoff.slotsSnapshot,
            createdAt: now
          });
        }

        await tx
          .update(leads)
          .set({
            updatedAt: now
          })
          .where(eq(leads.id, input.leadId));

        await tx.insert(leadTimelineEvents).values(
          aiMessageSentTimelineEvent({
            leadId: input.leadId,
            channel: input.channel,
            publicMessageId: message.publicMessageId,
            inboundPublicMessageId: input.inboundPublicMessageId,
            publicConversationId: sendGate.publicConversationId,
            metadata: sanitizedMetadata,
            createdAt: now
          })
        );

        if (input.jobCommit) {
          const [completedJob] = await tx
            .update(widgetAiJobs)
            .set({
              status: "replied",
              terminalReason: input.handoff ? "handoff" : null,
              outputPublicMessageId: message.publicMessageId,
              leaseExpiresAt: null,
              completedAt: now,
              updatedAt: now
            })
            .where(
              and(
                eq(widgetAiJobs.id, input.jobCommit.jobId),
                eq(widgetAiJobs.status, "processing"),
                eq(widgetAiJobs.attemptCount, input.jobCommit.attemptCount),
                isNotNull(widgetAiJobs.leaseExpiresAt),
                gt(widgetAiJobs.leaseExpiresAt, now),
                eq(widgetAiJobs.conversationId, input.conversationId),
                eq(widgetAiJobs.expectedGenerationEpoch, input.expectedGenerationEpoch),
                eq(widgetAiJobs.respondsThroughSequence, input.respondsThroughSequence),
                eq(widgetAiJobs.runtimeMode, input.runtimeMode ?? "direct_openai")
              )
            )
            .returning({ id: widgetAiJobs.id });

          if (!completedJob) {
            throw new AgentReplyBlockedError();
          }
        }

        const completedRun = input.recordedRun
          ? await completeAiRunInTransaction(tx, {
              run: input.recordedRun.run,
              completion: withRecordedCommitSpans(input.recordedRun.completion),
              outboundMessageId: message.id
            })
          : undefined;

        return {
          internalMessageId: message.id,
          publicMessageId: message.publicMessageId,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          ...(completedRun ? { completedRun } : {})
        };
      });
    } catch (error) {
      if (error instanceof AgentReplyBlockedError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        const replay = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey);

        if (replay) {
          return this.replayExistingAiMessage(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  async saveSiteWidgetAiMessage(
    input: SaveSiteWidgetAiMessageInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    return this.persistAiReplyWithSendGate({
      ...input,
      channel: "site_widget",
      provider: "site_widget"
    });
  }

  async readRecordedSiteWidgetAiGate(input: {
    leadId: string;
    conversationId: string;
  }): Promise<{ aiState: AiState; agentAllowedToReply: boolean }> {
    const [row] = await this.db
      .select({
        aiState: conversations.aiState,
        agentAllowedToReply: conversations.agentAllowedToReply,
        conversationStatus: conversations.status,
        runtimeEnabled: aiRuntimeControls.enabled
      })
      .from(conversations)
      .innerJoin(aiRuntimeControls, eq(aiRuntimeControls.scope, "site_widget"))
      .where(
        and(eq(conversations.id, input.conversationId), eq(conversations.leadId, input.leadId))
      )
      .limit(1);

    if (!row || !isAiState(row.aiState)) {
      throw new Error("recorded site widget AI gate is unavailable");
    }

    return {
      aiState: row.aiState,
      agentAllowedToReply:
        row.conversationStatus === "open" && row.agentAllowedToReply && row.runtimeEnabled
    };
  }

  async persistRecordedSiteWidgetAiReply(
    input: PersistRecordedSiteWidgetAiReplyInput
  ): Promise<import("../../ai/ports/recorded-ai-turn.js").RecordedAiPersistReplyResult> {
    try {
      const saved = await this.persistAiReplyWithSendGate({
        leadId: input.run.leadId,
        conversationId: input.run.conversationId,
        channel: "site_widget",
        provider: "site_widget",
        publicMessageId: input.publicMessageId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        expectedGenerationEpoch: requiredRecordedIdentity(input.expectedGenerationEpoch),
        respondsThroughSequence: requiredRecordedIdentity(input.respondsThroughSequence),
        runtimeMode: input.runtimeMode,
        jobCommit: input.jobCommit,
        body: input.reply.replyDraft,
        sourcePageUrl: input.sourcePageUrl,
        metadata: input.metadata,
        agentAllowedToReplyAfterSend: input.reply.agentAllowedToReplyAfterSend,
        slotUpdates: input.reply.slotUpdates,
        requirementUpdates: input.reply.requirementUpdates,
        handoff: input.reply.handoff,
        recordedRun: {
          run: input.run,
          completion: input.completionPlan.allowed
        }
      });

      if (!saved.internalMessageId || !saved.completedRun) {
        throw new Error("recorded reply replay lacks atomic run linkage");
      }

      return {
        status: "persisted",
        internalMessageId: saved.internalMessageId,
        publicMessageId: saved.publicMessageId,
        body: saved.body,
        completedRun: saved.completedRun
      };
    } catch (error) {
      const blocked = error instanceof AgentReplyBlockedError;
      const completion = blocked
        ? withRecordedBlockedSpan(input.completionPlan.agentReplyBlocked)
        : input.completionPlan.persistenceUnconfirmed;
      const completedRun = await this.completeRecordedSiteWidgetAiNoReply({
        run: input.run,
        completion,
        publicConversationId: "",
        inboundPublicMessageId: input.inboundPublicMessageId,
        expectedGenerationEpoch: input.expectedGenerationEpoch,
        respondsThroughSequence: input.respondsThroughSequence,
        runtimeMode: input.runtimeMode,
        jobCommit: input.jobCommit
      });

      return {
        status: "blocked",
        reason: blocked ? "agent_reply_blocked" : "ai_persistence_unconfirmed",
        completedRun
      };
    }
  }

  async completeRecordedSiteWidgetAiNoReply(
    input: CompleteRecordedSiteWidgetAiNoReplyInput
  ): Promise<TerminalAiRunRecord> {
    return this.db.transaction(async (tx) => {
      const expectedGenerationEpoch = requiredRecordedIdentity(input.expectedGenerationEpoch);
      const respondsThroughSequence = requiredRecordedIdentity(input.respondsThroughSequence);
      const [currentConversation] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.run.conversationId),
            eq(conversations.leadId, input.run.leadId),
            eq(conversations.generationEpoch, expectedGenerationEpoch),
            sql`(
              SELECT max(visitor_message.message_sequence)
              FROM conversation_messages visitor_message
              WHERE visitor_message.conversation_id = ${input.run.conversationId}
                AND visitor_message.direction = 'inbound'
                AND visitor_message.sender_role = 'visitor'
            ) = ${respondsThroughSequence}`
          )
        )
        .limit(1)
        .for("update");

      if (!currentConversation) {
        throw new AgentReplyBlockedError();
      }

      if (input.jobCommit) {
        const completedAt = input.completion.completedAt;
        const [completedJob] = await tx
          .update(widgetAiJobs)
          .set({
            status: input.completion.sendGateResult === "blocked" ? "superseded" : "blocked",
            terminalReason: input.completion.outcomeReason,
            leaseExpiresAt: null,
            completedAt,
            updatedAt: completedAt
          })
          .where(
            and(
              eq(widgetAiJobs.id, input.jobCommit.jobId),
              eq(widgetAiJobs.status, "processing"),
              eq(widgetAiJobs.attemptCount, input.jobCommit.attemptCount),
              isNotNull(widgetAiJobs.leaseExpiresAt),
              gt(widgetAiJobs.leaseExpiresAt, completedAt),
              eq(widgetAiJobs.leadId, input.run.leadId),
              eq(widgetAiJobs.conversationId, input.run.conversationId),
              eq(widgetAiJobs.inboundPublicMessageId, input.inboundPublicMessageId),
              eq(widgetAiJobs.runtimeMode, input.runtimeMode ?? "direct_openai"),
              eq(widgetAiJobs.expectedGenerationEpoch, expectedGenerationEpoch),
              eq(widgetAiJobs.respondsThroughSequence, respondsThroughSequence)
            )
          )
          .returning({ id: widgetAiJobs.id });

        if (!completedJob) {
          throw new AgentReplyBlockedError();
        }
      }

      return completeAiRunInTransaction(tx, {
        run: input.run,
        completion: input.completion
      });
    });
  }

  async failRecordedSiteWidgetAiAttempt(
    input: FailRecordedSiteWidgetAiAttemptInput
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (!input.jobCommit) {
        await failAiRunAttemptInTransaction(tx, input);
        return;
      }
      const expectedGenerationEpoch = requiredRecordedIdentity(input.expectedGenerationEpoch);
      const respondsThroughSequence = requiredRecordedIdentity(input.respondsThroughSequence);
      const [currentJob] = await tx
        .select({ id: widgetAiJobs.id })
        .from(widgetAiJobs)
        .innerJoin(conversations, eq(widgetAiJobs.conversationId, conversations.id))
        .where(
          and(
            eq(widgetAiJobs.id, input.jobCommit.jobId),
            eq(widgetAiJobs.status, "processing"),
            eq(widgetAiJobs.attemptCount, input.jobCommit.attemptCount),
            eq(widgetAiJobs.maxAttempts, input.jobCommit.maxAttempts),
            isNotNull(widgetAiJobs.leaseExpiresAt),
            gt(widgetAiJobs.leaseExpiresAt, input.completion.completedAt),
            eq(widgetAiJobs.leadId, input.run.leadId),
            eq(widgetAiJobs.conversationId, input.run.conversationId),
            eq(widgetAiJobs.inboundPublicMessageId, input.inboundPublicMessageId),
            eq(widgetAiJobs.runtimeMode, input.runtimeMode ?? "direct_openai"),
            eq(widgetAiJobs.expectedGenerationEpoch, expectedGenerationEpoch),
            eq(widgetAiJobs.respondsThroughSequence, respondsThroughSequence),
            eq(conversations.status, "open"),
            eq(conversations.agentAllowedToReply, true),
            eq(conversations.generationEpoch, expectedGenerationEpoch),
            sql`(
              SELECT max(visitor_message.message_sequence)
              FROM conversation_messages visitor_message
              WHERE visitor_message.conversation_id = ${input.run.conversationId}
                AND visitor_message.direction = 'inbound'
                AND visitor_message.sender_role = 'visitor'
            ) = ${respondsThroughSequence}`
          )
        )
        .limit(1)
        .for("update", { of: widgetAiJobs });

      if (!currentJob) {
        await fenceAiRunAttemptInTransaction(tx, input);
        return;
      }
      if (input.jobCommit.attemptCount >= input.jobCommit.maxAttempts) {
        await tx
          .update(widgetAiJobs)
          .set({
            status: "failed",
            terminalReason: "worker_failed",
            lastError: "AI job exhausted its attempt budget",
            leaseExpiresAt: null,
            completedAt: input.completion.completedAt,
            updatedAt: input.completion.completedAt
          })
          .where(eq(widgetAiJobs.id, input.jobCommit.jobId));
      }
      await failAiRunAttemptInTransaction(tx, input);
    });
  }

  fenceRecordedSiteWidgetAiAttempt(input: {
    run: RunningAiRunRecord;
    completion: AiRunTerminalCompletion;
  }): Promise<void> {
    return this.db.transaction((tx) => fenceAiRunAttemptInTransaction(tx, input));
  }

  async recordSiteWidgetAiDegradation(input: RecordSiteWidgetAiDegradationInput): Promise<void> {
    if (
      input.jobCommit &&
      (input.expectedGenerationEpoch === undefined || input.respondsThroughSequence === undefined)
    ) {
      throw new Error("queued AI degradation requires response-window identity");
    }

    await this.db.transaction(async (tx) => {
      const now = new Date();
      const sanitizedMetadata = sanitizeAiObservabilityMetadata(input.metadata);
      const [conversation] = await tx
        .update(conversations)
        .set({
          updatedAt: now
        })
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.leadId, input.leadId),
            input.jobCommit ? eq(conversations.status, "open") : undefined,
            input.jobCommit ? eq(conversations.agentAllowedToReply, true) : undefined,
            input.jobCommit
              ? eq(conversations.generationEpoch, input.expectedGenerationEpoch!)
              : undefined,
            input.jobCommit
              ? sql`(
                  SELECT max(visitor_message.message_sequence)
                  FROM conversation_messages visitor_message
                  WHERE visitor_message.conversation_id = ${conversations.id}
                    AND visitor_message.direction = 'inbound'
                    AND visitor_message.sender_role = 'visitor'
                ) = ${input.respondsThroughSequence!}`
              : undefined,
            input.jobCommit
              ? sql`EXISTS (
                  SELECT 1 FROM ${aiRuntimeControls}
                  WHERE ${aiRuntimeControls.scope} = 'site_widget'
                    AND ${aiRuntimeControls.enabled} = true
                )`
              : undefined
          )
        )
        .returning({
          publicConversationId: conversations.publicConversationId
        });

      if (!conversation) {
        throw new Error("conversation not found for AI degradation");
      }

      const inboundMessages = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.publicMessageId, input.inboundPublicMessageId),
            eq(conversationMessages.conversationId, input.conversationId),
            eq(conversationMessages.leadId, input.leadId),
            eq(conversationMessages.direction, "inbound")
          )
        )
        .limit(2);

      if (inboundMessages.length !== 1 || !inboundMessages[0]) {
        throw new Error("AI degradation inbound message linkage is not unique");
      }

      const inboundMessage = inboundMessages[0];
      const modelVersion = readOptionalString(sanitizedMetadata, "model_name");
      const modelEvidence = toGroundedModelEvidence(sanitizedMetadata, modelVersion);
      const degradationEvidence = toCanonicalDegradationEvidence(input.reason);
      const [run] = await tx
        .insert(aiRuns)
        .values({
          recordingContract: "native_grounded",
          conversationId: input.conversationId,
          leadId: input.leadId,
          inboundMessageId: inboundMessage.id,
          inboundPublicMessageId: input.inboundPublicMessageId,
          channel: "site_widget",
          runtimeMode: input.runtimeMode ?? "direct_openai",
          decisionProfile: "grounded_v1",
          decisionAction: "no_reply",
          action: "fallback",
          idempotencyKey: `ai-degradation:${input.inboundPublicMessageId}`,
          status: "fallback_unavailable",
          inputFingerprint: input.inputFingerprint,
          promptVersion: readOptionalString(sanitizedMetadata, "prompt_version") ?? null,
          policyVersion: readOptionalString(sanitizedMetadata, "policy_version") ?? null,
          knowledgeVersion:
            readOptionalString(sanitizedMetadata, "catalog_version") ??
            readOptionalString(sanitizedMetadata, "knowledge_version") ??
            null,
          modelName: modelVersion ?? null,
          generatorModelName: modelVersion ?? null,
          verifierModelName: readOptionalString(sanitizedMetadata, "verifier_model_name") ?? null,
          verifierVersion: readOptionalString(sanitizedMetadata, "verifier_version") ?? null,
          verifierVerdict: readOptionalString(sanitizedMetadata, "verifier_verdict") ?? null,
          catalogVersion: readOptionalString(sanitizedMetadata, "catalog_version") ?? null,
          catalogContentHash: readOptionalString(sanitizedMetadata, "catalog_content_hash") ?? null,
          configuredModelProvider: modelEvidence.configuredProvider,
          configuredModelName: modelEvidence.modelName,
          observedModelProvider: modelEvidence.observedProvider,
          observedModelName: modelEvidence.observedModelName,
          sendGateResult: "not_checked",
          outcomeReason: degradationEvidence.outcomeReason,
          failureCode: degradationEvidence.failureCode,
          profileValidatorResult: toProfileValidatorResult(
            readOptionalString(sanitizedMetadata, "verifier_verdict")
          ),
          reason: input.reason,
          metadata: sanitizedMetadata,
          completedAt: now,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: aiRuns.inboundPublicMessageId })
        .returning({ id: aiRuns.id });

      if (!run) {
        if (input.jobCommit) {
          throw new AgentReplyBlockedError();
        }
        return;
      }

      if (input.jobCommit) {
        const [completedJob] = await tx
          .update(widgetAiJobs)
          .set({
            status: "degraded",
            terminalReason: input.reason,
            leaseExpiresAt: null,
            completedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(widgetAiJobs.id, input.jobCommit.jobId),
              eq(widgetAiJobs.status, "processing"),
              eq(widgetAiJobs.attemptCount, input.jobCommit.attemptCount),
              isNotNull(widgetAiJobs.leaseExpiresAt),
              gt(widgetAiJobs.leaseExpiresAt, now),
              eq(widgetAiJobs.conversationId, input.conversationId),
              eq(widgetAiJobs.expectedGenerationEpoch, input.expectedGenerationEpoch!),
              eq(widgetAiJobs.respondsThroughSequence, input.respondsThroughSequence!),
              eq(widgetAiJobs.runtimeMode, input.runtimeMode ?? "direct_openai")
            )
          )
          .returning({ id: widgetAiJobs.id });

        if (!completedJob) {
          throw new AgentReplyBlockedError();
        }
      }

      const qualityEvent = toAiQualityEvent(input.reason);

      await tx.insert(aiQualityEvents).values({
        aiRunId: run.id,
        leadId: input.leadId,
        conversationId: input.conversationId,
        messageId: inboundMessage.id,
        eventType: qualityEvent.eventType,
        reasonCode: qualityEvent.reasonCode,
        severity: qualityEvent.severity,
        managerVisible: true,
        resolutionStatus: "open",
        createdAt: now
      });

      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: "conversation.ai_degraded",
        summary: "AI reply unavailable for this turn; manager review requested",
        metadata: {
          public_conversation_id: conversation.publicConversationId,
          inbound_public_message_id: input.inboundPublicMessageId,
          reason: input.reason,
          ...sanitizedMetadata
        },
        createdAt: now
      });

      await enqueueAiDegradationManagerNotifications(tx, {
        leadId: input.leadId,
        conversationId: input.conversationId,
        conversationMessageId: inboundMessage.id,
        publicConversationId: conversation.publicConversationId,
        publicMessageId: input.inboundPublicMessageId,
        reason: input.reason,
        createdAt: now
      });
    });
  }

  async claimSiteWidgetAiJob(input: {
    leaseMs: number;
    now: Date;
  }): Promise<ClaimedSiteWidgetAiJob | null> {
    const leaseMs = Math.max(5_000, Math.min(input.leaseMs, 120_000));

    const claimed = await this.db.transaction(async (tx) => {
      const exhaustedJobs = await tx
        .select({ id: widgetAiJobs.id, attemptCount: widgetAiJobs.attemptCount })
        .from(widgetAiJobs)
        .where(
          and(
            eq(widgetAiJobs.status, "processing"),
            isNotNull(widgetAiJobs.leaseExpiresAt),
            lte(widgetAiJobs.leaseExpiresAt, input.now),
            sql`${widgetAiJobs.attemptCount} >= ${widgetAiJobs.maxAttempts}`
          )
        )
        .for("update", { skipLocked: true });
      for (const exhausted of exhaustedJobs) {
        await finalizeExhaustedAiRunForJobInTransaction(tx, {
          jobId: exhausted.id,
          jobAttemptCount: exhausted.attemptCount,
          completedAt: input.now,
          runningAttemptStatus: "fenced"
        });
        await tx
          .update(widgetAiJobs)
          .set({
            status: "failed",
            terminalReason: "worker_failed",
            lastError: "AI job exhausted its lease and retry budget",
            leaseExpiresAt: null,
            updatedAt: input.now,
            completedAt: input.now
          })
          .where(
            and(
              eq(widgetAiJobs.id, exhausted.id),
              eq(widgetAiJobs.status, "processing"),
              eq(widgetAiJobs.attemptCount, exhausted.attemptCount),
              isNotNull(widgetAiJobs.leaseExpiresAt),
              lte(widgetAiJobs.leaseExpiresAt, input.now)
            )
          );
      }

      const invalidatedJobs = await tx
        .select({ id: widgetAiJobs.id, attemptCount: widgetAiJobs.attemptCount })
        .from(widgetAiJobs)
        .where(
          and(
            or(
              eq(widgetAiJobs.status, "pending"),
              eq(widgetAiJobs.status, "retrying"),
              and(
                eq(widgetAiJobs.status, "processing"),
                isNotNull(widgetAiJobs.leaseExpiresAt),
                lte(widgetAiJobs.leaseExpiresAt, input.now)
              )
            ),
            sql`EXISTS (
              SELECT 1
              FROM conversations current_conversation
              WHERE current_conversation.id = ${widgetAiJobs.conversationId}
                AND (
                  current_conversation.generation_epoch <> ${widgetAiJobs.expectedGenerationEpoch}
                  OR current_conversation.status <> 'open'
                  OR current_conversation.agent_allowed_to_reply <> true
                  OR (
                    SELECT max(visitor_message.message_sequence)
                    FROM conversation_messages visitor_message
                    WHERE visitor_message.conversation_id = ${widgetAiJobs.conversationId}
                      AND visitor_message.direction = 'inbound'
                      AND visitor_message.sender_role = 'visitor'
                  ) IS DISTINCT FROM ${widgetAiJobs.respondsThroughSequence}
                )
            )`
          )
        )
        .for("update", { skipLocked: true });
      for (const invalidated of invalidatedJobs) {
        await finalizeSupersededAiRunForJobInTransaction(tx, {
          jobId: invalidated.id,
          jobAttemptCount: invalidated.attemptCount,
          completedAt: input.now
        });
      }
      if (invalidatedJobs.length > 0) {
        await tx
          .update(widgetAiJobs)
          .set({
            status: "superseded",
            terminalReason: "turn_not_current",
            leaseExpiresAt: null,
            updatedAt: input.now,
            completedAt: input.now
          })
          .where(inArray(widgetAiJobs.id, invalidatedJobs.map((job) => job.id)));
      }

      const [row] = await tx
        .select({
          id: widgetAiJobs.id,
          status: widgetAiJobs.status,
          attemptCount: widgetAiJobs.attemptCount,
          maxAttempts: widgetAiJobs.maxAttempts,
          terminalReason: widgetAiJobs.terminalReason,
          leadId: widgetAiJobs.leadId,
          conversationId: widgetAiJobs.conversationId,
          publicConversationId: conversations.publicConversationId,
          publicSessionId: widgetSessions.publicSessionId,
          inboundPublicMessageId: widgetAiJobs.inboundPublicMessageId,
          expectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
          respondsThroughSequence: widgetAiJobs.respondsThroughSequence,
          runtimeMode: widgetAiJobs.runtimeMode,
          createdAt: widgetAiJobs.createdAt
        })
        .from(widgetAiJobs)
        .innerJoin(conversations, eq(widgetAiJobs.conversationId, conversations.id))
        .innerJoin(widgetSessions, eq(conversations.widgetSessionId, widgetSessions.id))
        .where(
          and(
            sql`${widgetAiJobs.attemptCount} < ${widgetAiJobs.maxAttempts}`,
            eq(conversations.status, "open"),
            eq(conversations.agentAllowedToReply, true),
            sql`EXISTS (
              SELECT 1 FROM ${aiRuntimeControls}
              WHERE ${aiRuntimeControls.scope} = 'site_widget'
                AND ${aiRuntimeControls.enabled} = true
            )`,
            sql`${conversations.generationEpoch} = ${widgetAiJobs.expectedGenerationEpoch}`,
            sql`(
              SELECT max(visitor_message.message_sequence)
              FROM conversation_messages visitor_message
              WHERE visitor_message.conversation_id = ${widgetAiJobs.conversationId}
                AND visitor_message.direction = 'inbound'
                AND visitor_message.sender_role = 'visitor'
            ) = ${widgetAiJobs.respondsThroughSequence}`,
            sql`NOT EXISTS (
              SELECT 1
              FROM widget_ai_jobs active_widget_ai_job
              WHERE active_widget_ai_job.conversation_id = ${widgetAiJobs.conversationId}
                AND active_widget_ai_job.id <> ${widgetAiJobs.id}
                AND active_widget_ai_job.status = 'processing'
                AND active_widget_ai_job.lease_expires_at > ${input.now.toISOString()}::timestamptz
            )`,
            or(
              and(
                or(eq(widgetAiJobs.status, "pending"), eq(widgetAiJobs.status, "retrying")),
                lte(widgetAiJobs.availableAt, input.now)
              ),
              and(
                eq(widgetAiJobs.status, "processing"),
                isNotNull(widgetAiJobs.leaseExpiresAt),
                lte(widgetAiJobs.leaseExpiresAt, input.now)
              )
            )
          )
        )
        .orderBy(asc(widgetAiJobs.availableAt), asc(widgetAiJobs.createdAt))
        .limit(1)
        .for("update", { of: widgetAiJobs, skipLocked: true });

      if (!row) {
        return null;
      }

      const attemptCount = row.attemptCount + 1;
      await tx
        .update(widgetAiJobs)
        .set({
          status: "processing",
          attemptCount,
          leaseExpiresAt: new Date(input.now.getTime() + leaseMs),
          lastError: null,
          updatedAt: input.now
        })
        .where(eq(widgetAiJobs.id, row.id));

      return {
        id: row.id,
        status: "processing" as const,
        attemptCount,
        maxAttempts: row.maxAttempts,
        terminalReason: row.terminalReason ?? undefined,
        leadId: row.leadId,
        conversationId: row.conversationId,
        publicConversationId: row.publicConversationId,
        publicSessionId: row.publicSessionId,
        inboundPublicMessageId: row.inboundPublicMessageId,
        expectedGenerationEpoch: row.expectedGenerationEpoch,
        respondsThroughSequence: row.respondsThroughSequence,
        runtimeMode: toWidgetAiRuntimeMode(row.runtimeMode),
        queueWaitMs: Math.max(0, input.now.getTime() - row.createdAt.getTime())
      };
    });

    if (!claimed) {
      return null;
    }

    const freshTurn = await this.loadFreshClaimedSiteWidgetAiTurn(claimed);

    if (!freshTurn) {
      await this.finishSiteWidgetAiJob({
        jobId: claimed.id,
        attemptCount: claimed.attemptCount,
        status: "failed",
        terminalReason: "fresh_context_unavailable",
        lastError: "Authoritative AI turn context could not be assembled",
        completedAt: input.now
      });
      return null;
    }

    return {
      ...claimed,
      aiTurnInput: freshTurn.aiTurnInput,
      aiTurnExecutionContext: freshTurn.aiTurnExecutionContext
    };
  }

  async isSiteWidgetAiJobCurrent(input: { jobId: string; attemptCount: number }): Promise<boolean> {
    const [row] = await this.db
      .select({ id: widgetAiJobs.id })
      .from(widgetAiJobs)
      .innerJoin(conversations, eq(widgetAiJobs.conversationId, conversations.id))
      .where(
        and(
          eq(widgetAiJobs.id, input.jobId),
          eq(widgetAiJobs.status, "processing"),
          eq(widgetAiJobs.attemptCount, input.attemptCount),
          isNotNull(widgetAiJobs.leaseExpiresAt),
          gt(widgetAiJobs.leaseExpiresAt, new Date()),
          eq(conversations.status, "open"),
          eq(conversations.agentAllowedToReply, true),
          sql`EXISTS (
            SELECT 1 FROM ${aiRuntimeControls}
            WHERE ${aiRuntimeControls.scope} = 'site_widget'
              AND ${aiRuntimeControls.enabled} = true
          )`,
          sql`${conversations.generationEpoch} = ${widgetAiJobs.expectedGenerationEpoch}`,
          sql`(
            SELECT max(visitor_message.message_sequence)
            FROM conversation_messages visitor_message
            WHERE visitor_message.conversation_id = ${widgetAiJobs.conversationId}
              AND visitor_message.direction = 'inbound'
              AND visitor_message.sender_role = 'visitor'
          ) = ${widgetAiJobs.respondsThroughSequence}`
        )
      )
      .limit(1);

    return Boolean(row);
  }

  async finishSiteWidgetAiJob(input: FinishSiteWidgetAiJobInput): Promise<void> {
    const retrying = input.status === "retrying";

    await this.db.transaction(async (tx) => {
      const [job] = await tx
        .select({ id: widgetAiJobs.id, maxAttempts: widgetAiJobs.maxAttempts })
        .from(widgetAiJobs)
        .where(
          and(
            eq(widgetAiJobs.id, input.jobId),
            eq(widgetAiJobs.status, "processing"),
            eq(widgetAiJobs.attemptCount, input.attemptCount),
            isNotNull(widgetAiJobs.leaseExpiresAt),
            gt(widgetAiJobs.leaseExpiresAt, input.completedAt)
          )
        )
        .limit(1)
        .for("update");
      if (!job) return;

      if (input.status === "failed" && input.attemptCount >= job.maxAttempts) {
        await finalizeExhaustedAiRunForJobInTransaction(tx, {
          jobId: input.jobId,
          jobAttemptCount: input.attemptCount,
          completedAt: input.completedAt,
          runningAttemptStatus: "failed"
        });
      }
      if (input.status === "superseded") {
        await finalizeSupersededAiRunForJobInTransaction(tx, {
          jobId: input.jobId,
          jobAttemptCount: input.attemptCount,
          completedAt: input.completedAt
        });
      }

      await tx
        .update(widgetAiJobs)
        .set({
          status: input.status,
          terminalReason: input.terminalReason ?? null,
          outputPublicMessageId: input.outputPublicMessageId ?? null,
          lastError: input.lastError?.slice(0, 500) ?? null,
          availableAt: retrying ? (input.retryAt ?? input.completedAt) : input.completedAt,
          leaseExpiresAt: null,
          updatedAt: input.completedAt,
          completedAt: retrying ? null : input.completedAt
        })
        .where(eq(widgetAiJobs.id, job.id));
    });
  }

  async findSiteWidgetAiReply(
    inboundPublicMessageId: string
  ): Promise<SiteWidgetStoredAiReply | null> {
    const [job] = await this.db
      .select({
        conversationId: widgetAiJobs.conversationId,
        expectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
        respondsThroughSequence: widgetAiJobs.respondsThroughSequence,
        runtimeMode: widgetAiJobs.runtimeMode,
        outputPublicMessageId: widgetAiJobs.outputPublicMessageId
      })
      .from(widgetAiJobs)
      .where(eq(widgetAiJobs.inboundPublicMessageId, inboundPublicMessageId))
      .limit(1);
    let existing = job?.outputPublicMessageId
      ? await this.findExistingAiMessageByPublicMessageId(job.outputPublicMessageId)
      : null;

    if (!existing && job) {
      existing = await this.findExistingAiMessageByIdempotencyKey(
        buildWidgetAiTurnIdempotencyKey({
          conversationId: job.conversationId,
          expectedGenerationEpoch: job.expectedGenerationEpoch,
          respondsThroughSequence: job.respondsThroughSequence,
          runtimeMode: toWidgetAiRuntimeMode(job.runtimeMode)
        })
      );
    }

    existing ??= await this.findExistingAiMessageByIdempotencyKey(`ai:${inboundPublicMessageId}`);

    return existing
      ? {
          publicMessageId: existing.publicMessageId,
          body: existing.body,
          createdAt: existing.createdAt
        }
      : null;
  }

  async getSiteWidgetHistory(publicSessionId: string): Promise<SiteWidgetHistoryResult | null> {
    const latestVisitorMessages = alias(
      conversationMessages,
      "history_latest_visitor_message"
    );
    const latestVisitorConversations = alias(
      conversations,
      "history_latest_visitor_conversation"
    );
    const latestVisitorSessions = alias(widgetSessions, "history_latest_visitor_session");
    const latestVisitor = this.db
      .select({
        inboundPublicMessageId: latestVisitorMessages.publicMessageId,
        respondsThroughSequence: latestVisitorMessages.messageSequence,
        generationEpoch: latestVisitorConversations.generationEpoch
      })
      .from(latestVisitorSessions)
      .innerJoin(
        latestVisitorConversations,
        eq(latestVisitorConversations.widgetSessionId, latestVisitorSessions.id)
      )
      .innerJoin(
        latestVisitorMessages,
        and(
          eq(latestVisitorMessages.conversationId, latestVisitorConversations.id),
          eq(latestVisitorMessages.direction, "inbound"),
          eq(latestVisitorMessages.senderRole, "visitor")
        )
      )
      .where(eq(latestVisitorSessions.publicSessionId, publicSessionId))
      .orderBy(desc(latestVisitorMessages.messageSequence))
      .limit(1)
      .as("history_latest_visitor");
    const rows = await this.db
      .select({
        publicSessionId: widgetSessions.publicSessionId,
        publicConversationId: conversations.publicConversationId,
        aiState: conversations.aiState,
        conversationStatus: conversations.status,
        agentAllowedToReply: conversations.agentAllowedToReply,
        runtimeEnabled: aiRuntimeControls.enabled,
        currentWidgetAiWindow: {
          inboundPublicMessageId: latestVisitor.inboundPublicMessageId,
          respondsThroughSequence: latestVisitor.respondsThroughSequence,
          generationEpoch: latestVisitor.generationEpoch
        },
        publicMessageId: conversationMessages.publicMessageId,
        senderRole: conversationMessages.senderRole,
        body: conversationMessages.body,
        contentType: conversationMessages.contentType,
        submittedAt: conversationMessages.submittedAt,
        metadata: conversationMessages.metadata,
        jobStatus: widgetAiJobs.status,
        jobTerminalReason: widgetAiJobs.terminalReason,
        jobExpectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
        jobRespondsThroughSequence: widgetAiJobs.respondsThroughSequence
      })
      .from(widgetSessions)
      .innerJoin(conversations, eq(conversations.widgetSessionId, widgetSessions.id))
      .leftJoin(
        aiRuntimeControls,
        eq(aiRuntimeControls.scope, "site_widget")
      )
      .leftJoin(latestVisitor, sql`true`)
      .leftJoin(
        conversationMessages,
        eq(conversationMessages.conversationId, conversations.id)
      )
      .leftJoin(
        widgetAiJobs,
        eq(widgetAiJobs.inboundPublicMessageId, conversationMessages.publicMessageId)
      )
      .where(eq(widgetSessions.publicSessionId, publicSessionId))
      .orderBy(desc(conversationMessages.messageSequence))
      .limit(100);

    const snapshot = rows[0];
    if (!snapshot) return null;

    return {
      publicSessionId: snapshot.publicSessionId,
      publicConversationId: snapshot.publicConversationId,
      state: toPublicWidgetConversationState(snapshot.aiState, snapshot.conversationStatus),
      agentAllowedToReply: snapshot.agentAllowedToReply,
      runtimeEnabled: snapshot.runtimeEnabled === true,
      currentWidgetAiWindow: snapshot.currentWidgetAiWindow ?? undefined,
      messages: [...rows]
        .reverse()
        .flatMap((row) => {
          if (
            row.publicMessageId === null ||
            row.senderRole === null ||
            row.body === null ||
            row.contentType !== "text" ||
            row.submittedAt === null ||
            row.metadata === null ||
            (row.senderRole !== "visitor" &&
              row.senderRole !== "ai_assistant" &&
              row.senderRole !== "manager")
          ) {
            return [];
          }

          const catalogReferences = readWidgetCatalogReferences(row.metadata);

          return [
            {
              publicMessageId: row.publicMessageId,
              senderRole: row.senderRole,
              text: row.body,
              submittedAt: row.submittedAt.toISOString(),
              catalogReferences: catalogReferences.length ? catalogReferences : undefined,
              automation: row.jobStatus
                ? {
                    status: toSiteWidgetAiJobStatus(row.jobStatus),
                    reason: row.jobTerminalReason ?? undefined,
                    expectedGenerationEpoch: row.jobExpectedGenerationEpoch!,
                    respondsThroughSequence: row.jobRespondsThroughSequence!
                  }
                : undefined
            }
          ];
        })
    };
  }

  async listManagerLeads(): Promise<ManagerLeadListItem[]> {
    const rows = await this.db
      .select()
      .from(leads)
      .leftJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
      .orderBy(desc(leads.updatedAt), desc(leads.createdAt));

    return Promise.all(
      rows.map(async ({ leads: lead, intake_submissions: submission }) =>
        toManagerLeadListItem(
          lead,
          submission?.publicSubmissionId ?? (await this.findPublicWidgetReferenceForLead(lead.id))
        )
      )
    );
  }

  async getManagerLead(leadId: string): Promise<ManagerLeadDetail | null> {
    const [row] = await this.db
      .select()
      .from(leads)
      .leftJoin(intakeSubmissions, eq(intakeSubmissions.leadId, leads.id))
      .where(eq(leads.id, leadId))
      .limit(1);

    if (!row) {
      return null;
    }

    const [timelineRows, conversationsForManager, structuredIntake] = await Promise.all([
      this.db
        .select()
        .from(leadTimelineEvents)
        .where(eq(leadTimelineEvents.leadId, leadId))
        .orderBy(leadTimelineEvents.createdAt),
      this.listManagerConversations(leadId),
      this.loadManagerStructuredIntake(leadId, row.leads)
    ]);

    return {
      ...toManagerLeadListItem(
        row.leads,
        row.intake_submissions?.publicSubmissionId ??
          (await this.findPublicWidgetReferenceForLead(row.leads.id))
      ),
      timeline: timelineRows.map((event) => ({
        eventType: event.eventType,
        summary: event.summary,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString()
      })),
      conversations: conversationsForManager,
      structuredIntake,
      internalNotePlaceholder: ""
    };
  }

  async changeManagerLeadStatus(
    input: ChangeManagerLeadStatusInput
  ): Promise<ManagerLeadDetail | null> {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: leads.id, status: leads.status })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);

      if (!existing) {
        return;
      }

      const previousStatus = toLeadStatus(existing.status);

      if (previousStatus === input.status) {
        return;
      }

      const changedAt = new Date();

      await tx
        .update(leads)
        .set({
          status: input.status,
          ...(statusRequiresNextStep(input.status)
            ? {
                nextStepAt: changedAt,
                nextStepSummary: "Связаться с клиентом",
                nextStepChannel: "manager_call"
              }
            : {}),
          updatedAt: changedAt
        })
        .where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values(
        leadStatusChangedTimelineEvent({
          leadId: input.leadId,
          fromStatus: previousStatus,
          toStatus: input.status,
          changedByManagerId: input.changedByManagerId,
          changedByManagerEmail: input.changedByManagerEmail,
          changedByManagerRole: input.changedByManagerRole,
          createdAt: changedAt
        })
      );
    });

    return this.getManagerLead(input.leadId);
  }

  async getManagerAiControl(): Promise<ManagerAiControl> {
    const [control] = await this.db
      .select({
        enabled: aiRuntimeControls.enabled,
        version: aiRuntimeControls.version,
        changedByManagerEmail: aiRuntimeControls.changedByManagerEmail,
        changedAt: aiRuntimeControls.changedAt
      })
      .from(aiRuntimeControls)
      .where(eq(aiRuntimeControls.scope, "site_widget"))
      .limit(1);

    if (!control) {
      throw new Error("site widget AI runtime control is unavailable");
    }

    return {
      enabled: control.enabled,
      version: control.version,
      changedByManagerEmail: control.changedByManagerEmail ?? undefined,
      changedAt: control.changedAt.toISOString()
    };
  }

  async setManagerAiControl(input: SetManagerAiControlInput): Promise<ManagerAiControl> {
    return this.db.transaction(async (tx) => {
      const [previous] = await tx
        .select({
          enabled: aiRuntimeControls.enabled,
          version: aiRuntimeControls.version
        })
        .from(aiRuntimeControls)
        .where(
          and(
            eq(aiRuntimeControls.scope, "site_widget"),
            eq(aiRuntimeControls.version, input.expectedVersion)
          )
        )
        .limit(1)
        .for("update");

      if (!previous) {
        throw new AiControlVersionConflictError();
      }

      const changedAt = new Date();
      const [control] = await tx
        .update(aiRuntimeControls)
        .set({
          enabled: input.enabled,
          version: sql`${aiRuntimeControls.version} + 1`,
          changedByManagerId: input.changedByManagerId,
          changedByManagerEmail: input.changedByManagerEmail,
          changedAt
        })
        .where(
          and(
            eq(aiRuntimeControls.scope, "site_widget"),
            eq(aiRuntimeControls.version, input.expectedVersion)
          )
        )
        .returning({
          enabled: aiRuntimeControls.enabled,
          version: aiRuntimeControls.version,
          changedByManagerEmail: aiRuntimeControls.changedByManagerEmail,
          changedAt: aiRuntimeControls.changedAt
        });

      if (!control) {
        throw new AiControlVersionConflictError();
      }

      if (previous.enabled !== input.enabled) {
        await tx
          .update(conversations)
          .set({
            generationEpoch: sql`${conversations.generationEpoch} + 1`,
            updatedAt: changedAt
          })
          .where(eq(conversations.channel, "site_widget"));
      }

      return {
        enabled: control.enabled,
        version: control.version,
        changedByManagerEmail: control.changedByManagerEmail ?? undefined,
        changedAt: control.changedAt.toISOString()
      };
    });
  }

  async setConversationAiControl(
    input: SetConversationAiControlInput
  ): Promise<ManagerLeadDetail | null> {
    let found = false;

    await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({
          id: conversations.id,
          channel: conversations.channel,
          agentAllowedToReply: conversations.agentAllowedToReply,
          aiState: conversations.aiState
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.leadId, input.leadId),
            eq(conversations.publicConversationId, input.publicConversationId)
          )
        )
        .limit(1)
        .for("update");

      if (!conversation || conversation.channel !== "site_widget") {
        return;
      }

      found = true;
      const nextAiState: AiState = input.enabled ? "ai_collecting_info" : "manager_active";

      if (
        conversation.agentAllowedToReply === input.enabled &&
        conversation.aiState === nextAiState
      ) {
        return;
      }

      const changedAt = new Date();

      await tx
        .update(conversations)
        .set({
          agentAllowedToReply: input.enabled,
          aiState: nextAiState,
          generationEpoch: sql`${conversations.generationEpoch} + 1`,
          updatedAt: changedAt
        })
        .where(eq(conversations.id, conversation.id));

      await tx.update(leads).set({ updatedAt: changedAt }).where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: "conversation.ai_control_changed",
        summary: input.enabled ? "Manager enabled AI replies" : "Manager disabled AI replies",
        metadata: {
          public_conversation_id: input.publicConversationId,
          enabled: input.enabled,
          previous_agent_allowed_to_reply: conversation.agentAllowedToReply,
          previous_ai_state: conversation.aiState,
          changed_by_manager_id: input.changedByManagerId,
          changed_by_manager_email: input.changedByManagerEmail,
          changed_by_manager_role: input.changedByManagerRole
        },
        createdAt: changedAt
      });
    });

    return found ? this.getManagerLead(input.leadId) : null;
  }

  async recordAiReviewLabel(input: RecordAiReviewLabelInput): Promise<ManagerLeadDetail | null> {
    const inserted = await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select({ id: aiRuns.id })
        .from(aiRuns)
        .where(and(eq(aiRuns.id, input.aiRunId), eq(aiRuns.leadId, input.leadId)))
        .limit(1);

      if (!run) {
        return false;
      }

      const now = new Date();
      await tx.insert(aiReviewLabels).values({
        aiRunId: input.aiRunId,
        leadId: input.leadId,
        reviewerId: input.changedByManagerId,
        label: input.label,
        note: input.note ?? null,
        createdAt: now
      });
      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: "conversation.ai_review_labeled",
        summary: "Manager reviewed an AI response",
        metadata: {
          ai_run_id: input.aiRunId,
          label: input.label,
          note: input.note ?? null,
          changed_by_manager_id: input.changedByManagerId,
          changed_by_manager_email: input.changedByManagerEmail,
          changed_by_manager_role: input.changedByManagerRole
        },
        createdAt: now
      });

      return true;
    });

    return inserted ? this.getManagerLead(input.leadId) : null;
  }

  async setNextStep(input: SetNextStepInput): Promise<ManagerLeadDetail | null> {
    let found = false;

    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);

      if (!existing) {
        return;
      }

      found = true;
      const changedAt = new Date();

      await tx
        .update(leads)
        .set({
          nextStepAt: new Date(input.nextStepAt),
          nextStepSummary: input.nextStepSummary ?? null,
          nextStepChannel: input.nextStepChannel ?? null,
          updatedAt: changedAt
        })
        .where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values(
        nextStepUpdatedTimelineEvent({
          leadId: input.leadId,
          nextStepAt: input.nextStepAt,
          nextStepSummary: input.nextStepSummary,
          nextStepChannel: input.nextStepChannel,
          changedByManagerId: input.changedByManagerId,
          changedByManagerEmail: input.changedByManagerEmail,
          changedByManagerRole: input.changedByManagerRole,
          createdAt: changedAt
        })
      );
    });

    return found ? this.getManagerLead(input.leadId) : null;
  }

  async recordManualContact(input: RecordManualContactInput): Promise<ManagerLeadDetail | null> {
    let found = false;

    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(eq(leads.id, input.leadId))
        .limit(1);

      if (!existing) {
        return;
      }

      found = true;
      const changedAt = new Date();

      await tx
        .update(leads)
        .set({
          nextStepAt: input.nextStepAt ? new Date(input.nextStepAt) : null,
          nextStepSummary: input.nextStepSummary ?? input.summary,
          nextStepChannel: input.contactChannel,
          updatedAt: changedAt
        })
        .where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values(
        manualContactRecordedTimelineEvent({
          leadId: input.leadId,
          contactChannel: input.contactChannel,
          contactedAt: input.contactedAt,
          summary: input.summary,
          nextStepAt: input.nextStepAt,
          nextStepSummary: input.nextStepSummary,
          changedByManagerId: input.changedByManagerId,
          changedByManagerEmail: input.changedByManagerEmail,
          changedByManagerRole: input.changedByManagerRole,
          createdAt: changedAt
        })
      );
    });

    return found ? this.getManagerLead(input.leadId) : null;
  }

  async takeoverConversation(input: TakeoverConversationInput): Promise<ManagerLeadDetail | null> {
    let found = false;

    await this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .select({
          id: conversations.id,
          leadId: conversations.leadId,
          channel: conversations.channel,
          publicConversationId: conversations.publicConversationId,
          agentAllowedToReply: conversations.agentAllowedToReply,
          aiState: conversations.aiState
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.leadId, input.leadId),
            eq(conversations.publicConversationId, input.publicConversationId)
          )
        )
        .limit(1)
        .for("update");

      if (!conversation) {
        return;
      }

      found = true;

      if (!conversation.agentAllowedToReply && conversation.aiState === "manager_active") {
        return;
      }

      const changedAt = new Date();

      await tx
        .update(conversations)
        .set({
          agentAllowedToReply: false,
          aiState: "manager_active",
          generationEpoch: sql`${conversations.generationEpoch} + 1`,
          updatedAt: changedAt
        })
        .where(eq(conversations.id, conversation.id));

      await tx
        .update(leads)
        .set({
          nextStepAt: changedAt,
          nextStepSummary: "Связаться с клиентом",
          nextStepChannel: conversation.channel === "telegram" ? "telegram" : "site_widget",
          updatedAt: changedAt
        })
        .where(eq(leads.id, input.leadId));

      await tx.insert(leadTimelineEvents).values(
        managerTakeoverTimelineEvent({
          leadId: input.leadId,
          publicConversationId: input.publicConversationId,
          channel: toCustomerChannel(conversation.channel),
          previousAgentAllowedToReply: conversation.agentAllowedToReply,
          previousAiState: conversation.aiState,
          changedByManagerId: input.changedByManagerId,
          changedByManagerEmail: input.changedByManagerEmail,
          changedByManagerRole: input.changedByManagerRole,
          createdAt: changedAt
        })
      );
    });

    if (!found) {
      return null;
    }

    return this.getManagerLead(input.leadId);
  }

  async takeoverConversationByPublicId(
    input: TakeoverConversationByPublicIdInput
  ): Promise<ManagerLeadDetail | null> {
    const [conversation] = await this.db
      .select({
        leadId: conversations.leadId
      })
      .from(conversations)
      .where(eq(conversations.publicConversationId, input.publicConversationId))
      .limit(1);

    if (!conversation) {
      return null;
    }

    return this.takeoverConversation({
      leadId: conversation.leadId,
      publicConversationId: input.publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async takeoverSiteWidgetConversation(
    input: TakeoverSiteWidgetConversationInput
  ): Promise<ManagerLeadDetail | null> {
    const publicConversationId = await this.findPublicConversationIdForWidgetSession(
      input.leadId,
      input.publicSessionId
    );

    if (!publicConversationId) {
      return null;
    }

    return this.takeoverConversation({
      leadId: input.leadId,
      publicConversationId,
      changedByManagerId: input.changedByManagerId,
      changedByManagerEmail: input.changedByManagerEmail,
      changedByManagerRole: input.changedByManagerRole
    });
  }

  async getManagerTelegramBindingStatus(
    managerUserId: string
  ): Promise<ManagerTelegramBindingStatus> {
    return this.managerTelegramRepository.getManagerTelegramBindingStatus(managerUserId);
  }

  async createManagerTelegramBindToken(
    input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult> {
    return this.managerTelegramRepository.createManagerTelegramBindToken(input);
  }

  async bindManagerTelegramChat(
    input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult> {
    return this.managerTelegramRepository.bindManagerTelegramChat(input);
  }

  async findManagerTelegramActor(
    input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null> {
    return this.managerTelegramRepository.findManagerTelegramActor(input);
  }

  async createManagerTelegramReplyContext(
    input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null> {
    return this.managerTelegramRepository.createManagerTelegramReplyContext(input);
  }

  async clearManagerTelegramReplyContext(
    input: ClearManagerTelegramReplyContextInput
  ): Promise<void> {
    return this.managerTelegramRepository.clearManagerTelegramReplyContext(input);
  }

  async persistManagerTelegramReply(
    input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult> {
    return this.managerTelegramRepository.persistManagerTelegramReply(input);
  }

  private async findExistingByIdempotencyKey(idempotencyKey: string) {
    const [existing] = await this.db
      .select({
        leadId: intakeSubmissions.leadId,
        publicSubmissionId: intakeSubmissions.publicSubmissionId,
        requestFingerprint: intakeSubmissions.requestFingerprint
      })
      .from(intakeSubmissions)
      .where(eq(intakeSubmissions.idempotencyKey, idempotencyKey))
      .limit(1);

    return existing ?? null;
  }

  private async findExistingInboundMessageByIdempotencyKey(idempotencyKey: string) {
    const [existing] = await this.db
      .select({
        leadId: conversationMessages.leadId,
        conversationId: conversationMessages.conversationId,
        publicConversationId: conversations.publicConversationId,
        channel: conversations.channel,
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState,
        generationEpoch: conversations.generationEpoch,
        messageChannelIdentityId: conversationMessages.channelIdentityId,
        conversationChannelIdentityId: conversations.channelIdentityId,
        inboundMessageId: conversationMessages.id,
        publicSessionId: widgetSessions.publicSessionId,
        widgetInstanceId: conversations.widgetInstanceId,
        sessionWidgetInstanceId: widgetSessions.widgetInstanceId,
        referrerUrl: widgetSessions.referrerUrl,
        pageTitle: widgetSessions.pageTitle,
        visitorContext: widgetSessions.visitorContext,
        publicMessageId: conversationMessages.publicMessageId,
        messageSequence: conversationMessages.messageSequence,
        messageBody: conversationMessages.body,
        sourcePageUrl: conversationMessages.sourcePageUrl,
        conversationSourcePageUrl: conversations.sourcePageUrl,
        submittedAt: conversationMessages.submittedAt,
        contactName: leads.contactName,
        contactPhone: leads.contactPhone,
        contactEmail: leads.contactEmail,
        contactPreferred: leads.contactPreferred,
        contactCity: leads.contactCity,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .innerJoin(leads, eq(conversationMessages.leadId, leads.id))
      .leftJoin(channelIdentities, eq(conversationMessages.channelIdentityId, channelIdentities.id))
      .leftJoin(widgetSessions, eq(channelIdentities.widgetSessionId, widgetSessions.id))
      .where(
        and(
          eq(conversationMessages.idempotencyKey, idempotencyKey),
          eq(conversationMessages.direction, "inbound")
        )
      )
      .limit(1);

    return existing ?? null;
  }

  private async findExistingAiMessageByIdempotencyKey(
    idempotencyKey: string
  ): Promise<SiteWidgetAiMessageLookupResult | null> {
    const [existing] = await this.db
      .select({
        publicMessageId: conversationMessages.publicMessageId,
        body: conversationMessages.body,
        createdAt: conversationMessages.createdAt,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.idempotencyKey, idempotencyKey))
      .limit(1);

    return existing
      ? {
          publicMessageId: existing.publicMessageId,
          body: existing.body,
          createdAt: existing.createdAt.toISOString(),
          requestFingerprint: existing.requestFingerprint
        }
      : null;
  }

  private async findExistingAiMessageByPublicMessageId(
    publicMessageId: string
  ): Promise<SiteWidgetAiMessageLookupResult | null> {
    const [existing] = await this.db
      .select({
        publicMessageId: conversationMessages.publicMessageId,
        body: conversationMessages.body,
        createdAt: conversationMessages.createdAt,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.publicMessageId, publicMessageId),
          eq(conversationMessages.direction, "outbound"),
          eq(conversationMessages.senderRole, "ai_assistant")
        )
      )
      .limit(1);

    return existing
      ? {
          publicMessageId: existing.publicMessageId,
          body: existing.body,
          createdAt: existing.createdAt.toISOString(),
          requestFingerprint: existing.requestFingerprint
        }
      : null;
  }

  private async loadSiteWidgetReplayProjectionSnapshot(input: {
    conversationId: string;
    inboundPublicMessageId: string;
  }) {
    const inboundJob = alias(widgetAiJobs, "replay_inbound_widget_ai_job");
    const latestJob = this.db
      .select({
        id: widgetAiJobs.id,
        inboundPublicMessageId: widgetAiJobs.inboundPublicMessageId,
        status: widgetAiJobs.status,
        attemptCount: widgetAiJobs.attemptCount,
        maxAttempts: widgetAiJobs.maxAttempts,
        terminalReason: widgetAiJobs.terminalReason,
        expectedGenerationEpoch: widgetAiJobs.expectedGenerationEpoch,
        respondsThroughSequence: widgetAiJobs.respondsThroughSequence
      })
      .from(widgetAiJobs)
      .where(eq(widgetAiJobs.conversationId, input.conversationId))
      .orderBy(desc(widgetAiJobs.respondsThroughSequence), desc(widgetAiJobs.createdAt))
      .limit(1)
      .as("replay_latest_widget_ai_job");
    const latestVisitor = this.db
      .select({
        inboundPublicMessageId: conversationMessages.publicMessageId,
        respondsThroughSequence: conversationMessages.messageSequence
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, input.conversationId),
          eq(conversationMessages.direction, "inbound"),
          eq(conversationMessages.senderRole, "visitor")
        )
      )
      .orderBy(desc(conversationMessages.messageSequence))
      .limit(1)
      .as("replay_latest_widget_visitor");
    const [snapshot] = await this.db
      .select({
        aiState: conversations.aiState,
        agentAllowedToReply: conversations.agentAllowedToReply,
        runtimeEnabled: aiRuntimeControls.enabled,
        generationEpoch: conversations.generationEpoch,
        latestVisitor: {
          inboundPublicMessageId: latestVisitor.inboundPublicMessageId,
          respondsThroughSequence: latestVisitor.respondsThroughSequence
        },
        inboundJob: {
          id: inboundJob.id,
          inboundPublicMessageId: inboundJob.inboundPublicMessageId,
          status: inboundJob.status,
          attemptCount: inboundJob.attemptCount,
          maxAttempts: inboundJob.maxAttempts,
          terminalReason: inboundJob.terminalReason,
          expectedGenerationEpoch: inboundJob.expectedGenerationEpoch,
          respondsThroughSequence: inboundJob.respondsThroughSequence
        },
        latestJob: {
          id: latestJob.id,
          inboundPublicMessageId: latestJob.inboundPublicMessageId,
          status: latestJob.status,
          attemptCount: latestJob.attemptCount,
          maxAttempts: latestJob.maxAttempts,
          terminalReason: latestJob.terminalReason,
          expectedGenerationEpoch: latestJob.expectedGenerationEpoch,
          respondsThroughSequence: latestJob.respondsThroughSequence
        }
      })
      .from(conversations)
      .leftJoin(aiRuntimeControls, eq(aiRuntimeControls.scope, "site_widget"))
      .leftJoin(
        inboundJob,
        and(
          eq(inboundJob.conversationId, conversations.id),
          eq(inboundJob.inboundPublicMessageId, input.inboundPublicMessageId)
        )
      )
      .leftJoin(latestJob, sql`true`)
      .leftJoin(latestVisitor, sql`true`)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);

    if (!snapshot) return null;

    return {
      aiState: toAiState(snapshot.aiState),
      agentAllowedToReply:
        snapshot.agentAllowedToReply && snapshot.runtimeEnabled === true,
      runtimeEnabled: snapshot.runtimeEnabled === true,
      currentWidgetAiWindow: snapshot.latestVisitor
        ? {
            inboundPublicMessageId: snapshot.latestVisitor.inboundPublicMessageId,
            respondsThroughSequence: snapshot.latestVisitor.respondsThroughSequence,
            generationEpoch: snapshot.generationEpoch
          }
        : undefined,
      inboundJob: snapshot.inboundJob
        ? toSiteWidgetAiJobSummary(snapshot.inboundJob)
        : undefined,
      latestJob: snapshot.latestJob
        ? toSiteWidgetAiJobSummary(snapshot.latestJob)
        : undefined
    };
  }

  private async findPublicWidgetReferenceForLead(leadId: string): Promise<string> {
    const [message] = await this.db
      .select({
        publicMessageId: conversationMessages.publicMessageId
      })
      .from(conversationMessages)
      .where(
        and(eq(conversationMessages.leadId, leadId), eq(conversationMessages.direction, "inbound"))
      )
      .orderBy(conversationMessages.createdAt)
      .limit(1);

    return message?.publicMessageId ?? leadId;
  }

  private async findPublicConversationIdForWidgetSession(
    leadId: string,
    publicSessionId: string
  ): Promise<string | null> {
    const [row] = await this.db
      .select({
        publicConversationId: conversations.publicConversationId
      })
      .from(conversations)
      .innerJoin(widgetSessions, eq(conversations.widgetSessionId, widgetSessions.id))
      .where(
        and(eq(conversations.leadId, leadId), eq(widgetSessions.publicSessionId, publicSessionId))
      )
      .limit(1);

    return row?.publicConversationId ?? null;
  }

  private async listManagerConversations(leadId: string): Promise<ManagerConversation[]> {
    const [rows, qualityRows] = await Promise.all([
      this.db
        .select({
          conversation: conversations,
          identity: channelIdentities,
          session: widgetSessions,
          message: conversationMessages,
          delivery: messageDeliveries
        })
        .from(conversations)
        .leftJoin(channelIdentities, eq(conversations.channelIdentityId, channelIdentities.id))
        .leftJoin(widgetSessions, eq(channelIdentities.widgetSessionId, widgetSessions.id))
        .leftJoin(conversationMessages, eq(conversationMessages.conversationId, conversations.id))
        .leftJoin(
          messageDeliveries,
          eq(messageDeliveries.conversationMessageId, conversationMessages.id)
        )
        .where(eq(conversations.leadId, leadId))
        .orderBy(conversations.createdAt, conversationMessages.createdAt),
      this.db
        .select({
          conversationId: aiQualityEvents.conversationId,
          eventType: aiQualityEvents.eventType,
          reasonCode: aiQualityEvents.reasonCode,
          severity: aiQualityEvents.severity,
          runStatus: aiRuns.status,
          createdAt: aiQualityEvents.createdAt
        })
        .from(aiQualityEvents)
        .innerJoin(aiRuns, eq(aiQualityEvents.aiRunId, aiRuns.id))
        .where(
          and(
            eq(aiQualityEvents.leadId, leadId),
            eq(aiQualityEvents.managerVisible, true),
            eq(aiQualityEvents.resolutionStatus, "open")
          )
        )
        .orderBy(desc(aiQualityEvents.createdAt))
    ]);

    const byConversation = new Map<string, ManagerConversation>();
    const latestQualityByConversation = new Map<string, ManagerAiQualitySummary>();

    for (const quality of qualityRows) {
      if (latestQualityByConversation.has(quality.conversationId)) {
        continue;
      }

      latestQualityByConversation.set(quality.conversationId, {
        eventType: toManagerAiQualityEventType(quality.eventType),
        reasonCode: toManagerAiQualityReasonCode(quality.reasonCode),
        severity: toManagerAiQualitySeverity(quality.severity),
        runStatus: toManagerAiQualityRunStatus(quality.runStatus),
        createdAt: quality.createdAt.toISOString()
      });
    }

    for (const row of rows) {
      const existing = byConversation.get(row.conversation.id);
      const conversation =
        existing ??
        ({
          publicConversationId: row.conversation.publicConversationId,
          channel: toCustomerChannel(row.conversation.channel),
          channelIdentity: toManagerChannelIdentity(row.identity, row.session, row.conversation),
          status: "open",
          aiState: toAiState(row.conversation.aiState),
          agentAllowedToReply: row.conversation.agentAllowedToReply,
          latestUnresolvedAiQuality: latestQualityByConversation.get(row.conversation.id),
          sourcePageUrl: row.conversation.sourcePageUrl ?? undefined,
          createdAt: row.conversation.createdAt.toISOString(),
          updatedAt: row.conversation.updatedAt.toISOString(),
          messages: []
        } satisfies ManagerConversation);

      if (!existing) {
        byConversation.set(row.conversation.id, conversation);
      }

      if (row.message) {
        conversation.messages.push({
          publicMessageId: row.message.publicMessageId,
          direction: toConversationMessageDirection(row.message.direction),
          senderRole: toConversationSenderRole(row.message.senderRole),
          body: row.message.body,
          contentType: normalizeContentType(row.message.contentType),
          caption: row.message.caption ?? undefined,
          providerFileId: row.message.providerFileId ?? undefined,
          delivery: row.delivery ? toManagerMessageDelivery(row.delivery) : undefined,
          createdAt: row.message.createdAt.toISOString()
        });
      }
    }

    return Array.from(byConversation.values());
  }

  private async loadManagerStructuredIntake(
    leadId: string,
    lead: typeof leads.$inferSelect
  ): Promise<ManagerStructuredIntake> {
    const [slotRows, requirementRows, conflictRows, latestRunRows, latestHandoffRows, reviewRows] =
      await Promise.all([
        this.db
          .select({
            publicConversationId: conversations.publicConversationId,
            name: conversationSlots.name,
            value: conversationSlots.value,
            source: conversationSlots.source,
            sourcePublicMessageId: conversationSlots.sourcePublicMessageId,
            evidenceQuote: conversationSlots.evidenceQuote,
            evidenceStart: conversationSlots.evidenceStart,
            evidenceEnd: conversationSlots.evidenceEnd,
            confidencePermille: conversationSlots.confidencePermille,
            updatedAt: conversationSlots.updatedAt
          })
          .from(conversationSlots)
          .innerJoin(conversations, eq(conversationSlots.conversationId, conversations.id))
          .where(eq(conversationSlots.leadId, leadId))
          .orderBy(desc(conversationSlots.updatedAt)),
        this.db
          .select({
            publicConversationId: conversations.publicConversationId,
            category: conversationRequirements.category,
            mode: conversationRequirements.mode,
            value: conversationRequirements.value,
            sourcePublicMessageId: conversationRequirements.sourcePublicMessageId,
            evidenceQuote: conversationRequirements.evidenceQuote,
            evidenceStart: conversationRequirements.evidenceStart,
            evidenceEnd: conversationRequirements.evidenceEnd,
            confidencePermille: conversationRequirements.confidencePermille,
            updatedAt: conversationRequirements.updatedAt
          })
          .from(conversationRequirements)
          .innerJoin(conversations, eq(conversationRequirements.conversationId, conversations.id))
          .where(eq(conversationRequirements.leadId, leadId))
          .orderBy(desc(conversationRequirements.updatedAt)),
        this.db
          .select({
            publicConversationId: conversations.publicConversationId,
            name: conversationSlotEvents.name,
            value: conversationSlotEvents.value,
            sourcePublicMessageId: conversationSlotEvents.sourcePublicMessageId,
            evidenceQuote: conversationSlotEvents.evidenceQuote,
            evidenceStart: conversationSlotEvents.evidenceStart,
            evidenceEnd: conversationSlotEvents.evidenceEnd,
            previousValue: conversationSlotEvents.previousValue,
            applied: conversationSlotEvents.applied,
            createdAt: conversationSlotEvents.createdAt
          })
          .from(conversationSlotEvents)
          .innerJoin(conversations, eq(conversationSlotEvents.conversationId, conversations.id))
          .where(
            and(
              eq(conversationSlotEvents.leadId, leadId),
              eq(conversationSlotEvents.conflict, true)
            )
          )
          .orderBy(desc(conversationSlotEvents.createdAt)),
        this.db
          .select({
            id: aiRuns.id,
            status: aiRuns.status,
            verifierVerdict: aiRuns.verifierVerdict,
            generatorModelName: aiRuns.generatorModelName,
            verifierModelName: aiRuns.verifierModelName,
            verifierVersion: aiRuns.verifierVersion,
            catalogVersion: aiRuns.catalogVersion,
            createdAt: aiRuns.createdAt
          })
          .from(aiRuns)
          .where(and(eq(aiRuns.leadId, leadId), ne(aiRuns.status, "running")))
          .orderBy(desc(aiRuns.createdAt))
          .limit(1),
        this.db
          .select({
            reason: conversationHandoffs.reason,
            summary: conversationHandoffs.summary,
            status: conversationHandoffs.status,
            createdAt: conversationHandoffs.createdAt
          })
          .from(conversationHandoffs)
          .where(eq(conversationHandoffs.leadId, leadId))
          .orderBy(desc(conversationHandoffs.createdAt))
          .limit(1),
        this.db
          .select({
            aiRunId: aiReviewLabels.aiRunId,
            label: aiReviewLabels.label,
            note: aiReviewLabels.note,
            createdAt: aiReviewLabels.createdAt
          })
          .from(aiReviewLabels)
          .where(eq(aiReviewLabels.leadId, leadId))
          .orderBy(desc(aiReviewLabels.createdAt))
      ]);

    const slots = slotRows.map((slot) => ({
      publicConversationId: slot.publicConversationId,
      name: toAiSlotName(slot.name),
      value: slot.value,
      source: toManagerSlotSource(slot.source),
      sourceMessageId: slot.sourcePublicMessageId ?? undefined,
      confidence: slot.confidencePermille / 1000,
      evidence: toManagerEvidence(slot),
      updatedAt: slot.updatedAt.toISOString()
    }));
    const knownNames = new Set(slots.map((slot) => slot.name));

    if (lead.contactCity) {
      knownNames.add("city");
    }

    if (lead.contactPhone) {
      knownNames.add("phone");
    }

    if (lead.contactPreferred) {
      knownNames.add("preferredContact");
    }

    const latestRun = latestRunRows[0];
    const latestHandoff = latestHandoffRows[0];

    return {
      slots,
      requirements: requirementRows.flatMap((requirement) => {
        if (
          !AI_REQUIREMENT_CATEGORIES.includes(
            requirement.category as (typeof AI_REQUIREMENT_CATEGORIES)[number]
          ) ||
          !AI_REQUIREMENT_MODES.includes(requirement.mode as (typeof AI_REQUIREMENT_MODES)[number])
        ) {
          return [];
        }

        return [
          {
            publicConversationId: requirement.publicConversationId,
            category: requirement.category as (typeof AI_REQUIREMENT_CATEGORIES)[number],
            mode: requirement.mode as (typeof AI_REQUIREMENT_MODES)[number],
            value: requirement.value,
            sourceMessageId: requirement.sourcePublicMessageId,
            confidence: requirement.confidencePermille / 1000,
            evidence: {
              quote: requirement.evidenceQuote,
              start: requirement.evidenceStart,
              end: requirement.evidenceEnd
            },
            updatedAt: requirement.updatedAt.toISOString()
          }
        ];
      }),
      conflicts: conflictRows.map((conflict) => ({
        publicConversationId: conflict.publicConversationId,
        name: toAiSlotName(conflict.name),
        candidateValue: conflict.value,
        currentValue: conflict.previousValue ?? undefined,
        sourceMessageId: conflict.sourcePublicMessageId ?? undefined,
        evidence: toManagerEvidence(conflict),
        applied: conflict.applied,
        createdAt: conflict.createdAt.toISOString()
      })),
      missingFields: MANAGER_INTAKE_CORE_SLOTS.filter((name) => !knownNames.has(name)),
      handoff: latestHandoff
        ? {
            reason: latestHandoff.reason,
            summary: latestHandoff.summary,
            status: latestHandoff.status === "resolved" ? "resolved" : "active",
            createdAt: latestHandoff.createdAt.toISOString()
          }
        : undefined,
      verification: latestRun
        ? {
            aiRunId: latestRun.id,
            status: toManagerAiRunStatus(latestRun.status),
            verdict: latestRun.verifierVerdict ?? undefined,
            generatorModelName: latestRun.generatorModelName ?? undefined,
            verifierModelName: latestRun.verifierModelName ?? undefined,
            verifierVersion: latestRun.verifierVersion ?? undefined,
            catalogVersion: latestRun.catalogVersion ?? undefined,
            reviewLabels: reviewRows
              .filter((review) => review.aiRunId === latestRun.id)
              .map((review) => ({
                label: toAiReviewLabel(review.label),
                note: review.note ?? undefined,
                createdAt: review.createdAt.toISOString()
              })),
            createdAt: latestRun.createdAt.toISOString()
          }
        : undefined
    };
  }

  private replayExisting(
    existing: {
      leadId: string;
      publicSubmissionId: string;
      requestFingerprint: string;
    },
    requestFingerprint: string
  ): SaveAcceptedSiteFormSubmissionResult {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }

    return {
      leadId: existing.leadId,
      publicSubmissionId: existing.publicSubmissionId,
      replayed: true
    };
  }

  private async replayExistingInboundMessage(
    existing: {
      leadId: string;
      conversationId: string;
      publicConversationId: string;
      channel: string;
      agentAllowedToReply: boolean;
      aiState: string;
      generationEpoch: number;
      messageChannelIdentityId: string | null;
      conversationChannelIdentityId: string | null;
      inboundMessageId: string;
      publicSessionId: string | null;
      widgetInstanceId: string | null;
      sessionWidgetInstanceId: string | null;
      referrerUrl: string | null;
      pageTitle: string | null;
      visitorContext: Record<string, unknown> | null;
      publicMessageId: string;
      messageSequence: number;
      messageBody: string;
      sourcePageUrl: string | null;
      conversationSourcePageUrl: string | null;
      submittedAt: Date;
      contactName: string;
      contactPhone: string | null;
      contactEmail: string | null;
      contactPreferred: string | null;
      contactCity: string | null;
      requestFingerprint: string;
    },
    requestFingerprint: string
  ): Promise<AcceptInboundMessageResult> {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }

    const existingAiReply = await this.findExistingAiMessageByIdempotencyKey(
      `ai:${existing.publicMessageId}`
    );
    const replaySnapshot =
      existing.channel === "site_widget"
        ? await this.loadSiteWidgetReplayProjectionSnapshot({
            conversationId: existing.conversationId,
            inboundPublicMessageId: existing.publicMessageId
          })
        : null;
    const widgetAiJob = replaySnapshot?.inboundJob;
    const context = await this.loadAiDialogContext(
      existing.conversationId,
      existing.publicMessageId
    );
    const effectiveAgentAllowedToReply =
      replaySnapshot?.agentAllowedToReply ?? existing.agentAllowedToReply;
    const currentAiState = replaySnapshot?.aiState ?? toAiState(existing.aiState);
    const persistedInput = {
      ...existing,
      agentAllowedToReply: effectiveAgentAllowedToReply
    };

    return {
      leadId: existing.leadId,
      conversationId: existing.conversationId,
      publicConversationId: existing.publicConversationId,
      channelIdentityId:
        existing.messageChannelIdentityId ?? existing.conversationChannelIdentityId ?? "",
      inboundMessageId: existing.inboundMessageId,
      publicMessageId: existing.publicMessageId,
      submittedAt: existing.submittedAt.toISOString(),
      widgetPublicSessionId: existing.publicSessionId ?? undefined,
      agentAllowedToReply: effectiveAgentAllowedToReply,
      aiState: currentAiState,
      replayed: true,
      existingAiReply: existingAiReply
        ? {
            publicMessageId: existingAiReply.publicMessageId,
            body: existingAiReply.body,
            createdAt: existingAiReply.createdAt
          }
        : undefined,
      aiTurnInput: buildPersistedSiteWidgetAiTurnInput(persistedInput, context),
      aiTurnExecutionContext:
        existing.channel === "site_widget"
          ? buildSiteWidgetAiTurnExecutionContext({
              leadId: existing.leadId,
              conversationId: existing.conversationId,
              inboundMessageId: existing.inboundMessageId,
              publicConversationId: existing.publicConversationId,
              publicInboundMessageId: existing.publicMessageId,
              requestFingerprint: existing.requestFingerprint
            })
          : undefined,
      // Only the durable job preserves the acceptance-time epoch across replay.
      // Legacy synchronous retries without a persisted reply fail closed instead
      // of treating the conversation's current epoch as the original turn epoch.
      turnIdentity: widgetAiJob,
      currentWidgetAiWindow: replaySnapshot?.currentWidgetAiWindow,
      aiRuntimeEnabled: replaySnapshot?.runtimeEnabled,
      widgetAiJob,
      latestWidgetAiJob: replaySnapshot?.latestJob
    };
  }

  private async loadFreshClaimedSiteWidgetAiTurn(input: {
    id: string;
    attemptCount: number;
    conversationId: string;
    respondsThroughSequence: number;
  }): Promise<
    | {
        aiTurnInput: AiTurnInput;
        aiTurnExecutionContext: ReturnType<typeof buildSiteWidgetAiTurnExecutionContext>;
      }
    | undefined
  > {
    const [fresh] = await this.db
      .select({
        leadId: widgetAiJobs.leadId,
        conversationId: widgetAiJobs.conversationId,
        channel: conversations.channel,
        publicConversationId: conversations.publicConversationId,
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState,
        publicSessionId: widgetSessions.publicSessionId,
        publicMessageId: conversationMessages.publicMessageId,
        inboundMessageId: conversationMessages.id,
        messageBody: conversationMessages.body,
        sourcePageUrl: conversationMessages.sourcePageUrl,
        conversationSourcePageUrl: conversations.sourcePageUrl,
        submittedAt: conversationMessages.submittedAt,
        widgetInstanceId: conversations.widgetInstanceId,
        sessionWidgetInstanceId: widgetSessions.widgetInstanceId,
        referrerUrl: widgetSessions.referrerUrl,
        pageTitle: widgetSessions.pageTitle,
        visitorContext: widgetSessions.visitorContext,
        contactName: leads.contactName,
        contactPhone: leads.contactPhone,
        contactEmail: leads.contactEmail,
        contactPreferred: leads.contactPreferred,
        contactCity: leads.contactCity,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(widgetAiJobs)
      .innerJoin(conversations, eq(widgetAiJobs.conversationId, conversations.id))
      .innerJoin(leads, eq(widgetAiJobs.leadId, leads.id))
      .innerJoin(conversationMessages, eq(widgetAiJobs.inboundMessageId, conversationMessages.id))
      .innerJoin(widgetSessions, eq(conversations.widgetSessionId, widgetSessions.id))
      .where(
        and(
          eq(widgetAiJobs.id, input.id),
          eq(widgetAiJobs.status, "processing"),
          eq(widgetAiJobs.attemptCount, input.attemptCount),
          eq(widgetAiJobs.conversationId, input.conversationId),
          eq(conversationMessages.messageSequence, input.respondsThroughSequence),
          eq(conversationMessages.direction, "inbound"),
          eq(conversationMessages.senderRole, "visitor")
        )
      )
      .limit(1);

    if (!fresh) {
      return undefined;
    }

    const context = await this.loadAiDialogContext(
      fresh.conversationId,
      fresh.publicMessageId,
      input.respondsThroughSequence
    );
    const aiTurnInput = buildPersistedSiteWidgetAiTurnInput(fresh, context);

    if (!aiTurnInput) {
      return undefined;
    }

    return {
      aiTurnInput,
      aiTurnExecutionContext: buildSiteWidgetAiTurnExecutionContext({
        leadId: fresh.leadId,
        conversationId: fresh.conversationId,
        inboundMessageId: fresh.inboundMessageId,
        publicConversationId: fresh.publicConversationId,
        publicInboundMessageId: fresh.publicMessageId,
        requestFingerprint: fresh.requestFingerprint
      })
    };
  }

  private async loadAiDialogContext(
    conversationId: string,
    currentPublicMessageId: string,
    respondsThroughSequence?: number
  ) {
    const [recentMessageRows, slotRows, requirementRows, memoryRows] = await Promise.all([
      this.db
        .select({
          publicMessageId: conversationMessages.publicMessageId,
          direction: conversationMessages.direction,
          senderRole: conversationMessages.senderRole,
          contentType: conversationMessages.contentType,
          submittedAt: conversationMessages.submittedAt,
          body: conversationMessages.body,
          createdAt: conversationMessages.createdAt,
          messageSequence: conversationMessages.messageSequence
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            ne(conversationMessages.publicMessageId, currentPublicMessageId),
            eq(conversationMessages.contentType, "text"),
            inArray(conversationMessages.direction, ["inbound", "outbound"]),
            inArray(conversationMessages.senderRole, ["visitor", "ai_assistant"]),
            sql`btrim(${conversationMessages.body}) <> ''`,
            respondsThroughSequence === undefined
              ? undefined
              : lte(conversationMessages.messageSequence, respondsThroughSequence)
          )
        )
        .orderBy(desc(conversationMessages.messageSequence))
        .limit(12),
      this.db
        .select({
          name: conversationSlots.name,
          value: conversationSlots.value,
          source: conversationSlots.source,
          sourcePublicMessageId: conversationSlots.sourcePublicMessageId,
          evidenceQuote: conversationSlots.evidenceQuote,
          evidenceStart: conversationSlots.evidenceStart,
          evidenceEnd: conversationSlots.evidenceEnd,
          confidencePermille: conversationSlots.confidencePermille,
          updatedAt: conversationSlots.updatedAt
        })
        .from(conversationSlots)
        .where(eq(conversationSlots.conversationId, conversationId)),
      this.db
        .select({
          category: conversationRequirements.category,
          mode: conversationRequirements.mode,
          value: conversationRequirements.value,
          source: conversationRequirements.source,
          sourcePublicMessageId: conversationRequirements.sourcePublicMessageId,
          evidenceQuote: conversationRequirements.evidenceQuote,
          evidenceStart: conversationRequirements.evidenceStart,
          evidenceEnd: conversationRequirements.evidenceEnd,
          confidencePermille: conversationRequirements.confidencePermille,
          updatedAt: conversationRequirements.updatedAt
        })
        .from(conversationRequirements)
        .where(eq(conversationRequirements.conversationId, conversationId))
        .orderBy(desc(conversationRequirements.updatedAt))
        .limit(60),
      this.db
        .select({
          summary: conversationAiMemory.summary,
          coveredThroughPublicMessageId: conversationAiMemory.coveredThroughPublicMessageId,
          updatedAt: conversationAiMemory.updatedAt
        })
        .from(conversationAiMemory)
        .where(eq(conversationAiMemory.conversationId, conversationId))
        .limit(1)
    ]);

    return {
      recentMessages: toAiRecentMessages(recentMessageRows, currentPublicMessageId),
      rollingSummary: toAiRollingSummary(memoryRows[0]),
      persistedSlots: toAiKnownSlots(slotRows),
      persistedRequirements: toAiKnownRequirements(requirementRows)
    };
  }

  private replayExistingAiMessage(
    existing: SiteWidgetAiMessageLookupResult,
    requestFingerprint: string
  ): SaveSiteWidgetAiMessageResult {
    if (existing.requestFingerprint !== requestFingerprint) {
      throw new IdempotencyConflictError();
    }

    return {
      publicMessageId: existing.publicMessageId,
      body: existing.body,
      createdAt: existing.createdAt
    };
  }
}

type Transaction = Parameters<Parameters<OperationsDb["transaction"]>[0]>[0];

const WIDGET_CATALOG_HREF_PATTERN =
  /^\/catalog\.html\?section=[a-z0-9-]+&entity=ent_[a-f0-9]+#block-[a-z0-9-]+$/;

function toSiteWidgetAiJobStatus(value: string): SiteWidgetAiJobStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "retrying" ||
    value === "replied" ||
    value === "degraded" ||
    value === "blocked" ||
    value === "failed" ||
    value === "superseded"
  ) {
    return value;
  }

  throw new Error(`invalid site widget AI job status ${value}`);
}

function toWidgetAiRuntimeMode(value: string): "direct_openai" | "mastra_openai_api" {
  if (value === "direct_openai" || value === "mastra_openai_api") {
    return value;
  }

  throw new Error(`invalid site widget AI runtime mode ${value}`);
}

function requiredRecordedIdentity(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value === undefined || value < 0) {
    throw new Error("queued recorded AI reply requires response-window identity");
  }
  return value;
}

function withRecordedCommitSpans(completion: AiRunTerminalCompletion): AiRunTerminalCompletion {
  return {
    ...completion,
    spans: [
      ...completion.spans,
      recordedBoundarySpan("send_gate", "send_gate_check", "succeeded", true),
      recordedBoundarySpan("runtime", "reply_persistence", "succeeded")
    ]
  };
}

function withRecordedBlockedSpan(completion: AiRunTerminalCompletion): AiRunTerminalCompletion {
  return {
    ...completion,
    spans: [
      ...completion.spans,
      recordedBoundarySpan("send_gate", "send_gate_check", "blocked", false, "send_gate_blocked")
    ]
  };
}

function recordedBoundarySpan(
  kind: AiRunSpanWrite["kind"],
  name: AiRunSpanWrite["name"],
  status: AiRunSpanWrite["status"],
  usedInFinalAnswer?: boolean,
  errorCode?: AiRunSpanWrite["errorCode"]
): AiRunSpanWrite {
  return {
    spanId: randomUUID(),
    kind,
    name,
    status,
    latencyMs: 0,
    ...(usedInFinalAnswer === undefined ? {} : { usedInFinalAnswer }),
    ...(errorCode ? { errorCode } : {})
  };
}

function toSiteWidgetAiJobSummary(row: {
  id: string;
  inboundPublicMessageId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  terminalReason: string | null;
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
}): SiteWidgetAiJobSummary {
  return {
    id: row.id,
    inboundPublicMessageId: row.inboundPublicMessageId,
    status: toSiteWidgetAiJobStatus(row.status),
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    terminalReason: row.terminalReason ?? undefined,
    expectedGenerationEpoch: row.expectedGenerationEpoch,
    respondsThroughSequence: row.respondsThroughSequence
  };
}

function readWidgetCatalogReferences(metadata: Record<string, unknown>): WidgetCatalogReference[] {
  const raw = metadata.catalog_references;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.slice(0, 8).flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const { kind, label, title, href, entityId } = entry;
    if (
      kind !== "catalog_item" ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 240 ||
      typeof title !== "string" ||
      !title.trim() ||
      title.length > 160 ||
      typeof href !== "string" ||
      !WIDGET_CATALOG_HREF_PATTERN.test(href) ||
      typeof entityId !== "string" ||
      !/^ent_[a-f0-9]+$/.test(entityId)
    ) {
      return [];
    }

    return [
      {
        kind,
        label: label.trim(),
        title: title.trim(),
        href,
        entityId
      }
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function advanceAiRollingSummary(
  tx: Transaction,
  conversationId: string,
  currentPublicMessageId: string,
  recentRows: AiContextMessageRow[],
  now: Date
): Promise<AiTurnInput["compactContext"]["rollingSummary"] | undefined> {
  const [memory] = await tx
    .select({
      summary: conversationAiMemory.summary,
      coveredThroughPublicMessageId: conversationAiMemory.coveredThroughPublicMessageId,
      coveredThroughCreatedAt: conversationAiMemory.coveredThroughCreatedAt,
      updatedAt: conversationAiMemory.updatedAt
    })
    .from(conversationAiMemory)
    .where(eq(conversationAiMemory.conversationId, conversationId))
    .limit(1);
  const recentEligible = recentRows
    .filter((row) => row.publicMessageId !== currentPublicMessageId && isAiContextMessageRow(row))
    .slice(0, 12);
  const oldestRecent = recentEligible.at(-1);

  if (!oldestRecent) {
    return toAiRollingSummary(memory);
  }

  const olderRows = await tx
    .select({
      publicMessageId: conversationMessages.publicMessageId,
      direction: conversationMessages.direction,
      senderRole: conversationMessages.senderRole,
      contentType: conversationMessages.contentType,
      submittedAt: conversationMessages.submittedAt,
      body: conversationMessages.body,
      createdAt: conversationMessages.createdAt,
      messageSequence: conversationMessages.messageSequence
    })
    .from(conversationMessages)
    .where(
      memory
        ? and(
            eq(conversationMessages.conversationId, conversationId),
            gt(conversationMessages.createdAt, memory.coveredThroughCreatedAt),
            lt(conversationMessages.createdAt, oldestRecent.createdAt)
          )
        : and(
            eq(conversationMessages.conversationId, conversationId),
            lt(conversationMessages.createdAt, oldestRecent.createdAt)
          )
    )
    .orderBy(asc(conversationMessages.createdAt))
    .limit(100);
  const eligibleOlderRows = olderRows.filter(isAiContextMessageRow);

  if (!eligibleOlderRows.length) {
    return toAiRollingSummary(memory);
  }

  const newestCovered = eligibleOlderRows.at(-1)!;
  const appended = eligibleOlderRows
    .map((row) => {
      const speaker = row.senderRole === "visitor" ? "Клиент" : "Ассистент";
      return `[${row.submittedAt.toISOString()}] ${speaker}: ${row.body.trim()}`;
    })
    .join("\n");
  const summary = boundRollingSummary(
    memory?.summary ? `${memory.summary}\n${appended}` : appended
  );

  await tx
    .insert(conversationAiMemory)
    .values({
      conversationId,
      summary,
      coveredThroughPublicMessageId: newestCovered.publicMessageId,
      coveredThroughCreatedAt: newestCovered.createdAt,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: conversationAiMemory.conversationId,
      set: {
        summary,
        coveredThroughPublicMessageId: newestCovered.publicMessageId,
        coveredThroughCreatedAt: newestCovered.createdAt,
        updatedAt: now
      }
    });

  return {
    text: summary,
    coveredThroughPublicMessageId: newestCovered.publicMessageId,
    updatedAt: now.toISOString()
  };
}

function toAiRollingSummary(
  memory:
    | {
        summary: string;
        coveredThroughPublicMessageId: string;
        updatedAt: Date;
      }
    | undefined
): AiTurnInput["compactContext"]["rollingSummary"] | undefined {
  return memory
    ? {
        text: memory.summary,
        coveredThroughPublicMessageId: memory.coveredThroughPublicMessageId,
        updatedAt: memory.updatedAt.toISOString()
      }
    : undefined;
}

function boundRollingSummary(value: string): string {
  if (value.length <= 12_000) {
    return value;
  }

  const tail = value.slice(-12_000);
  const firstLineBreak = tail.indexOf("\n");
  return firstLineBreak >= 0 ? tail.slice(firstLineBreak + 1) : tail;
}

function isAiContextMessageRow(row: AiContextMessageRow): boolean {
  return (
    row.contentType === "text" &&
    (row.direction === "inbound" || row.direction === "outbound") &&
    (row.senderRole === "visitor" || row.senderRole === "ai_assistant") &&
    Boolean(row.body.trim())
  );
}

function nextAiStateForInbound(currentAiState: string, needsManager: boolean): AiState {
  const current = toAiState(currentAiState);

  if (!needsManager) {
    return current;
  }

  return current === "manager_active" ? "manager_active" : "needs_manager";
}

function toPublicWidgetConversationState(
  aiState: string,
  status: string
): SiteWidgetHistoryResult["state"] {
  if (status === "closed" || aiState === "closed") {
    return "closed";
  }

  if (aiState === "manager_active") {
    return "manager_active";
  }

  return aiState === "needs_manager" ? "manager_pending" : "ai_active";
}

function buildSiteWidgetAiTurnInput(
  input: AcceptInboundMessageInput,
  accepted: {
    publicConversationId: string;
    publicMessageId: string;
    publicSessionId?: string;
    agentAllowedToReply: boolean;
    aiState: AiState;
    recentMessages: AiTurnInput["compactContext"]["messages"];
    rollingSummary?: AiTurnInput["compactContext"]["rollingSummary"];
    persistedSlots: AiKnownSlots;
    persistedRequirements: AiTurnInput["knownRequirements"];
  }
): AiTurnInput | undefined {
  if (
    input.channel !== "site_widget" ||
    !accepted.publicSessionId ||
    !input.sourcePageUrl ||
    !input.widgetInstanceId
  ) {
    return undefined;
  }

  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: accepted.publicConversationId,
    publicMessageId: accepted.publicMessageId,
    requestFingerprint: input.requestFingerprint,
    submittedAt: input.message.submittedAt,
    text: input.message.text,
    page: {
      url: input.sourcePageUrl,
      widgetInstanceId: input.widgetInstanceId,
      referrerUrl: input.referrerUrl,
      title: input.pageTitle
    },
    customer: {
      name: input.contact?.name,
      phoneProvided: Boolean(input.contact?.phone),
      emailProvided: Boolean(input.contact?.email),
      preferredContact: input.contact?.preferredContact,
      city: input.contact?.city
    },
    visitor: {
      locale: readOptionalString(input.visitorContext, "locale"),
      timezone: readOptionalString(input.visitorContext, "timezone")
    },
    gate: {
      aiState: accepted.aiState,
      agentAllowedToReply: accepted.agentAllowedToReply
    },
    recentMessages: accepted.recentMessages,
    rollingSummary: accepted.rollingSummary,
    persistedSlots: accepted.persistedSlots,
    persistedRequirements: accepted.persistedRequirements
  });
}

function buildPersistedSiteWidgetAiTurnInput(
  input: {
    channel: string;
    publicConversationId: string;
    agentAllowedToReply: boolean;
    aiState: string;
    publicSessionId: string | null;
    publicMessageId: string;
    messageBody: string;
    sourcePageUrl: string | null;
    conversationSourcePageUrl: string | null;
    submittedAt: Date;
    widgetInstanceId: string | null;
    sessionWidgetInstanceId: string | null;
    referrerUrl: string | null;
    pageTitle: string | null;
    visitorContext: Record<string, unknown> | null;
    contactName: string;
    contactPhone: string | null;
    contactEmail: string | null;
    contactPreferred: string | null;
    contactCity: string | null;
    requestFingerprint: string;
  },
  context: {
    recentMessages: AiTurnInput["compactContext"]["messages"];
    rollingSummary?: AiTurnInput["compactContext"]["rollingSummary"];
    persistedSlots: AiKnownSlots;
    persistedRequirements: AiTurnInput["knownRequirements"];
  }
): AiTurnInput | undefined {
  const pageUrl = input.sourcePageUrl ?? input.conversationSourcePageUrl;
  const widgetInstanceId = input.widgetInstanceId ?? input.sessionWidgetInstanceId;

  if (input.channel !== "site_widget" || !input.publicSessionId || !pageUrl || !widgetInstanceId) {
    return undefined;
  }

  return buildStageASiteWidgetAiTurnInput({
    publicConversationId: input.publicConversationId,
    publicMessageId: input.publicMessageId,
    requestFingerprint: input.requestFingerprint,
    submittedAt: input.submittedAt.toISOString(),
    text: input.messageBody,
    page: {
      url: pageUrl,
      widgetInstanceId,
      referrerUrl: input.referrerUrl ?? undefined,
      title: input.pageTitle ?? undefined
    },
    customer: {
      name: input.contactName === "Site visitor" ? undefined : input.contactName,
      phoneProvided: Boolean(input.contactPhone),
      emailProvided: Boolean(input.contactEmail),
      preferredContact: normalizeAiPreferredContact(input.contactPreferred),
      city: input.contactCity ?? undefined
    },
    visitor: {
      locale: readOptionalString(input.visitorContext, "locale"),
      timezone: readOptionalString(input.visitorContext, "timezone")
    },
    gate: {
      aiState: toAiState(input.aiState),
      agentAllowedToReply: input.agentAllowedToReply
    },
    recentMessages: context.recentMessages,
    rollingSummary: context.rollingSummary,
    persistedSlots: context.persistedSlots,
    persistedRequirements: context.persistedRequirements
  });
}

type AiContextMessageRow = {
  publicMessageId: string;
  direction: string;
  senderRole: string;
  contentType: string;
  submittedAt: Date;
  body: string;
  createdAt: Date;
  messageSequence: number;
};

function toAiRecentMessages(
  rows: AiContextMessageRow[],
  currentPublicMessageId: string
): AiTurnInput["compactContext"]["messages"] {
  const chronological = rows
    .filter(
      (row) =>
        row.publicMessageId !== currentPublicMessageId &&
        row.contentType === "text" &&
        (row.direction === "inbound" || row.direction === "outbound") &&
        (row.senderRole === "visitor" || row.senderRole === "ai_assistant") &&
        row.body.trim()
    )
    .slice(0, 12)
    .reverse();
  const bounded: AiTurnInput["compactContext"]["messages"] = [];
  let remainingCharacters = 12_000;

  for (let index = chronological.length - 1; index >= 0 && remainingCharacters > 0; index -= 1) {
    const row = chronological[index];

    if (!row) {
      continue;
    }

    const fullText = row.body.trim();
    const text =
      fullText.length <= remainingCharacters
        ? fullText
        : fullText.slice(fullText.length - remainingCharacters);

    bounded.unshift({
      publicMessageId: row.publicMessageId,
      direction: row.direction as "inbound" | "outbound",
      senderRole: row.senderRole as "visitor" | "ai_assistant",
      contentType: "text",
      submittedAt: row.submittedAt.toISOString(),
      text
    });
    remainingCharacters -= text.length;
  }

  return bounded;
}

type AiSlotRow = {
  name: string;
  value: string;
  source: string;
  sourcePublicMessageId: string | null;
  evidenceQuote: string | null;
  evidenceStart: number | null;
  evidenceEnd: number | null;
  confidencePermille: number;
  updatedAt: Date;
};

function toAiKnownSlots(rows: AiSlotRow[]): AiKnownSlots {
  const slots: AiKnownSlots = {};

  for (const row of rows) {
    if (!AI_SLOT_NAMES.includes(row.name as AiSlotName) || !isAiSlotSource(row.source)) {
      continue;
    }

    const evidence =
      row.sourcePublicMessageId &&
      row.evidenceQuote &&
      row.evidenceStart !== null &&
      row.evidenceEnd !== null &&
      row.evidenceStart >= 0 &&
      row.evidenceEnd > row.evidenceStart &&
      row.evidenceEnd - row.evidenceStart === row.evidenceQuote.length
        ? {
            messageId: row.sourcePublicMessageId,
            quote: row.evidenceQuote,
            start: row.evidenceStart,
            end: row.evidenceEnd
          }
        : undefined;

    slots[row.name as AiSlotName] = {
      value: row.value,
      source: row.source,
      sourceMessageId: row.sourcePublicMessageId ?? undefined,
      evidence,
      confidence: row.confidencePermille / 1000,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  return slots;
}

type AiRequirementRow = {
  category: string;
  mode: string;
  value: string;
  source: string;
  sourcePublicMessageId: string;
  evidenceQuote: string;
  evidenceStart: number;
  evidenceEnd: number;
  confidencePermille: number;
  updatedAt: Date;
};

function toAiKnownRequirements(rows: AiRequirementRow[]): AiTurnInput["knownRequirements"] {
  return rows.flatMap((row) => {
    if (
      !AI_REQUIREMENT_CATEGORIES.includes(
        row.category as (typeof AI_REQUIREMENT_CATEGORIES)[number]
      ) ||
      !AI_REQUIREMENT_MODES.includes(row.mode as (typeof AI_REQUIREMENT_MODES)[number]) ||
      (row.source !== "ai_extraction" && row.source !== "manager") ||
      row.evidenceStart < 0 ||
      row.evidenceEnd <= row.evidenceStart ||
      row.evidenceEnd - row.evidenceStart !== row.evidenceQuote.length
    ) {
      return [];
    }

    return [
      {
        category: row.category as (typeof AI_REQUIREMENT_CATEGORIES)[number],
        mode: row.mode as (typeof AI_REQUIREMENT_MODES)[number],
        value: row.value,
        source: row.source,
        sourceMessageId: row.sourcePublicMessageId,
        evidence: {
          messageId: row.sourcePublicMessageId,
          quote: row.evidenceQuote,
          start: row.evidenceStart,
          end: row.evidenceEnd
        },
        confidence: row.confidencePermille / 1000,
        updatedAt: row.updatedAt.toISOString()
      }
    ];
  });
}

function isAiSlotSource(
  value: string
): value is "contact" | "visitor_message" | "ai_extraction" | "manager" {
  return (
    value === "contact" ||
    value === "visitor_message" ||
    value === "ai_extraction" ||
    value === "manager"
  );
}

function normalizeAiPreferredContact(value: string | null | undefined) {
  if (value === "phone" || value === "whatsapp" || value === "telegram" || value === "email") {
    return value;
  }

  return undefined;
}

function readOptionalString(
  value: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const entry = value?.[key];

  return typeof entry === "string" && entry.trim() ? entry : undefined;
}

async function enqueueAiHandoffManagerNotifications(
  tx: Transaction,
  input: {
    leadId: string;
    conversationId: string;
    conversationMessageId: string;
    publicConversationId: string;
    publicMessageId: string;
    reason: string;
    summary: string;
    slotsSnapshot: Record<string, unknown>;
    createdAt: Date;
  }
) {
  const destinations = await tx
    .select({
      bindingId: managerTelegramBindings.id,
      managerUserId: managerTelegramBindings.managerUserId,
      managerEmail: managerUsers.email,
      managerRole: managerUsers.role,
      managerStatus: managerUsers.status
    })
    .from(managerTelegramBindings)
    .innerJoin(managerUsers, eq(managerTelegramBindings.managerUserId, managerUsers.id))
    .where(eq(managerTelegramBindings.status, "active"));
  const activeDestinations = destinations.filter(
    (destination) =>
      destination.managerStatus === "active" &&
      (destination.managerRole === "owner" || destination.managerRole === "manager")
  );
  const metadata = {
    public_conversation_id: input.publicConversationId,
    public_message_id: input.publicMessageId,
    handoff_reason: input.reason,
    handoff_summary: input.summary,
    text_preview: input.summary,
    content_type: "site_widget_text",
    needs_manager_reason: input.reason,
    slots: input.slotsSnapshot
  };

  if (!activeDestinations.length) {
    await tx.insert(managerNotificationOutbox).values({
      leadId: input.leadId,
      conversationId: input.conversationId,
      conversationMessageId: input.conversationMessageId,
      notificationType: "site_widget_ai_handoff",
      destinationKind: "manager_telegram_private",
      destinationIdentityId: null,
      managerTelegramBindingId: null,
      status: "blocked_no_destination",
      provider: "telegram_bot",
      metadata: {
        ...metadata,
        reason: "manager_telegram_destination_not_bound"
      },
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    });
    return;
  }

  await tx.insert(managerNotificationOutbox).values(
    activeDestinations.map((destination) => ({
      leadId: input.leadId,
      conversationId: input.conversationId,
      conversationMessageId: input.conversationMessageId,
      notificationType: "site_widget_ai_handoff",
      destinationKind: "manager_telegram_private",
      destinationIdentityId: null,
      managerTelegramBindingId: destination.bindingId,
      status: "pending",
      provider: "telegram_bot",
      metadata: {
        ...metadata,
        manager_user_id: destination.managerUserId,
        manager_email: destination.managerEmail,
        manager_role: destination.managerRole
      },
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    }))
  );
}

async function enqueueAiDegradationManagerNotifications(
  tx: Transaction,
  input: {
    leadId: string;
    conversationId: string;
    conversationMessageId: string;
    publicConversationId: string;
    publicMessageId: string;
    reason: string;
    createdAt: Date;
  }
) {
  const [destinations, slotRows] = await Promise.all([
    tx
      .select({
        bindingId: managerTelegramBindings.id,
        managerUserId: managerTelegramBindings.managerUserId,
        managerEmail: managerUsers.email,
        managerRole: managerUsers.role,
        managerStatus: managerUsers.status
      })
      .from(managerTelegramBindings)
      .innerJoin(managerUsers, eq(managerTelegramBindings.managerUserId, managerUsers.id))
      .where(eq(managerTelegramBindings.status, "active")),
    tx
      .select({ name: conversationSlots.name, value: conversationSlots.value })
      .from(conversationSlots)
      .where(eq(conversationSlots.conversationId, input.conversationId))
  ]);
  const activeDestinations = destinations.filter(
    (destination) =>
      destination.managerStatus === "active" &&
      (destination.managerRole === "owner" || destination.managerRole === "manager")
  );
  const metadata = {
    public_conversation_id: input.publicConversationId,
    public_message_id: input.publicMessageId,
    text_preview: "AI не смог безопасно ответить на последний ход; входящее сообщение сохранено.",
    content_type: "site_widget_text",
    needs_manager_reason: input.reason,
    slots: Object.fromEntries(slotRows.map((slot) => [slot.name, slot.value]))
  };

  if (!activeDestinations.length) {
    await tx.insert(managerNotificationOutbox).values({
      leadId: input.leadId,
      conversationId: input.conversationId,
      conversationMessageId: input.conversationMessageId,
      notificationType: "site_widget_ai_degraded",
      destinationKind: "manager_telegram_private",
      destinationIdentityId: null,
      managerTelegramBindingId: null,
      status: "blocked_no_destination",
      provider: "telegram_bot",
      metadata: {
        ...metadata,
        reason: "manager_telegram_destination_not_bound"
      },
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    });
    return;
  }

  const notifications = await tx
    .insert(managerNotificationOutbox)
    .values(
      activeDestinations.map((destination) => ({
        leadId: input.leadId,
        conversationId: input.conversationId,
        conversationMessageId: input.conversationMessageId,
        notificationType: "site_widget_ai_degraded",
        destinationKind: "manager_telegram_private",
        destinationIdentityId: null,
        managerTelegramBindingId: destination.bindingId,
        status: "pending",
        provider: "telegram_bot",
        metadata: {
          ...metadata,
          manager_user_id: destination.managerUserId,
          manager_email: destination.managerEmail,
          manager_role: destination.managerRole
        },
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }))
    )
    .returning({ id: managerNotificationOutbox.id });

  await tx.insert(leadTimelineEvents).values(
    managerNotificationEnqueuedTimelineEvent({
      leadId: input.leadId,
      notificationIds: notifications.map((notification) => notification.id),
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      status: "pending",
      destinationCount: activeDestinations.length,
      needsManagerReason: "ai_tool_failure",
      createdAt: input.createdAt
    })
  );
}

async function enqueueTelegramManagerNotifications(
  tx: Transaction,
  input: {
    input: AcceptInboundMessageInput;
    leadId: string;
    conversationId: string;
    publicConversationId: string;
    conversationMessageId: string;
    publicMessageId: string;
    reason: NeedsManagerReason;
    contentType: ConversationContentType;
    createdAt: Date;
  }
) {
  const destinations = await tx
    .select({
      bindingId: managerTelegramBindings.id,
      managerUserId: managerTelegramBindings.managerUserId,
      managerEmail: managerUsers.email,
      managerRole: managerUsers.role,
      managerStatus: managerUsers.status
    })
    .from(managerTelegramBindings)
    .innerJoin(managerUsers, eq(managerTelegramBindings.managerUserId, managerUsers.id))
    .where(
      and(
        eq(managerTelegramBindings.provider, "telegram_bot"),
        eq(managerTelegramBindings.providerAccountId, input.input.providerAccountId ?? ""),
        eq(managerTelegramBindings.status, "active")
      )
    );
  const activeDestinations = destinations.filter(
    (destination) =>
      destination.managerStatus === "active" &&
      (destination.managerRole === "owner" || destination.managerRole === "manager")
  );
  const notificationMetadata = telegramManagerNotificationMetadata(input);

  if (!activeDestinations.length) {
    const [notification] = await tx
      .insert(managerNotificationOutbox)
      .values({
        leadId: input.leadId,
        conversationId: input.conversationId,
        conversationMessageId: input.conversationMessageId,
        notificationType: managerNotificationType(input.reason),
        destinationKind: "manager_telegram_private",
        destinationIdentityId: null,
        managerTelegramBindingId: null,
        status: "blocked_no_destination",
        provider: "telegram_bot",
        metadata: {
          ...notificationMetadata,
          reason: "manager_telegram_destination_not_bound"
        },
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      .returning({ id: managerNotificationOutbox.id });

    await tx.insert(leadTimelineEvents).values(
      managerNotificationEnqueuedTimelineEvent({
        leadId: input.leadId,
        notificationId: notification?.id ?? null,
        publicConversationId: input.publicConversationId,
        publicMessageId: input.publicMessageId,
        status: "blocked_no_destination",
        needsManagerReason: input.reason,
        createdAt: input.createdAt
      })
    );

    return;
  }

  const notifications = await tx
    .insert(managerNotificationOutbox)
    .values(
      activeDestinations.map((destination) => ({
        leadId: input.leadId,
        conversationId: input.conversationId,
        conversationMessageId: input.conversationMessageId,
        notificationType: managerNotificationType(input.reason),
        destinationKind: "manager_telegram_private",
        destinationIdentityId: null,
        managerTelegramBindingId: destination.bindingId,
        status: "pending",
        provider: "telegram_bot",
        metadata: {
          ...notificationMetadata,
          manager_user_id: destination.managerUserId,
          manager_email: destination.managerEmail,
          manager_role: destination.managerRole
        },
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }))
    )
    .returning({ id: managerNotificationOutbox.id });

  await tx.insert(leadTimelineEvents).values(
    managerNotificationEnqueuedTimelineEvent({
      leadId: input.leadId,
      notificationIds: notifications.map((notification) => notification.id),
      publicConversationId: input.publicConversationId,
      publicMessageId: input.publicMessageId,
      status: "pending",
      destinationCount: activeDestinations.length,
      needsManagerReason: input.reason,
      createdAt: input.createdAt
    })
  );
}

async function ensureWidgetSession(tx: Transaction, input: AcceptInboundMessageInput, now: Date) {
  if (input.channel !== "site_widget") {
    return null;
  }

  if (!input.widgetPublicSessionId || !input.sourcePageUrl || !input.widgetInstanceId) {
    throw new Error("site widget inbound requires session, source page and widget instance");
  }

  const [session] = await tx
    .insert(widgetSessions)
    .values({
      publicSessionId: input.widgetPublicSessionId,
      sourcePageUrl: input.sourcePageUrl,
      widgetInstanceId: input.widgetInstanceId,
      referrerUrl: input.referrerUrl ?? null,
      pageTitle: input.pageTitle ?? null,
      utm: input.utm ?? null,
      visitorContext: input.visitorContext ?? {},
      createdAt: now,
      lastSeenAt: now
    })
    .onConflictDoUpdate({
      target: widgetSessions.publicSessionId,
      set: {
        sourcePageUrl: input.sourcePageUrl,
        widgetInstanceId: input.widgetInstanceId,
        referrerUrl: input.referrerUrl ?? null,
        pageTitle: input.pageTitle ?? null,
        utm: input.utm ?? null,
        visitorContext: input.visitorContext ?? {},
        lastSeenAt: now
      }
    })
    .returning({
      id: widgetSessions.id,
      publicSessionId: widgetSessions.publicSessionId
    });

  if (!session) {
    throw new Error("widget session insert returned no row");
  }

  return session;
}

async function findOrCreateChannelIdentity(
  tx: Transaction,
  input: AcceptInboundMessageInput,
  widgetSessionId: string | null,
  now: Date
) {
  const existing = await findChannelIdentity(tx, input, widgetSessionId);

  if (existing) {
    const [updated] = await tx
      .update(channelIdentities)
      .set({
        displayName: input.displayName ?? input.contact?.name ?? existing.displayName,
        username: input.username ?? input.contact?.username ?? existing.username,
        externalUserId: input.externalUserId ?? existing.externalUserId,
        metadata: {
          ...existing.metadata,
          ...channelIdentityMetadata(input)
        },
        updatedAt: now,
        lastSeenAt: now
      })
      .where(eq(channelIdentities.id, existing.id))
      .returning({
        id: channelIdentities.id,
        leadId: channelIdentities.leadId,
        displayName: channelIdentities.displayName,
        username: channelIdentities.username,
        externalUserId: channelIdentities.externalUserId,
        metadata: channelIdentities.metadata
      });

    if (!updated) {
      throw new Error("channel identity update returned no row");
    }

    return updated;
  }

  const [created] = await tx
    .insert(channelIdentities)
    .values({
      channel: input.channel,
      provider: input.provider,
      providerAccountId: input.providerAccountId ?? null,
      externalChatId: input.externalChatId ?? null,
      externalUserId: input.externalUserId ?? null,
      widgetSessionId,
      displayName: input.displayName ?? input.contact?.name ?? null,
      username: input.username ?? input.contact?.username ?? null,
      normalizedPhone: input.contact?.phone ?? null,
      metadata: channelIdentityMetadata(input),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now
    })
    .returning({
      id: channelIdentities.id,
      leadId: channelIdentities.leadId,
      displayName: channelIdentities.displayName,
      username: channelIdentities.username,
      externalUserId: channelIdentities.externalUserId,
      metadata: channelIdentities.metadata
    });

  if (!created) {
    throw new Error("channel identity insert returned no row");
  }

  return created;
}

async function findChannelIdentity(
  tx: Transaction,
  input: AcceptInboundMessageInput,
  widgetSessionId: string | null
) {
  if (input.channel === "site_widget") {
    if (!widgetSessionId) {
      throw new Error("site widget identity requires widget session");
    }

    const [existing] = await tx
      .select({
        id: channelIdentities.id,
        leadId: channelIdentities.leadId,
        displayName: channelIdentities.displayName,
        username: channelIdentities.username,
        externalUserId: channelIdentities.externalUserId,
        metadata: channelIdentities.metadata
      })
      .from(channelIdentities)
      .where(eq(channelIdentities.widgetSessionId, widgetSessionId))
      .limit(1);

    return existing ?? null;
  }

  const [existing] = await tx
    .select({
      id: channelIdentities.id,
      leadId: channelIdentities.leadId,
      displayName: channelIdentities.displayName,
      username: channelIdentities.username,
      externalUserId: channelIdentities.externalUserId,
      metadata: channelIdentities.metadata
    })
    .from(channelIdentities)
    .where(
      and(
        eq(channelIdentities.channel, "telegram"),
        eq(channelIdentities.provider, input.provider),
        eq(channelIdentities.providerAccountId, input.providerAccountId ?? ""),
        eq(channelIdentities.externalChatId, input.externalChatId ?? "")
      )
    )
    .limit(1);

  return existing ?? null;
}

async function findExistingProviderInbound(
  tx: Transaction,
  channelIdentityId: string,
  input: AcceptInboundMessageInput
) {
  const providerConditions: SQLWrapper[] = [];

  if (input.providerMessageId) {
    providerConditions.push(eq(conversationMessages.providerMessageId, input.providerMessageId));
  }

  if (input.providerUpdateId) {
    providerConditions.push(eq(conversationMessages.providerUpdateId, input.providerUpdateId));
  }

  if (!providerConditions.length) {
    return null;
  }

  const providerWhere =
    providerConditions.length === 1 ? providerConditions[0] : or(...providerConditions);

  if (!providerWhere) {
    return null;
  }

  const [existing] = await tx
    .select({
      leadId: conversationMessages.leadId,
      conversationId: conversationMessages.conversationId,
      publicConversationId: conversations.publicConversationId,
      channel: conversations.channel,
      agentAllowedToReply: conversations.agentAllowedToReply,
      aiState: conversations.aiState,
      generationEpoch: conversations.generationEpoch,
      messageChannelIdentityId: conversationMessages.channelIdentityId,
      conversationChannelIdentityId: conversations.channelIdentityId,
      inboundMessageId: conversationMessages.id,
      publicSessionId: widgetSessions.publicSessionId,
      widgetInstanceId: conversations.widgetInstanceId,
      sessionWidgetInstanceId: widgetSessions.widgetInstanceId,
      referrerUrl: widgetSessions.referrerUrl,
      pageTitle: widgetSessions.pageTitle,
      visitorContext: widgetSessions.visitorContext,
      publicMessageId: conversationMessages.publicMessageId,
      messageSequence: conversationMessages.messageSequence,
      messageBody: conversationMessages.body,
      sourcePageUrl: conversationMessages.sourcePageUrl,
      conversationSourcePageUrl: conversations.sourcePageUrl,
      submittedAt: conversationMessages.submittedAt,
      contactName: leads.contactName,
      contactPhone: leads.contactPhone,
      contactEmail: leads.contactEmail,
      contactPreferred: leads.contactPreferred,
      contactCity: leads.contactCity,
      requestFingerprint: conversationMessages.requestFingerprint
    })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
    .innerJoin(leads, eq(conversationMessages.leadId, leads.id))
    .leftJoin(channelIdentities, eq(conversationMessages.channelIdentityId, channelIdentities.id))
    .leftJoin(widgetSessions, eq(channelIdentities.widgetSessionId, widgetSessions.id))
    .where(
      and(
        eq(conversationMessages.channelIdentityId, channelIdentityId),
        eq(conversationMessages.direction, "inbound"),
        providerWhere
      )
    )
    .limit(1);

  return existing ?? null;
}

function toLeadInsert(request: SiteFormIntakeRequest): typeof leads.$inferInsert {
  return {
    status: "new",
    sourceChannel: request.source.channel,
    sourcePageUrl: request.source.page_url,
    sourceFormKind: request.source.form_kind,
    contactName: request.contact.name,
    contactPhone: request.contact.phone ?? null,
    contactEmail: request.contact.email ?? null,
    contactPreferred: request.contact.preferred_contact ?? null,
    contactCity: request.contact.city ?? null,
    requestText: request.request?.message ?? null,
    requestProductInterest: request.request?.product_interest ?? null,
    submittedAt: new Date(request.submitted_at),
    referrerUrl: request.source.referrer_url ?? null,
    utm: request.source.utm ?? null,
    metadata: {
      contract_version: request.schema_version,
      event_type: request.event_type
    }
  };
}

function toInboundLeadInsert(
  input: AcceptInboundMessageInput,
  now: Date
): typeof leads.$inferInsert {
  return {
    status: "new",
    sourceChannel: input.channel,
    sourcePageUrl: input.sourcePageUrl ?? null,
    sourceFormKind: input.channel === "site_widget" ? "site_widget" : null,
    contactName:
      input.contact?.name ??
      input.displayName ??
      (input.channel === "telegram" ? "Telegram" : "Site visitor"),
    contactPhone: input.contact?.phone ?? null,
    contactEmail: input.contact?.email ?? null,
    contactPreferred:
      input.contact?.preferredContact ?? (input.channel === "telegram" ? "telegram" : null),
    contactCity: input.contact?.city ?? null,
    requestText: input.message.text || input.message.caption || null,
    requestProductInterest: null,
    submittedAt: new Date(input.message.submittedAt),
    referrerUrl: input.referrerUrl ?? null,
    utm: input.utm ?? null,
    metadata: {
      ...input.metadata,
      provider: input.provider,
      provider_account_id: input.providerAccountId ?? null,
      external_chat_id: input.externalChatId ?? null,
      external_user_id: input.externalUserId ?? null,
      widget_instance_id: input.widgetInstanceId ?? null,
      created_via: "acceptInboundMessage"
    },
    createdAt: now,
    updatedAt: now
  };
}

function toManagerLeadListItem(
  lead: typeof leads.$inferSelect,
  publicSubmissionId: string
): ManagerLeadListItem {
  return {
    leadId: lead.id,
    publicSubmissionId,
    status: toLeadStatus(lead.status),
    source: {
      channel: toSourceChannel(lead.sourceChannel),
      pageUrl: lead.sourcePageUrl ?? undefined,
      formKind: lead.sourceFormKind ?? undefined,
      referrerUrl: lead.referrerUrl ?? undefined,
      utm: lead.utm ?? undefined,
      widgetInstanceId: readStringMetadata(lead.metadata, "widget_instance_id")
    },
    contact: {
      name: lead.contactName,
      phone: lead.contactPhone ?? undefined,
      email: lead.contactEmail ?? undefined,
      preferredContact: normalizePreferredContact(lead.contactPreferred),
      city: lead.contactCity ?? undefined
    },
    request: {
      text: lead.requestText ?? undefined,
      productInterest: lead.requestProductInterest ?? undefined
    },
    submittedAt: lead.submittedAt.toISOString(),
    nextStep: lead.nextStepAt
      ? {
          at: lead.nextStepAt.toISOString(),
          summary: lead.nextStepSummary ?? undefined,
          channel: normalizeNextStepChannel(lead.nextStepChannel)
        }
      : undefined,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString()
  };
}

function toManagerChannelIdentity(
  identity: typeof channelIdentities.$inferSelect | null,
  session: typeof widgetSessions.$inferSelect | null,
  conversation: typeof conversations.$inferSelect
): ManagerChannelIdentity {
  return {
    provider: identity?.provider ?? conversation.channel,
    displayName: identity?.displayName ?? undefined,
    username: identity?.username ?? undefined,
    externalChatId: identity?.externalChatId ?? undefined,
    externalUserId: identity?.externalUserId ?? undefined,
    widgetPublicSessionId: session?.publicSessionId ?? undefined,
    widgetInstanceId: conversation.widgetInstanceId ?? session?.widgetInstanceId ?? undefined
  };
}

function toManagerMessageDelivery(
  delivery: typeof messageDeliveries.$inferSelect
): ManagerConversation["messages"][number]["delivery"] {
  return {
    status: toMessageDeliveryStatus(delivery.status),
    attemptCount: delivery.attemptCount,
    lastError: delivery.lastError ?? undefined,
    providerMessageId: delivery.providerMessageId ?? undefined,
    updatedAt: delivery.updatedAt.toISOString()
  };
}

const MANAGER_INTAKE_CORE_SLOTS: readonly AiSlotName[] = [
  "monumentType",
  "material",
  "size",
  "city",
  "installation",
  "desiredTiming",
  "preferredContact"
];

function toAiSlotName(value: string): AiSlotName {
  if (AI_SLOT_NAMES.includes(value as AiSlotName)) {
    return value as AiSlotName;
  }

  throw new Error(`invalid AI slot name ${value}`);
}

function toManagerSlotSource(value: string): ManagerStructuredIntake["slots"][number]["source"] {
  if (
    value === "contact" ||
    value === "visitor_message" ||
    value === "ai_extraction" ||
    value === "manager"
  ) {
    return value;
  }

  throw new Error(`invalid AI slot source ${value}`);
}

function toManagerEvidence(value: {
  evidenceQuote: string | null;
  evidenceStart: number | null;
  evidenceEnd: number | null;
}) {
  return value.evidenceQuote !== null && value.evidenceStart !== null && value.evidenceEnd !== null
    ? {
        quote: value.evidenceQuote,
        start: value.evidenceStart,
        end: value.evidenceEnd
      }
    : undefined;
}

function toManagerAiRunStatus(
  value: string
): NonNullable<ManagerStructuredIntake["verification"]>["status"] {
  if (value === "replied" || value === "handoff" || value === "degraded") {
    return value;
  }

  if (value === "persisted") return "replied";
  if (value === "handed_off") return "handoff";
  if (value === "blocked" || value === "fallback_unavailable" || value === "failed") {
    return "degraded";
  }

  throw new Error(`invalid AI run status ${value}`);
}

function toManagerAiQualityRunStatus(value: string): ManagerAiQualitySummary["runStatus"] {
  if (value === "replied") {
    return "persisted";
  }

  if (value === "handoff") {
    return "handed_off";
  }

  if (value === "degraded") {
    return "fallback_unavailable";
  }

  if (
    value === "running" ||
    value === "persisted" ||
    value === "handed_off" ||
    value === "blocked" ||
    value === "fallback_unavailable" ||
    value === "failed"
  ) {
    return value;
  }

  throw new Error(`invalid AI quality run status ${value}`);
}

function toManagerAiQualityEventType(value: string): ManagerAiQualitySummary["eventType"] {
  if (
    value === "handoff" ||
    value === "degradation" ||
    value === "blocked" ||
    value === "policy_violation" ||
    value === "model_failure" ||
    value === "tool_failure" ||
    value === "runtime_failure"
  ) {
    return value;
  }

  throw new Error(`invalid AI quality event type ${value}`);
}

function toManagerAiQualityReasonCode(value: string): ManagerAiQualitySummary["reasonCode"] {
  if (
    value === "handoff_to_manager" ||
    value === "missing_openai_config" ||
    value === "model_error" ||
    value === "semantic_verifier_error" ||
    value === "turn_timeout" ||
    value === "empty_model_response" ||
    value === "unsafe_model_response" ||
    value === "grounding_validation_failed" ||
    value === "agent_reply_blocked" ||
    value === "ai_persistence_unconfirmed" ||
    value === "execution_context_mismatch" ||
    value === "candidate_invalid" ||
    value === "no_safe_answer" ||
    value === "missing_approved_fact" ||
    value === "gate_closed" ||
    value === "send_gate_blocked" ||
    value === "tool_failed" ||
    value === "runtime_failed" ||
    value === "recorder_failed"
  ) {
    return value;
  }

  return "runtime_failed";
}

function toManagerAiQualitySeverity(value: string): ManagerAiQualitySummary["severity"] {
  if (value === "info" || value === "warning" || value === "error" || value === "critical") {
    return value;
  }

  throw new Error(`invalid AI quality severity ${value}`);
}

function toCanonicalAiRunAction(value: string) {
  if (value === "answer") return "answer";
  if (value === "clarify") return "ask_clarifying_question";
  if (value === "handoff") return "handoff_to_manager";
  return "no_reply";
}

function toProfileValidatorResult(value: string | undefined) {
  if (value === "pass") return "passed";
  if (value === "repair" || value === "handoff" || value === "block") return "rejected";
  return "not_run";
}

function toGroundedModelEvidence(metadata: Record<string, unknown>, modelName: string | undefined) {
  const provider = readOptionalString(metadata, "model_provider");
  const observedProvider =
    provider === "openai" || provider === "fake" || provider === "policy" || provider === "none"
      ? provider
      : null;
  const configuredProvider =
    observedProvider === "openai" || observedProvider === "fake"
      ? observedProvider
      : observedProvider === "policy" || observedProvider === "none"
        ? "none"
        : null;

  return {
    configuredProvider,
    modelName: modelName ?? null,
    observedProvider,
    observedModelName: observedProvider && observedProvider !== "none" ? (modelName ?? null) : null
  };
}

function toCanonicalDegradationEvidence(reason: string) {
  const outcomeReason =
    reason === "missing_openai_config"
      ? "missing_provider_config"
      : reason === "model_error" ||
          reason === "semantic_verifier_error" ||
          reason === "turn_timeout" ||
          reason === "empty_model_response" ||
          reason === "unsafe_model_response" ||
          reason === "grounding_validation_failed" ||
          reason === "agent_reply_blocked" ||
          reason === "ai_persistence_unconfirmed" ||
          reason === "execution_context_mismatch" ||
          reason === "candidate_invalid" ||
          reason === "no_safe_answer" ||
          reason === "missing_approved_fact" ||
          reason === "gate_closed"
        ? reason
        : null;
  const failureCode =
    reason === "missing_openai_config"
      ? "provider_unavailable"
      : reason === "model_error" ||
          reason === "semantic_verifier_error" ||
          reason === "turn_timeout" ||
          reason === "empty_model_response"
        ? "model_failure"
        : reason === "unsafe_model_response" || reason === "grounding_validation_failed"
          ? "policy_violation"
          : reason === "agent_reply_blocked"
            ? "send_gate_blocked"
            : reason === "ai_persistence_unconfirmed"
              ? "persistence_failure"
              : reason === "execution_context_mismatch"
                ? "execution_context_mismatch"
                : reason === "candidate_invalid"
                  ? "invalid_candidate"
                  : "runtime_failure";

  return { outcomeReason, failureCode };
}

function toAiQualityEvent(
  reason: string
): Pick<ManagerAiQualitySummary, "eventType" | "reasonCode" | "severity"> {
  if (reason === "missing_openai_config") {
    return {
      eventType: "degradation",
      reasonCode: reason,
      severity: "warning"
    };
  }

  if (reason === "model_error" || reason === "semantic_verifier_error") {
    return {
      eventType: "model_failure",
      reasonCode: reason,
      severity: "critical"
    };
  }

  if (reason === "turn_timeout") {
    return {
      eventType: "model_failure",
      reasonCode: reason,
      severity: "error"
    };
  }

  if (
    reason === "empty_model_response" ||
    reason === "unsafe_model_response" ||
    reason === "grounding_validation_failed"
  ) {
    return {
      eventType: "policy_violation",
      reasonCode: reason,
      severity: "error"
    };
  }

  if (reason === "agent_reply_blocked") {
    return { eventType: "blocked", reasonCode: reason, severity: "info" };
  }

  if (reason === "ai_persistence_unconfirmed") {
    return {
      eventType: "runtime_failure",
      reasonCode: reason,
      severity: "critical"
    };
  }

  return {
    eventType: "degradation",
    reasonCode: normalizeReasonCode(reason),
    severity: "warning"
  };
}

function normalizeReasonCode(_value: string): ManagerAiQualitySummary["reasonCode"] {
  return "runtime_failed";
}

function toAiReviewLabel(value: string): AiReviewLabel {
  if (AI_REVIEW_LABELS.includes(value as AiReviewLabel)) {
    return value as AiReviewLabel;
  }

  throw new Error(`invalid AI review label ${value}`);
}

function leadCreatedMetadata(input: AcceptInboundMessageInput, channelIdentityId: string) {
  return {
    channel: input.channel,
    provider: input.provider,
    provider_account_id: input.providerAccountId ?? null,
    external_chat_id: input.externalChatId ?? null,
    external_user_id: input.externalUserId ?? null,
    public_session_id: input.widgetPublicSessionId ?? null,
    source_page_url: input.sourcePageUrl ?? null,
    widget_instance_id: input.widgetInstanceId ?? null,
    channel_identity_id: channelIdentityId,
    automation_status: input.automationRequested ? "enabled" : "disabled"
  };
}

function channelIdentityMetadata(input: AcceptInboundMessageInput) {
  return {
    provider_account_id: input.providerAccountId ?? null,
    external_chat_id: input.externalChatId ?? null,
    external_user_id: input.externalUserId ?? null,
    public_session_id: input.widgetPublicSessionId ?? null,
    widget_instance_id: input.widgetInstanceId ?? null,
    source_page_url: input.sourcePageUrl ?? null
  };
}

function managerNotificationType(reason: NeedsManagerReason) {
  const values: Record<NeedsManagerReason, string> = {
    telegram_new_inbound: "telegram_new_inbound_needs_manager",
    telegram_media: "telegram_media_needs_manager",
    telegram_urgent: "telegram_urgent_needs_manager",
    telegram_human_requested: "telegram_human_requested",
    ai_tool_failure: "ai_tool_failure_needs_manager"
  };

  return values[reason];
}

function telegramManagerNotificationMetadata(input: {
  input: AcceptInboundMessageInput;
  leadId: string;
  publicConversationId: string;
  publicMessageId: string;
  reason: NeedsManagerReason;
  contentType: ConversationContentType;
}) {
  const managerPanelUrl = buildManagerPanelUrl(
    input.input.managerPanelBaseUrl,
    input.leadId,
    input.publicConversationId
  );

  return {
    public_conversation_id: input.publicConversationId,
    public_message_id: input.publicMessageId,
    channel: "telegram",
    content_type: input.contentType,
    needs_manager_reason: input.reason,
    text_preview: truncateText(messageBody(input.input, input.contentType), 240),
    telegram_inline_keyboard: [
      [
        {
          text: "Взять диалог",
          callback_data: `takeover:${input.publicConversationId}`
        },
        {
          text: "Ответить",
          callback_data: `reply:${input.publicConversationId}`
        }
      ],
      [
        {
          text: "Открыть в панели",
          url: managerPanelUrl
        }
      ]
    ]
  };
}

function buildManagerPanelUrl(
  managerPanelBaseUrl: string | undefined,
  leadId: string,
  publicConversationId: string
) {
  const baseUrl = managerPanelBaseUrl?.replace(/\/+$/, "") || "";
  const path = `/manager?leadId=${encodeURIComponent(leadId)}&conversation=${encodeURIComponent(
    publicConversationId
  )}`;

  return baseUrl ? `${baseUrl}${path}` : path;
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function messageBody(input: AcceptInboundMessageInput, contentType: ConversationContentType) {
  if (input.message.text.trim()) {
    return input.message.text;
  }

  if (input.message.caption?.trim()) {
    return input.message.caption;
  }

  return `[${contentType}]`;
}

function toSourceChannel(value: string): ManagerLeadListItem["source"]["channel"] {
  if (value === "site_form" || value === "site_widget" || value === "telegram") {
    return value;
  }

  throw new Error(`invalid lead source channel ${value}`);
}

function toCustomerChannel(value: string): CustomerChannel {
  if (value === "site_widget" || value === "telegram") {
    return value;
  }

  throw new Error(`invalid customer channel ${value}`);
}

function toLeadStatus(value: string): LeadStatus {
  if (!isLeadStatus(value)) {
    throw new Error(`invalid lead status ${value}`);
  }

  return value;
}

function toMessageDeliveryStatus(value: string): MessageDeliveryStatus {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "sent" ||
    value === "failed" ||
    value === "retrying" ||
    value === "blocked_no_destination" ||
    value === "blocked" ||
    value === "uncertain"
  ) {
    return value;
  }

  throw new Error(`invalid message delivery status ${value}`);
}

function toAiState(value: string): AiState {
  if (!isAiState(value)) {
    throw new Error(`invalid AI state ${value}`);
  }

  return value;
}

function readStringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function normalizePreferredContact(value: string | null) {
  if (value === "phone" || value === "whatsapp" || value === "telegram" || value === "email") {
    return value;
  }

  return undefined;
}

function normalizeNextStepChannel(value: string | null): NextStepChannel | undefined {
  if (
    value === "manager_call" ||
    value === "phone" ||
    value === "whatsapp" ||
    value === "telegram" ||
    value === "site_widget" ||
    value === "email"
  ) {
    return value;
  }

  return undefined;
}

function statusRequiresNextStep(status: LeadStatus) {
  return status === "in_progress" || status === "waiting_response";
}

function normalizeContentType(value: unknown): ConversationContentType {
  if (
    value === "voice" ||
    value === "sticker" ||
    value === "video_note" ||
    value === "photo" ||
    value === "document"
  ) {
    return value;
  }

  return "text";
}

function toConversationMessageDirection(
  value: string
): ManagerConversation["messages"][number]["direction"] {
  if (value === "inbound" || value === "outbound") {
    return value;
  }

  throw new Error(`invalid conversation message direction ${value}`);
}

function toConversationSenderRole(
  value: string
): ManagerConversation["messages"][number]["senderRole"] {
  if (value === "visitor" || value === "ai_assistant" || value === "manager") {
    return value;
  }

  throw new Error(`invalid conversation sender role ${value}`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
