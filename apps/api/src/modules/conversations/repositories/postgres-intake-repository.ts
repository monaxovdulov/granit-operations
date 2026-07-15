import { randomUUID } from "node:crypto";

import { and, desc, eq, lt, or, sql, type SQLWrapper } from "drizzle-orm";

import {
  aiQualityEvents,
  aiRuns,
  channelIdentities,
  conversationMessages,
  conversations,
  intakeSubmissions,
  leadTimelineEvents,
  leads,
  managerTelegramBindings,
  managerNotificationOutbox,
  managerUsers,
  messageDeliveries,
  widgetSessions,
  type OperationsDb
} from "@granit/db";
import type { SiteFormIntakeRequest, SiteWidgetMessageRequest } from "@granit/contracts";

import {
  completeAiRunInTransaction,
  PostgresAiRunRepository
} from "../../ai/repositories/postgres-ai-run-repository.js";
import type {
  PersistRecordedSiteWidgetAiReplyInput,
  RecordedSiteWidgetAiReplyRepository
} from "../../ai/repositories/recorded-site-widget-ai-reply-repository.js";
import type {
  AiRunTerminalCompletion,
  RunningAiRunRecord
} from "../../ai/repositories/ai-run-repository.js";
import {
  AI_QUALITY_EVENT_TYPES,
  AI_QUALITY_REASON_CODES,
  AI_RUN_STATUSES
} from "../../ai/repositories/ai-run-repository.js";
import type { RecordedLegacyS05PersistReplyResult } from "../../ai/ports/recorded-legacy-s05-turn.js";
import {
  AI_TURN_CONTEXT_CURSOR_VERSION,
  AI_TURN_CONTEXT_MAX_MESSAGES,
  buildSiteWidgetAiTurnExecutionContext,
  buildStageASiteWidgetAiTurnInput,
  type AiTurnContextMessage,
  type AiTurnInput
} from "../../ai/ai-turn.js";
import {
  aiMessageSentTimelineEvent,
  conversationMessageReceivedTimelineEvent,
  inboundLeadCreatedTimelineEvent,
  leadStatusChangedTimelineEvent,
  managerNotificationEnqueuedTimelineEvent,
  managerTakeoverTimelineEvent,
  manualContactRecordedTimelineEvent,
  nextStepUpdatedTimelineEvent,
  publicWidgetManagerReviewTimelineEvent,
  siteFormLeadCreatedTimelineEvent
} from "../../timeline/timeline-events.js";
import type {
  PublicWidgetManagerReviewRepository,
  TransitionSiteWidgetConversationToManagerReviewInput
} from "../../intake/ports/public-widget-manager-review-repository.js";
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
  SiteWidgetAiMessageLookupResult
} from "./conversation-message-repository.js";
import type { IntakeRepository } from "./intake-repository.js";
import type {
  ChangeManagerLeadStatusInput,
  ManagerAiQualitySummary,
  ManagerChannelIdentity,
  ManagerConversation,
  ManagerLeadDetail,
  ManagerLeadListItem,
  RecordManualContactInput,
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
  SaveAcceptedSiteWidgetMessageResult
} from "./public-intake-repository.js";

