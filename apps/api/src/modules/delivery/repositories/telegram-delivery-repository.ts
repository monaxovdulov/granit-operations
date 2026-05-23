import { and, asc, eq, inArray, lt, or } from "drizzle-orm";

import {
  channelIdentities,
  conversationMessages,
  conversations,
  leadTimelineEvents,
  messageDeliveries,
  type OperationsDb
} from "@granit/db";

import type {
  ClaimPendingTelegramDeliveriesInput,
  MarkStaleTelegramDeliveriesUncertainInput,
  PendingTelegramDelivery,
  RecordTelegramDeliveryFailedInput,
  RecordTelegramDeliverySentInput,
  TelegramDeliveryRepository
} from "../services/telegram-delivery-service.js";
import {
  deliveryFailureTimelineEvent,
  deliverySentTimelineEvent,
  deliveryUncertainTimelineEvent
} from "../../timeline/timeline-events.js";

export class PostgresTelegramDeliveryRepository implements TelegramDeliveryRepository {
  constructor(private readonly db: OperationsDb) {}

  async claimPendingTelegramDeliveries(
    input: ClaimPendingTelegramDeliveriesInput
  ): Promise<PendingTelegramDelivery[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const retryBackoffMs = Math.max(0, input.retryBackoffMs ?? 0);
    const retryEligibleBefore = new Date(Date.now() - retryBackoffMs);

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          deliveryId: messageDeliveries.id,
          leadId: conversations.leadId,
          conversationMessageId: conversationMessages.id,
          publicConversationId: conversations.publicConversationId,
          publicMessageId: conversationMessages.publicMessageId,
          body: conversationMessages.body,
          providerAccountId: channelIdentities.providerAccountId,
          externalChatId: channelIdentities.externalChatId,
          attemptCount: messageDeliveries.attemptCount
        })
        .from(messageDeliveries)
        .innerJoin(
          conversationMessages,
          eq(messageDeliveries.conversationMessageId, conversationMessages.id)
        )
        .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
        .innerJoin(channelIdentities, eq(conversationMessages.channelIdentityId, channelIdentities.id))
        .where(
          and(
            eq(messageDeliveries.channel, "telegram"),
            eq(messageDeliveries.provider, "telegram_bot"),
            or(
              eq(messageDeliveries.status, "pending"),
              and(
                eq(messageDeliveries.status, "retrying"),
                lt(messageDeliveries.updatedAt, retryEligibleBefore)
              )
            ),
            eq(conversationMessages.direction, "outbound"),
            eq(conversationMessages.senderRole, "manager"),
            eq(channelIdentities.channel, "telegram"),
            eq(channelIdentities.provider, "telegram_bot"),
            eq(channelIdentities.providerAccountId, input.providerAccountId)
          )
        )
        .orderBy(asc(messageDeliveries.updatedAt), asc(messageDeliveries.createdAt))
        .limit(limit)
        .for("update", { of: messageDeliveries, skipLocked: true });

      if (!rows.length) {
        return [];
      }

      await tx
        .update(messageDeliveries)
        .set({
          status: "processing",
          updatedAt: new Date()
        })
        .where(
          inArray(
            messageDeliveries.id,
            rows.map((row) => row.deliveryId)
          )
        );

      return rows;
    });
  }

  async markStaleTelegramDeliveriesUncertain(
    input: MarkStaleTelegramDeliveriesUncertainInput
  ): Promise<number> {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 100));

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          deliveryId: messageDeliveries.id,
          leadId: conversations.leadId,
          publicConversationId: conversations.publicConversationId,
          publicMessageId: conversationMessages.publicMessageId,
          attemptCount: messageDeliveries.attemptCount
        })
        .from(messageDeliveries)
        .innerJoin(
          conversationMessages,
          eq(messageDeliveries.conversationMessageId, conversationMessages.id)
        )
        .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
        .innerJoin(channelIdentities, eq(conversationMessages.channelIdentityId, channelIdentities.id))
        .where(
          and(
            eq(messageDeliveries.channel, "telegram"),
            eq(messageDeliveries.provider, "telegram_bot"),
            eq(messageDeliveries.status, "processing"),
            lt(messageDeliveries.updatedAt, input.staleBefore),
            eq(conversationMessages.direction, "outbound"),
            eq(conversationMessages.senderRole, "manager"),
            eq(channelIdentities.channel, "telegram"),
            eq(channelIdentities.provider, "telegram_bot"),
            eq(channelIdentities.providerAccountId, input.providerAccountId)
          )
        )
        .orderBy(asc(messageDeliveries.updatedAt), asc(messageDeliveries.createdAt))
        .limit(limit)
        .for("update", { of: messageDeliveries, skipLocked: true });

      if (!rows.length) {
        return 0;
      }

      await tx
        .update(messageDeliveries)
        .set({
          status: "uncertain",
          lastError: input.lastError,
          updatedAt: input.markedAt
        })
        .where(
          inArray(
            messageDeliveries.id,
            rows.map((row) => row.deliveryId)
          )
        );

      await tx.insert(leadTimelineEvents).values(
        rows.map((row) =>
          deliveryUncertainTimelineEvent({
            leadId: row.leadId,
            deliveryId: row.deliveryId,
            publicConversationId: row.publicConversationId,
            publicMessageId: row.publicMessageId,
            attemptCount: row.attemptCount,
            lastError: input.lastError,
            createdAt: input.markedAt
          })
        )
      );

      return rows.length;
    });
  }

  async recordTelegramDeliverySent(input: RecordTelegramDeliverySentInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(messageDeliveries)
        .set({
          status: "sent",
          attemptCount: input.attemptCount,
          lastError: null,
          providerMessageId: input.providerMessageId,
          updatedAt: input.sentAt
        })
        .where(eq(messageDeliveries.id, input.deliveryId));

      await tx
        .update(conversationMessages)
        .set({
          providerMessageId: input.providerMessageId,
          providerSentAt: input.sentAt
        })
        .where(eq(conversationMessages.id, input.conversationMessageId));

      await tx.insert(leadTimelineEvents).values(
        deliverySentTimelineEvent({
          leadId: input.leadId,
          deliveryId: input.deliveryId,
          publicConversationId: input.publicConversationId,
          publicMessageId: input.publicMessageId,
          attemptCount: input.attemptCount,
          providerMessageId: input.providerMessageId,
          createdAt: input.sentAt
        })
      );
    });
  }

  async recordTelegramDeliveryFailed(input: RecordTelegramDeliveryFailedInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(messageDeliveries)
        .set({
          status: input.status,
          attemptCount: input.attemptCount,
          lastError: input.lastError,
          updatedAt: input.failedAt
        })
        .where(eq(messageDeliveries.id, input.deliveryId));

      await tx.insert(leadTimelineEvents).values(deliveryFailureTimelineEvent(input));
    });
  }
}
