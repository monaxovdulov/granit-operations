import { and, asc, eq, isNull, lt, or } from "drizzle-orm";

import {
  leadTimelineEvents,
  managerNotificationOutbox,
  managerTelegramBindings,
  type OperationsDb
} from "@granit/db";

import {
  managerNotificationFailureTimelineEvent,
  managerNotificationSentTimelineEvent
} from "../../timeline/timeline-events.js";
import type {
  ClaimPendingManagerNotificationsInput,
  ManagerNotificationRepository,
  PendingManagerNotification,
  RecordManagerNotificationFailedInput,
  RecordManagerNotificationSentInput
} from "../services/manager-notification-sender-service.js";
import type { TelegramReplyMarkup } from "../../delivery/services/telegram-delivery-service.js";

export class PostgresManagerNotificationOutboxRepository
  implements ManagerNotificationRepository
{
  constructor(private readonly db: OperationsDb) {}

  async claimPendingManagerNotifications(
    input: ClaimPendingManagerNotificationsInput
  ): Promise<PendingManagerNotification[]> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const retryBackoffMs = Math.max(0, input.retryBackoffMs ?? 0);
    const retryEligibleBefore = new Date(Date.now() - retryBackoffMs);

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          notificationId: managerNotificationOutbox.id,
          leadId: managerNotificationOutbox.leadId,
          notificationType: managerNotificationOutbox.notificationType,
          destinationKind: managerNotificationOutbox.destinationKind,
          attemptCount: managerNotificationOutbox.attemptCount,
          metadata: managerNotificationOutbox.metadata,
          externalChatId: managerTelegramBindings.externalChatId,
          bindingProvider: managerTelegramBindings.provider,
          bindingProviderAccountId: managerTelegramBindings.providerAccountId,
          bindingStatus: managerTelegramBindings.status
        })
        .from(managerNotificationOutbox)
        .leftJoin(
          managerTelegramBindings,
          eq(managerNotificationOutbox.managerTelegramBindingId, managerTelegramBindings.id)
        )
        .where(
          and(
            eq(managerNotificationOutbox.provider, "telegram_bot"),
            eq(managerNotificationOutbox.destinationKind, "manager_telegram_private"),
            or(
              eq(managerNotificationOutbox.status, "pending"),
              and(
                eq(managerNotificationOutbox.status, "retrying"),
                lt(managerNotificationOutbox.updatedAt, retryEligibleBefore)
              )
            ),
            or(
              isNull(managerNotificationOutbox.managerTelegramBindingId),
              eq(managerTelegramBindings.providerAccountId, input.providerAccountId)
            )
          )
        )
        .orderBy(asc(managerNotificationOutbox.updatedAt), asc(managerNotificationOutbox.createdAt))
        .limit(limit)
        .for("update", { of: managerNotificationOutbox, skipLocked: true });

      return rows.map((row) => {
        const metadata = row.metadata ?? {};
        const hasActiveDestination =
          row.bindingProvider === "telegram_bot" &&
          row.bindingProviderAccountId === input.providerAccountId &&
          row.bindingStatus === "active" &&
          Boolean(row.externalChatId);

        return {
          notificationId: row.notificationId,
          leadId: row.leadId,
          publicConversationId: metadataString(metadata, "public_conversation_id"),
          publicMessageId: metadataString(metadata, "public_message_id"),
          notificationType: row.notificationType,
          destinationKind: row.destinationKind,
          externalChatId: hasActiveDestination ? row.externalChatId : null,
          attemptCount: row.attemptCount,
          textPreview: metadataString(metadata, "text_preview"),
          contentType: metadataString(metadata, "content_type"),
          needsManagerReason: metadataString(metadata, "needs_manager_reason"),
          slots: metadataRecord(metadata, "slots"),
          replyMarkup: parseTelegramReplyMarkup(metadata)
        };
      });
    });
  }

  async recordManagerNotificationSent(input: RecordManagerNotificationSentInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(managerNotificationOutbox)
        .set({
          status: "sent",
          attemptCount: input.attemptCount,
          lastError: null,
          providerMessageId: input.providerMessageId,
          updatedAt: input.sentAt
        })
        .where(eq(managerNotificationOutbox.id, input.notificationId));

      await tx.insert(leadTimelineEvents).values(managerNotificationSentTimelineEvent(input));
    });
  }

  async recordManagerNotificationFailed(
    input: RecordManagerNotificationFailedInput
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(managerNotificationOutbox)
        .set({
          status: input.status,
          attemptCount: input.attemptCount,
          lastError: input.lastError,
          updatedAt: input.failedAt
        })
        .where(eq(managerNotificationOutbox.id, input.notificationId));

      await tx.insert(leadTimelineEvents).values(managerNotificationFailureTimelineEvent(input));
    });
  }
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function metadataRecord(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseTelegramReplyMarkup(
  metadata: Record<string, unknown>
): TelegramReplyMarkup | undefined {
  const keyboard = metadata.telegram_inline_keyboard;

  if (!Array.isArray(keyboard)) {
    return undefined;
  }

  const inlineKeyboard = keyboard
    .map((row) =>
      Array.isArray(row) ? row.map(parseInlineKeyboardButton).filter(isTelegramButton) : []
    )
    .filter((row) => row.length > 0);

  return inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined;
}

function parseInlineKeyboardButton(
  value: unknown
): TelegramReplyMarkup["inline_keyboard"][number][number] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const text = candidate.text;

  if (typeof text !== "string" || !text.trim()) {
    return undefined;
  }

  const callbackData = candidate.callback_data;
  const url = candidate.url;

  if (typeof callbackData === "string" && callbackData.trim()) {
    return { text, callback_data: callbackData };
  }

  if (typeof url === "string" && url.trim()) {
    return { text, url };
  }

  return { text };
}

function isTelegramButton(
  value: TelegramReplyMarkup["inline_keyboard"][number][number] | undefined
): value is TelegramReplyMarkup["inline_keyboard"][number][number] {
  return Boolean(value);
}