export class PostgresIntakeRepository
  implements
    IntakeRepository,
    RecordedSiteWidgetAiReplyRepository,
    PublicWidgetManagerReviewRepository
{
  private readonly managerTelegramRepository: PostgresManagerTelegramRepository;
  private readonly aiRunRepository: PostgresAiRunRepository;

  constructor(private readonly db: OperationsDb) {
    this.managerTelegramRepository = new PostgresManagerTelegramRepository(db);
    this.aiRunRepository = new PostgresAiRunRepository(db);
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

  async acceptInboundMessage(input: AcceptInboundMessageInput): Promise<AcceptInboundMessageResult> {
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
        let messageCreatedAt = now;
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
          .limit(1);

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
              aiState: conversations.aiState,
              updatedAt: conversations.updatedAt
            });

          if (!createdConversation) {
            throw new Error("conversation insert returned no row");
          }

          conversation = createdConversation;
          messageCreatedAt = createdConversation.updatedAt;

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

          const [updatedConversation] = await tx
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
              updatedAt: nextConversationMessageTimestamp()
            })
            .where(eq(conversations.id, conversation.id))
            .returning({ updatedAt: conversations.updatedAt });

          if (!updatedConversation) {
            throw new Error("conversation update returned no row");
          }

          messageCreatedAt = updatedConversation.updatedAt;

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
              automation_status: conversation.agentAllowedToReply ? "enabled" : "disabled",
              ...(input.channel === "site_widget"
                ? { ai_context_cursor_version: AI_TURN_CONTEXT_CURSOR_VERSION }
                : {})
            },
            submittedAt: new Date(input.message.submittedAt),
            createdAt: messageCreatedAt
          })
          .returning({
            id: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId
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
            createdAt: messageCreatedAt
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
            createdAt: messageCreatedAt
          });
        }

        const previousMessagesNewestFirst =
          input.channel === "site_widget"
            ? await loadPreviousAiTurnContextMessages(tx, conversation.id, message.id)
            : [];
        const aiTurnInput = buildSiteWidgetAiTurnInput(
          input,
          {
            publicConversationId: conversation.publicConversationId,
            publicMessageId: message.publicMessageId,
            publicSessionId: widgetSession?.publicSessionId,
            agentAllowedToReply: conversation.agentAllowedToReply,
            aiState: toAiState(conversation.aiState)
          },
          previousMessagesNewestFirst
        );

        return {
          leadId: conversation.leadId,
          conversationId: conversation.id,
          publicConversationId: conversation.publicConversationId,
          channelIdentityId: identity.id,
          inboundMessageId: message.id,
          publicMessageId: message.publicMessageId,
          widgetPublicSessionId: widgetSession?.publicSessionId ?? undefined,
          agentAllowedToReply: conversation.agentAllowedToReply,
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
            : undefined
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
      agentAllowedToReply: result.agentAllowedToReply,
      aiState: result.aiState,
      replayed: result.replayed,
      aiReply: result.existingAiReply,
      aiTurnInput: result.aiTurnInput,
      aiTurnExecutionContext: result.aiTurnExecutionContext
    };
  }

  async transitionSiteWidgetConversationToManagerReview(
    input: TransitionSiteWidgetConversationToManagerReviewInput
  ): Promise<void> {
    await this.db.transaction((tx) =>
      this.transitionSiteWidgetConversationToManagerReviewInTransaction(tx, input)
    );
  }

  private async transitionSiteWidgetConversationToManagerReviewInTransaction(
    tx: Transaction,
    input: SiteWidgetManagerReviewTransitionTarget
  ): Promise<void> {
    const [linkedInbound] = await tx
      .select({
        conversationId: conversations.id,
        publicConversationId: conversations.publicConversationId,
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(
        and(
          eq(conversationMessages.id, input.inboundMessageId),
          eq(conversationMessages.publicMessageId, input.inboundPublicMessageId),
          eq(conversationMessages.leadId, input.leadId),
          eq(conversationMessages.direction, "inbound"),
          eq(conversations.id, input.conversationId),
          eq(conversations.leadId, input.leadId),
          input.publicConversationId
            ? eq(conversations.publicConversationId, input.publicConversationId)
            : undefined,
          eq(conversations.channel, "site_widget")
        )
      )
      .limit(1);

    if (!linkedInbound) {
      throw new Error("site widget inbound linkage not found for manager review transition");
    }

    if (
      !linkedInbound.agentAllowedToReply &&
      (linkedInbound.aiState === "needs_manager" || linkedInbound.aiState === "manager_active")
    ) {
      return;
    }

    const [transitioned] = await tx
      .update(conversations)
      .set({
        agentAllowedToReply: false,
        aiState: sql<AiState>`CASE
            WHEN ${conversations.aiState} = 'manager_active' THEN 'manager_active'
            ELSE 'needs_manager'
          END`,
        updatedAt: nextConversationMessageTimestamp()
      })
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.leadId, input.leadId),
          eq(conversations.publicConversationId, linkedInbound.publicConversationId),
          or(
            eq(conversations.agentAllowedToReply, true),
            sql`${conversations.aiState} NOT IN ('needs_manager', 'manager_active')`
          )
        )
      )
      .returning({ updatedAt: conversations.updatedAt });

    if (!transitioned) {
      const [current] = await tx
        .select({
          agentAllowedToReply: conversations.agentAllowedToReply,
          aiState: conversations.aiState
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.leadId, input.leadId),
            eq(conversations.publicConversationId, linkedInbound.publicConversationId)
          )
        )
        .limit(1);

      if (
        current &&
        !current.agentAllowedToReply &&
        (current.aiState === "needs_manager" || current.aiState === "manager_active")
      ) {
        return;
      }

      throw new Error("site widget manager review transition was not persisted");
    }

    await tx
      .update(leads)
      .set({ updatedAt: transitioned.updatedAt })
      .where(eq(leads.id, input.leadId));

    await tx.insert(leadTimelineEvents).values(
      publicWidgetManagerReviewTimelineEvent({
        leadId: input.leadId,
        publicConversationId: linkedInbound.publicConversationId,
        inboundPublicMessageId: input.inboundPublicMessageId,
        reason: input.reason,
        createdAt: transitioned.updatedAt
      })
    );
  }

  async persistAiReplyWithSendGate(
    input: PersistAiReplyWithSendGateInput
  ): Promise<SaveSiteWidgetAiMessageResult> {
    if (input.channel === "telegram") {
      throw new TelegramOutboundBlockedError();
    }

    try {
      const existing = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey, {
        conversationId: input.conversationId,
        leadId: input.leadId
      });

      if (existing) {
        return this.replayExistingAiMessage(existing, input.requestFingerprint);
      }

      return await this.db.transaction(async (tx) => {
        const nextAiState =
          input.agentAllowedToReplyAfterSend === false ? "needs_manager" : "ai_collecting_info";
        const [sendGate] = await tx
          .update(conversations)
          .set({
            agentAllowedToReply: input.agentAllowedToReplyAfterSend ?? true,
            aiState: nextAiState,
            updatedAt: nextConversationMessageTimestamp()
          })
          .where(
            and(
              eq(conversations.id, input.conversationId),
              eq(conversations.leadId, input.leadId),
              eq(conversations.agentAllowedToReply, true)
            )
          )
          .returning({
            id: conversations.id,
            leadId: conversations.leadId,
            publicConversationId: conversations.publicConversationId,
            channelIdentityId: conversations.channelIdentityId,
            updatedAt: conversations.updatedAt
          });

        if (!sendGate) {
          const replay = await this.findExistingAiMessageByIdempotencyKey(
            input.idempotencyKey,
            { conversationId: input.conversationId, leadId: input.leadId },
            tx
          );

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

        const sentAt = sendGate.updatedAt;

        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: input.conversationId,
            leadId: input.leadId,
            channelIdentityId: sendGate.channelIdentityId ?? null,
            direction: "outbound",
            senderRole: "ai_assistant",
            body: input.body,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            sourcePageUrl: input.sourcePageUrl ?? null,
            contentType: "text",
            metadata: {
              ...input.metadata,
              public_conversation_id: sendGate.publicConversationId
            },
            submittedAt: sentAt,
            createdAt: sentAt
          })
          .returning({
            internalMessageId: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId,
            body: conversationMessages.body,
            createdAt: conversationMessages.createdAt
          });

        if (!message) {
          throw new Error("AI message insert returned no row");
        }

        await tx
          .update(leads)
          .set({
            updatedAt: sentAt
          })
          .where(eq(leads.id, input.leadId));

        await tx.insert(leadTimelineEvents).values(
          aiMessageSentTimelineEvent({
            leadId: input.leadId,
            channel: input.channel,
            publicMessageId: message.publicMessageId,
            inboundPublicMessageId: input.inboundPublicMessageId,
            publicConversationId: sendGate.publicConversationId,
            metadata: input.metadata,
            createdAt: sentAt
          })
        );

        return {
          internalMessageId: message.internalMessageId,
          publicMessageId: message.publicMessageId,
          body: message.body,
          createdAt: message.createdAt.toISOString()
        };
      });
    } catch (error) {
      if (error instanceof AgentReplyBlockedError) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        const replay = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey, {
          conversationId: input.conversationId,
          leadId: input.leadId
        });

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

  async persistRecordedSiteWidgetAiReply(
    input: PersistRecordedSiteWidgetAiReplyInput
  ): Promise<RecordedLegacyS05PersistReplyResult> {
    assertRecordedReplyMatchesRun(input);

    const existing = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey, {
      conversationId: input.run.conversationId,
      leadId: input.run.leadId
    });
    if (existing) {
      return this.replayRecordedAiReply(existing, input);
    }

    const gateStartedAt = new Date();

    try {
      const transactionResult = await this.db.transaction(async (tx) => {
        const nextAiState =
          input.reply.action === "handoff_to_manager" ? "needs_manager" : "ai_collecting_info";
        const [sendGate] = await tx
          .update(conversations)
          .set({
            agentAllowedToReply:
              input.reply.action === "handoff_to_manager" ? false : true,
            aiState: nextAiState,
            updatedAt: nextConversationMessageTimestamp()
          })
          .where(
            and(
              eq(conversations.id, input.run.conversationId),
              eq(conversations.leadId, input.run.leadId),
              eq(conversations.agentAllowedToReply, true)
            )
          )
          .returning({
            id: conversations.id,
            leadId: conversations.leadId,
            publicConversationId: conversations.publicConversationId,
            channelIdentityId: conversations.channelIdentityId,
            updatedAt: conversations.updatedAt
          });

        if (!sendGate) {
          const replay = await this.findExistingAiMessageByIdempotencyKey(
            input.idempotencyKey,
            { conversationId: input.run.conversationId, leadId: input.run.leadId },
            tx
          );

          if (replay) {
            return { kind: "replay" as const, replay };
          }

          const [existingConversation] = await tx
            .select({ id: conversations.id, leadId: conversations.leadId })
            .from(conversations)
            .where(eq(conversations.id, input.run.conversationId))
            .limit(1);

          if (!existingConversation || existingConversation.leadId !== input.run.leadId) {
            throw new Error("conversation not found for recorded AI reply");
          }

          const blockedAt = new Date();
          const blockedCompletion = withRecordedPersistenceSpans(
            input.run,
            input.completionPlan.agentReplyBlocked,
            blockedAt,
            [
              {
                spanId: randomUUID(),
                kind: "send_gate",
                name: "send_gate_check",
                status: "blocked",
                latencyMs: elapsedMilliseconds(gateStartedAt, blockedAt),
                errorCode: "send_gate_blocked",
                usedInFinalAnswer: false
              }
            ]
          );
          const completedRun = await completeAiRunInTransaction(tx, {
            run: input.run,
            completion: blockedCompletion
          });

          return { kind: "blocked" as const, completedRun };
        }

        const gateCompletedAt = new Date();
        const sentAt = sendGate.updatedAt;
        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: input.run.conversationId,
            leadId: input.run.leadId,
            channelIdentityId: sendGate.channelIdentityId ?? null,
            direction: "outbound",
            senderRole: "ai_assistant",
            body: input.reply.replyDraft,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            sourcePageUrl: input.sourcePageUrl,
            contentType: "text",
            metadata: {
              ...input.metadata,
              public_conversation_id: sendGate.publicConversationId
            },
            submittedAt: sentAt,
            createdAt: sentAt
          })
          .returning({
            internalMessageId: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId,
            body: conversationMessages.body,
            createdAt: conversationMessages.createdAt
          });

        if (!message) {
          throw new Error("recorded AI message insert returned no row");
        }

        await tx
          .update(leads)
          .set({ updatedAt: sentAt })
          .where(eq(leads.id, input.run.leadId));

        await tx.insert(leadTimelineEvents).values(
          aiMessageSentTimelineEvent({
            leadId: input.run.leadId,
            channel: "site_widget",
            publicMessageId: message.publicMessageId,
            inboundPublicMessageId: input.inboundPublicMessageId,
            publicConversationId: sendGate.publicConversationId,
            metadata: input.metadata,
            createdAt: sentAt
          })
        );

        const persistedAt = new Date();
        const allowedCompletion = {
          ...withRecordedPersistenceSpans(
            input.run,
            input.completionPlan.allowed,
            persistedAt,
            [
              {
                spanId: randomUUID(),
                kind: "send_gate" as const,
                name: "send_gate_check" as const,
                status: "succeeded" as const,
                latencyMs: elapsedMilliseconds(gateStartedAt, gateCompletedAt),
                usedInFinalAnswer: true
              },
              {
                spanId: randomUUID(),
                kind: "runtime" as const,
                name: "reply_persistence" as const,
                status: "succeeded" as const,
                latencyMs: elapsedMilliseconds(gateCompletedAt, persistedAt),
                usedInFinalAnswer: true
              }
            ]
          ),
          sendGateCheckedAt: gateCompletedAt
        };
        const completedRun = await completeAiRunInTransaction(tx, {
          run: input.run,
          completion: allowedCompletion,
          outboundMessageId: message.internalMessageId
        });

        return { kind: "persisted" as const, message, completedRun };
      });

      if (transactionResult.kind === "replay") {
        return this.replayRecordedAiReply(transactionResult.replay, input);
      }

      if (transactionResult.kind === "blocked") {
        return {
          status: "blocked",
          reason: "agent_reply_blocked",
          completedRun: transactionResult.completedRun
        };
      }

      return {
        status: "persisted",
        internalMessageId: transactionResult.message.internalMessageId,
        publicMessageId: transactionResult.message.publicMessageId,
        body: transactionResult.message.body,
        completedRun: transactionResult.completedRun
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey, {
          conversationId: input.run.conversationId,
          leadId: input.run.leadId
        });
        if (replay) {
          return this.replayRecordedAiReply(replay, input);
        }
      }

      const failedAt = new Date();
      const failureCompletion = withRecordedPersistenceSpans(
        input.run,
        input.completionPlan.persistenceUnconfirmed,
        failedAt,
        [
          {
            spanId: randomUUID(),
            kind: "runtime",
            name: "reply_persistence",
            status: "failed",
            latencyMs: elapsedMilliseconds(gateStartedAt, failedAt),
            errorCode: "persistence_failed",
            usedInFinalAnswer: false
          }
        ]
      );

      try {
        const completedRun = await this.db.transaction(async (tx) => {
          const completed = await completeAiRunInTransaction(tx, {
            run: input.run,
            completion: failureCompletion
          });
          await this.transitionSiteWidgetConversationToManagerReviewInTransaction(tx, {
            leadId: input.run.leadId,
            conversationId: input.run.conversationId,
            inboundMessageId: input.run.inboundMessageId,
            inboundPublicMessageId: input.inboundPublicMessageId,
            reason: "ai_reply_persistence_unconfirmed"
          });
          return completed;
        });
        return {
          status: "blocked",
          reason: "ai_persistence_unconfirmed",
          completedRun
        };
      } catch {
        const replay = await this.findExistingAiMessageByIdempotencyKey(input.idempotencyKey, {
          conversationId: input.run.conversationId,
          leadId: input.run.leadId
        });
        if (replay) {
          return this.replayRecordedAiReply(replay, input);
        }
        throw error;
      }
    }
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

    const timelineRows = await this.db
      .select()
      .from(leadTimelineEvents)
      .where(eq(leadTimelineEvents.leadId, leadId))
      .orderBy(leadTimelineEvents.createdAt);

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
      conversations: await this.listManagerConversations(leadId),
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
        .limit(1);

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

  private async replayRecordedAiReply(
    existing: SiteWidgetAiMessageLookupResult,
    input: PersistRecordedSiteWidgetAiReplyInput
  ): Promise<RecordedLegacyS05PersistReplyResult> {
    const message = this.replayExistingAiMessage(existing, input.requestFingerprint);
    const replay = await this.aiRunRepository.beginOrReplay(input.run);

    if (
      replay.kind !== "terminal_replay" ||
      (replay.run.status !== "persisted" && replay.run.status !== "handed_off") ||
      replay.run.outboundMessageId !== message.internalMessageId
    ) {
      throw new Error("recorded AI reply replay linkage is inconsistent");
    }

    return {
      status: "persisted",
      internalMessageId: message.internalMessageId,
      publicMessageId: message.publicMessageId,
      body: message.body,
      completedRun: replay.run
    };
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
        inboundMessageId: conversationMessages.id,
        publicConversationId: conversations.publicConversationId,
        channel: conversations.channel,
        agentAllowedToReply: conversations.agentAllowedToReply,
        aiState: conversations.aiState,
        messageChannelIdentityId: conversationMessages.channelIdentityId,
        conversationChannelIdentityId: conversations.channelIdentityId,
        publicSessionId: widgetSessions.publicSessionId,
        widgetInstanceId: conversations.widgetInstanceId,
        sessionWidgetInstanceId: widgetSessions.widgetInstanceId,
        referrerUrl: widgetSessions.referrerUrl,
        pageTitle: widgetSessions.pageTitle,
        visitorContext: widgetSessions.visitorContext,
        publicMessageId: conversationMessages.publicMessageId,
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
    idempotencyKey: string,
    scope: { conversationId: string; leadId: string },
    reader: ConversationMessageReader = this.db
  ): Promise<SiteWidgetAiMessageLookupResult | null> {
    const [existing] = await reader
      .select({
        internalMessageId: conversationMessages.id,
        publicMessageId: conversationMessages.publicMessageId,
        body: conversationMessages.body,
        createdAt: conversationMessages.createdAt,
        requestFingerprint: conversationMessages.requestFingerprint
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.idempotencyKey, idempotencyKey),
          eq(conversationMessages.direction, "outbound"),
          eq(conversationMessages.senderRole, "ai_assistant"),
          eq(conversationMessages.conversationId, scope.conversationId),
          eq(conversationMessages.leadId, scope.leadId)
        )
      )
      .limit(1);

    return existing
      ? {
          internalMessageId: existing.internalMessageId,
          publicMessageId: existing.publicMessageId,
          body: existing.body,
          createdAt: existing.createdAt.toISOString(),
          requestFingerprint: existing.requestFingerprint
        }
      : null;
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
        and(
          eq(conversations.leadId, leadId),
          eq(widgetSessions.publicSessionId, publicSessionId)
        )
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
        .selectDistinctOn([aiQualityEvents.conversationId], {
          conversationId: aiQualityEvents.conversationId,
          eventType: aiQualityEvents.eventType,
          reasonCode: aiQualityEvents.reasonCode,
          severity: aiQualityEvents.severity,
          runStatus: aiRuns.status,
          createdAt: aiQualityEvents.createdAt
        })
        .from(aiQualityEvents)
        .innerJoin(
          aiRuns,
          and(
            eq(aiRuns.id, aiQualityEvents.aiRunId),
            eq(aiRuns.leadId, aiQualityEvents.leadId),
            eq(aiRuns.conversationId, aiQualityEvents.conversationId)
          )
        )
        .where(
          and(
            eq(aiQualityEvents.leadId, leadId),
            eq(aiQualityEvents.managerVisible, true),
            eq(aiQualityEvents.resolutionStatus, "open")
          )
        )
        .orderBy(
          aiQualityEvents.conversationId,
          desc(aiQualityEvents.createdAt),
          desc(aiQualityEvents.id)
        )
    ]);

    const byConversation = new Map<string, ManagerConversation>();
    const latestQualityByConversation = new Map<string, ManagerAiQualitySummary>(
      qualityRows.map((row) => [
        row.conversationId,
        {
          eventType: controlledAiValue(AI_QUALITY_EVENT_TYPES, row.eventType, "quality event type"),
          reasonCode: controlledAiValue(
            AI_QUALITY_REASON_CODES,
            row.reasonCode,
            "quality reason code"
          ),
          severity: controlledAiValue(
            ["info", "warning", "error", "critical"] as const,
            row.severity,
            "quality severity"
          ),
          runStatus: controlledAiValue(AI_RUN_STATUSES, row.runStatus, "AI run status"),
          createdAt: row.createdAt.toISOString()
        }
      ])
    );

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
          sourcePageUrl: row.conversation.sourcePageUrl ?? undefined,
          createdAt: row.conversation.createdAt.toISOString(),
          updatedAt: row.conversation.updatedAt.toISOString(),
          latestUnresolvedAiQuality: latestQualityByConversation.get(row.conversation.id),
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
      inboundMessageId: string;
      publicConversationId: string;
      channel: string;
      agentAllowedToReply: boolean;
      aiState: string;
      messageChannelIdentityId: string | null;
      conversationChannelIdentityId: string | null;
      publicSessionId: string | null;
      widgetInstanceId: string | null;
      sessionWidgetInstanceId: string | null;
      referrerUrl: string | null;
      pageTitle: string | null;
      visitorContext: Record<string, unknown> | null;
      publicMessageId: string;
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
      `ai:${existing.publicMessageId}`,
      { conversationId: existing.conversationId, leadId: existing.leadId }
    );
    const previousMessagesNewestFirst =
      existing.channel === "site_widget"
        ? await loadPreviousAiTurnContextMessages(
            this.db,
            existing.conversationId,
            existing.inboundMessageId
          )
        : [];
    const aiTurnInput = buildPersistedSiteWidgetAiTurnInput(
      existing,
      previousMessagesNewestFirst
    );

    return {
      leadId: existing.leadId,
      conversationId: existing.conversationId,
      publicConversationId: existing.publicConversationId,
      channelIdentityId:
        existing.messageChannelIdentityId ?? existing.conversationChannelIdentityId ?? "",
      inboundMessageId: existing.inboundMessageId,
      publicMessageId: existing.publicMessageId,
      widgetPublicSessionId: existing.publicSessionId ?? undefined,
      agentAllowedToReply: existing.agentAllowedToReply,
      aiState: toAiState(existing.aiState),
      replayed: true,
      existingAiReply: existingAiReply
        ? {
            internalMessageId: existingAiReply.internalMessageId,
            publicMessageId: existingAiReply.publicMessageId,
            body: existingAiReply.body,
            createdAt: existingAiReply.createdAt
          }
        : undefined,
      aiTurnInput,
      aiTurnExecutionContext: aiTurnInput
        ? buildSiteWidgetAiTurnExecutionContext({
            leadId: existing.leadId,
            conversationId: existing.conversationId,
            inboundMessageId: existing.inboundMessageId,
            publicConversationId: existing.publicConversationId,
            publicInboundMessageId: existing.publicMessageId,
            requestFingerprint: existing.requestFingerprint
          })
        : undefined
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
      internalMessageId: existing.internalMessageId,
      publicMessageId: existing.publicMessageId,
      body: existing.body,
      createdAt: existing.createdAt
    };
  }
}

