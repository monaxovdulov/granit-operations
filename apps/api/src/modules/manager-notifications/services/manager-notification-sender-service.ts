import {
  TelegramDeliveryProviderError,
  type TelegramDeliveryProvider,
  type TelegramReplyMarkup
} from "../../delivery/services/telegram-delivery-service.js";

export type ManagerNotificationStatus =
  | "pending"
  | "sent"
  | "failed"
  | "retrying"
  | "blocked_no_destination";

export type PendingManagerNotification = {
  notificationId: string;
  leadId: string;
  publicConversationId?: string;
  publicMessageId?: string;
  notificationType: string;
  destinationKind: string;
  externalChatId: string | null;
  attemptCount: number;
  textPreview?: string;
  contentType?: string;
  needsManagerReason?: string;
  replyMarkup?: TelegramReplyMarkup;
};

export type ClaimPendingManagerNotificationsInput = {
  providerAccountId: string;
  limit: number;
  retryBackoffMs?: number;
};

export type RecordManagerNotificationSentInput = {
  notificationId: string;
  leadId: string;
  publicConversationId?: string;
  publicMessageId?: string;
  providerMessageId: string;
  attemptCount: number;
  sentAt: Date;
};

export type RecordManagerNotificationFailedInput = {
  notificationId: string;
  leadId: string;
  publicConversationId?: string;
  publicMessageId?: string;
  status: Exclude<ManagerNotificationStatus, "pending" | "sent">;
  attemptCount: number;
  lastError: string;
  failedAt: Date;
};

export type ManagerNotificationRepository = {
  claimPendingManagerNotifications(
    input: ClaimPendingManagerNotificationsInput
  ): Promise<PendingManagerNotification[]>;
  recordManagerNotificationSent(input: RecordManagerNotificationSentInput): Promise<void>;
  recordManagerNotificationFailed(input: RecordManagerNotificationFailedInput): Promise<void>;
};

export type ManagerNotificationBatchResult = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  blocked: number;
};

export type ManagerNotificationSenderServiceOptions = {
  providerAccountId: string;
  batchSize?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
};

export class ManagerNotificationSenderService {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly repository: ManagerNotificationRepository,
    private readonly provider: TelegramDeliveryProvider,
    private readonly options: ManagerNotificationSenderServiceOptions
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 0;
  }

  async deliverPendingBatch(
    limit = this.batchSize,
    input: { signal?: AbortSignal } = {}
  ): Promise<ManagerNotificationBatchResult> {
    const notifications = await this.repository.claimPendingManagerNotifications({
      providerAccountId: this.options.providerAccountId,
      limit,
      retryBackoffMs: this.retryBackoffMs
    });
    const result: ManagerNotificationBatchResult = {
      claimed: notifications.length,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 0
    };

    for (const notification of notifications) {
      if (input.signal?.aborted) {
        await this.repository.recordManagerNotificationFailed({
          notificationId: notification.notificationId,
          leadId: notification.leadId,
          publicConversationId: notification.publicConversationId,
          publicMessageId: notification.publicMessageId,
          status: "retrying",
          attemptCount: notification.attemptCount,
          lastError: "manager notification interrupted before provider call",
          failedAt: new Date()
        });
        result.retrying += 1;
        continue;
      }

      if (!notification.externalChatId) {
        await this.repository.recordManagerNotificationFailed({
          notificationId: notification.notificationId,
          leadId: notification.leadId,
          publicConversationId: notification.publicConversationId,
          publicMessageId: notification.publicMessageId,
          status: "blocked_no_destination",
          attemptCount: notification.attemptCount,
          lastError: "manager Telegram destination is missing or inactive",
          failedAt: new Date()
        });
        result.blocked += 1;
        continue;
      }

      const attemptCount = notification.attemptCount + 1;

      try {
        const sent = await this.provider.sendMessage(
          {
            chat_id: notification.externalChatId,
            text: buildNotificationText(notification),
            ...(notification.replyMarkup ? { reply_markup: notification.replyMarkup } : {})
          },
          input
        );

        await this.repository.recordManagerNotificationSent({
          notificationId: notification.notificationId,
          leadId: notification.leadId,
          publicConversationId: notification.publicConversationId,
          publicMessageId: notification.publicMessageId,
          providerMessageId: sent.messageId,
          attemptCount,
          sentAt: new Date()
        });
        result.sent += 1;
      } catch (error) {
        const notificationError = normalizeNotificationError(error);
        const status =
          notificationError.retryable && attemptCount < this.maxAttempts ? "retrying" : "failed";

        await this.repository.recordManagerNotificationFailed({
          notificationId: notification.notificationId,
          leadId: notification.leadId,
          publicConversationId: notification.publicConversationId,
          publicMessageId: notification.publicMessageId,
          status,
          attemptCount,
          lastError: notificationError.message,
          failedAt: new Date()
        });

        if (status === "retrying") {
          result.retrying += 1;
        } else {
          result.failed += 1;
        }
      }
    }

    return result;
  }
}

function buildNotificationText(notification: PendingManagerNotification) {
  const lines = [
    "Новое сообщение клиента в Telegram",
    notification.contentType ? `Тип: ${notification.contentType}` : undefined,
    notification.needsManagerReason ? `Причина: ${notification.needsManagerReason}` : undefined,
    notification.textPreview ? `Сообщение: ${truncateText(notification.textPreview, 2800)}` : undefined
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function normalizeNotificationError(error: unknown) {
  if (error instanceof TelegramDeliveryProviderError) {
    return {
      message: truncateText(error.message, 500),
      retryable: error.retryable || error.resultUnknown
    };
  }

  if (error instanceof Error) {
    return {
      message: truncateText(error.message, 500),
      retryable: true
    };
  }

  return {
    message: "unknown manager notification delivery error",
    retryable: true
  };
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
