import { and, asc, eq, inArray } from "drizzle-orm";

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
  PendingTelegramDelivery,
  RecordTelegramDeliveryFailedInput,
  RecordTelegramDeliverySentInput,
  TelegramDeliveryRepository
} from "../services/telegram-delivery-service.js";

export class PostgresTelegramDeliveryRepository implements TelegramDeliveryRepository {
  constructor(private readonly db: OperationsDb) {}

  async claimPendingTelegramDeliveries(
    input: ClaimPendingTelegramDeliveriesInput
  ): Promise<PendingTelegramDelivery[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));

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
            inArray(messageDeliveries.status, ["pending", "retrying"]),
            eq(conversationMessages.direction, "outbound"),
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
          status: "retrying",
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

      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: "conversation.delivery_sent",
        summary: "Telegram message delivered",
        metadata: {
          delivery_id: input.deliveryId,
          public_conversation_id: input.publicConversationId,
          public_message_id: input.publicMessageId,
          channel: "telegram",
          provider: "telegram_bot",
          delivery_status: "sent",
          attempt_count: input.attemptCount,
          provider_message_id: input.providerMessageId
        },
        createdAt: input.sentAt
      });
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

      await tx.insert(leadTimelineEvents).values({
        leadId: input.leadId,
        eventType: deliveryFailureEventType(input.status),
        summary: deliveryFailureSummary(input.status),
        metadata: {
          delivery_id: input.deliveryId,
          public_conversation_id: input.publicConversationId,
          public_message_id: input.publicMessageId,
          channel: "telegram",
          provider: "telegram_bot",
          delivery_status: input.status,
          attempt_count: input.attemptCount,
          last_error: input.lastError
        },
        createdAt: input.failedAt
      });
    });
  }
}

function deliveryFailureEventType(status: RecordTelegramDeliveryFailedInput["status"]) {
  if (status === "retrying") {
    return "conversation.delivery_retrying";
  }

  if (status === "blocked_no_destination" || status === "blocked") {
    return "conversation.delivery_blocked";
  }

  return "conversation.delivery_failed";
}

function deliveryFailureSummary(status: RecordTelegramDeliveryFailedInput["status"]) {
  if (status === "retrying") {
    return "Telegram delivery failed and will retry";
  }

  if (status === "blocked_no_destination") {
    return "Telegram delivery blocked because no customer destination is stored";
  }

  if (status === "blocked") {
    return "Telegram delivery blocked";
  }

  return "Telegram delivery failed";
}