type Transaction = Parameters<Parameters<OperationsDb["transaction"]>[0]>[0];
type SiteWidgetManagerReviewTransitionTarget = Omit<
  TransitionSiteWidgetConversationToManagerReviewInput,
  "publicConversationId"
> & {
  publicConversationId?: string;
};

function assertRecordedReplyMatchesRun(input: PersistRecordedSiteWidgetAiReplyInput): void {
  const context = input.reply.executionContext;
  const expectedAllowedStatus =
    input.reply.action === "handoff_to_manager" ? "handed_off" : "persisted";

  if (
    context.internal.leadId !== input.run.leadId ||
    context.internal.conversationId !== input.run.conversationId ||
    context.internal.inboundMessageId !== input.run.inboundMessageId ||
    context.turn.idempotencyKey !== input.run.idempotencyKey ||
    context.turn.inputFingerprint !== input.run.inputFingerprint ||
    context.public.inboundMessageId !== input.inboundPublicMessageId ||
    input.idempotencyKey !== `ai:${input.inboundPublicMessageId}` ||
    input.completionPlan.allowed.status !== expectedAllowedStatus ||
    input.completionPlan.allowed.normalizedAction !== input.reply.action ||
    input.completionPlan.allowed.sendGateResult !== "allowed" ||
    input.completionPlan.agentReplyBlocked.status !== "blocked" ||
    input.completionPlan.agentReplyBlocked.normalizedAction !== input.reply.action ||
    input.completionPlan.agentReplyBlocked.sendGateResult !== "blocked" ||
    input.completionPlan.persistenceUnconfirmed.status !== "failed" ||
    input.completionPlan.persistenceUnconfirmed.normalizedAction !== input.reply.action ||
    input.completionPlan.persistenceUnconfirmed.sendGateResult !== "not_checked"
  ) {
    throw new Error("recorded AI reply does not match its run completion plan");
  }
}

function withRecordedPersistenceSpans(
  run: RunningAiRunRecord,
  completion: AiRunTerminalCompletion,
  completedAt: Date,
  spans: AiRunTerminalCompletion["spans"]
): AiRunTerminalCompletion {
  return {
    ...completion,
    sendGateCheckedAt:
      completion.sendGateResult === "not_checked" ? undefined : completedAt,
    completedAt,
    latencyMs: elapsedMilliseconds(run.startedAt, completedAt),
    spans: [...completion.spans, ...spans]
  };
}

function elapsedMilliseconds(startedAt: Date, completedAt: Date): number {
  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

function nextConversationMessageTimestamp() {
  // Updating the conversation row serializes message writes for one conversation. The one
  // millisecond increment survives the PostgreSQL -> JavaScript Date precision boundary, so the
  // returned value remains strictly newer even when two writes share the same wall-clock tick.
  return sql<Date>`GREATEST(
    clock_timestamp(),
    ${conversations.updatedAt} + interval '1 millisecond',
    COALESCE(
      (
        SELECT MAX(${conversationMessages.createdAt}) + interval '1 millisecond'
        FROM ${conversationMessages}
        WHERE ${conversationMessages.conversationId} = ${conversations.id}
      ),
      clock_timestamp()
    )
  )`;
}

function nextAiStateForInbound(currentAiState: string, needsManager: boolean): AiState {
  const current = toAiState(currentAiState);

  if (!needsManager) {
    return current;
  }

  return current === "manager_active" ? "manager_active" : "needs_manager";
}

function buildSiteWidgetAiTurnInput(
  input: AcceptInboundMessageInput,
  accepted: {
    publicConversationId: string;
    publicMessageId: string;
    publicSessionId?: string;
    agentAllowedToReply: boolean;
    aiState: AiState;
  },
  previousMessagesNewestFirst: AiTurnContextMessage[]
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
    previousMessagesNewestFirst
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
  previousMessagesNewestFirst: AiTurnContextMessage[]
): AiTurnInput | undefined {
  const pageUrl = input.sourcePageUrl ?? input.conversationSourcePageUrl;
  const widgetInstanceId = input.widgetInstanceId ?? input.sessionWidgetInstanceId;

  if (
    input.channel !== "site_widget" ||
    !input.publicSessionId ||
    !pageUrl ||
    !widgetInstanceId
  ) {
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
    previousMessagesNewestFirst
  });
}

type ConversationMessageReader = Pick<OperationsDb, "select">;

async function loadPreviousAiTurnContextMessages(
  reader: ConversationMessageReader,
  conversationId: string,
  throughInboundMessageId: string
): Promise<AiTurnContextMessage[]> {
  const [anchor] = await reader
    .select({
      createdAt: conversationMessages.createdAt,
      metadata: conversationMessages.metadata
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, throughInboundMessageId),
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.direction, "inbound"),
        eq(conversationMessages.senderRole, "visitor"),
        eq(conversationMessages.contentType, "text")
      )
    )
    .limit(1);

  if (!anchor) {
    throw new Error("accepted inbound message anchor not found for AI turn context");
  }

  if (
    readOptionalString(anchor.metadata, "ai_context_cursor_version") !==
    AI_TURN_CONTEXT_CURSOR_VERSION
  ) {
    // Pre-P1 rows have no causal cursor guarantee. Returning only the current inbound (added by
    // buildBoundedAiTurnContext) is safer than pulling a potentially later same-timestamp row.
    return [];
  }

  const rows = await reader
    .select({
      publicMessageId: conversationMessages.publicMessageId,
      direction: conversationMessages.direction,
      senderRole: conversationMessages.senderRole,
      body: conversationMessages.body,
      submittedAt: conversationMessages.submittedAt
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        eq(conversationMessages.contentType, "text"),
        or(
          and(
            eq(conversationMessages.direction, "inbound"),
            eq(conversationMessages.senderRole, "visitor")
          ),
          and(
            eq(conversationMessages.direction, "outbound"),
            eq(conversationMessages.senderRole, "ai_assistant")
          )
        ),
        lt(conversationMessages.createdAt, anchor.createdAt)
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(AI_TURN_CONTEXT_MAX_MESSAGES - 1);

  return rows.map((row): AiTurnContextMessage => {
    if (row.direction === "inbound" && row.senderRole === "visitor") {
      return {
        publicMessageId: row.publicMessageId,
        direction: "inbound",
        senderRole: "visitor",
        contentType: "text",
        submittedAt: row.submittedAt.toISOString(),
        text: row.body
      };
    }

    if (row.direction === "outbound" && row.senderRole === "ai_assistant") {
      return {
        publicMessageId: row.publicMessageId,
        direction: "outbound",
        senderRole: "ai_assistant",
        contentType: "text",
        submittedAt: row.submittedAt.toISOString(),
        text: row.body
      };
    }

    throw new Error("unsafe conversation message reached AI turn context mapping");
  });
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
        eq(
          managerTelegramBindings.providerAccountId,
          input.input.providerAccountId ?? ""
        ),
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
      inboundMessageId: conversationMessages.id,
      publicConversationId: conversations.publicConversationId,
      channel: conversations.channel,
      agentAllowedToReply: conversations.agentAllowedToReply,
      aiState: conversations.aiState,
      messageChannelIdentityId: conversationMessages.channelIdentityId,
      conversationChannelIdentityId: conversations.channelIdentityId,
      publicSessionId: widgetSessions.publicSessionId,
      widgetInstanceId: conversations.widgetInstanceId,
      sessionWidgetInstanceId: widgetSessions.widgetInstanceId,
      referrerUrl: widgetSessions.referrerUrl,
      pageTitle: widgetSessions.pageTitle,
      visitorContext: widgetSessions.visitorContext,
      publicMessageId: conversationMessages.publicMessageId,
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
      input.contact?.name ?? input.displayName ?? (input.channel === "telegram" ? "Telegram" : "Site visitor"),
    contactPhone: input.contact?.phone ?? null,
    contactEmail: input.contact?.email ?? null,
    contactPreferred: input.contact?.preferredContact ?? (input.channel === "telegram" ? "telegram" : null),
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

function controlledAiValue<const Values extends readonly string[]>(
  values: Values,
  value: string,
  label: string
): Values[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`invalid ${label} ${value}`);
  }

  return value as Values[number];
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
