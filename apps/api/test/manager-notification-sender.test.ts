import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TelegramDeliveryProviderError,
  type TelegramDeliveryProvider,
  type TelegramSendMessageOptions,
  type TelegramSendMessagePayload
} from "../src/modules/delivery/services/telegram-delivery-service.js";
import {
  ManagerNotificationSenderService,
  type ClaimPendingManagerNotificationsInput,
  type ManagerNotificationRepository,
  type PendingManagerNotification,
  type RecordManagerNotificationFailedInput,
  type RecordManagerNotificationSentInput
} from "../src/modules/manager-notifications/services/manager-notification-sender-service.js";

describe("Manager notification sender", () => {
  it("turns a pending manager notification into a Telegram sendMessage and records success", async () => {
    const repository = new FakeManagerNotificationRepository([
      pendingNotification({
        textPreview: "Клиент просит связаться сегодня",
        replyMarkup: {
          inline_keyboard: [
            [
              { text: "Взять диалог", callback_data: "takeover:conversation-public-1" },
              { text: "Ответить", callback_data: "reply:conversation-public-1" }
            ]
          ]
        }
      })
    ]);
    const provider = new FakeTelegramProvider({ messageId: "manager-notification-1001" });
    const service = new ManagerNotificationSenderService(repository, provider, {
      providerAccountId: "bot-main",
      retryBackoffMs: 30000
    });
    const abortController = new AbortController();

    const result = await service.deliverPendingBatch(5, { signal: abortController.signal });

    expect(result).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0, blocked: 0 });
    expect(repository.claims).toEqual([
      {
        providerAccountId: "bot-main",
        limit: 5,
        retryBackoffMs: 30000
      }
    ]);
    expect(provider.payloads).toEqual([
      {
        chat_id: "manager-chat-42",
        text: [
          "Новое сообщение клиента в Telegram",
          "Тип: text",
          "Причина: telegram_urgent",
          "Сообщение: Клиент просит связаться сегодня"
        ].join("\n"),
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Взять диалог", callback_data: "takeover:conversation-public-1" },
              { text: "Ответить", callback_data: "reply:conversation-public-1" }
            ]
          ]
        }
      }
    ]);
    expect(provider.signals).toEqual([abortController.signal]);
    expect(repository.sent).toHaveLength(1);
    expect(repository.sent[0]).toMatchObject({
      notificationId: "notification-1",
      providerMessageId: "manager-notification-1001",
      attemptCount: 1
    });
    expect(repository.sent[0]?.sentAt).toBeInstanceOf(Date);
  });

  it("blocks a notification without a manager destination before provider send", async () => {
    const repository = new FakeManagerNotificationRepository([
      pendingNotification({ externalChatId: null })
    ]);
    const provider = new FakeTelegramProvider({ messageId: "unused" });
    const service = new ManagerNotificationSenderService(repository, provider, {
      providerAccountId: "bot-main"
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({ claimed: 1, sent: 0, retrying: 0, failed: 0, blocked: 1 });
    expect(provider.payloads).toEqual([]);
    expect(repository.failed[0]).toMatchObject({
      notificationId: "notification-1",
      status: "blocked_no_destination",
      attemptCount: 0,
      lastError: "manager Telegram destination is missing or inactive"
    });
    expect(repository.failed[0]?.failedAt).toBeInstanceOf(Date);
  });

  it("includes the structured intake in an AI handoff notification", async () => {
    const repository = new FakeManagerNotificationRepository([
      pendingNotification({
        notificationType: "site_widget_ai_handoff",
        textPreview: "Клиент просит финальный расчет",
        needsManagerReason: "final_quote_pressure",
        slots: {
          monumentType: "двойной",
          material: "черный гранит",
          size: "120 на 60"
        }
      })
    ]);
    const provider = new FakeTelegramProvider({ messageId: "handoff-1" });
    const service = new ManagerNotificationSenderService(repository, provider, {
      providerAccountId: "bot-main"
    });

    await service.deliverPendingBatch();

    expect(provider.payloads[0]?.text).toContain("AI передал диалог сайта менеджеру");
    expect(provider.payloads[0]?.text).toContain(
      "Заявка: тип: двойной; материал: черный гранит; размер: 120 на 60"
    );
  });

  it("records retrying and then failed for retryable provider errors with a bounded retry budget", async () => {
    const repository = new FakeManagerNotificationRepository([
      pendingNotification({ attemptCount: 0 })
    ]);
    const provider = new FakeTelegramProvider({
      error: new TelegramDeliveryProviderError("Too Many Requests", true, 429)
    });
    const service = new ManagerNotificationSenderService(repository, provider, {
      providerAccountId: "bot-main",
      maxAttempts: 2
    });

    const first = await service.deliverPendingBatch();
    const second = await service.deliverPendingBatch();

    expect(first).toEqual({ claimed: 1, sent: 0, retrying: 1, failed: 0, blocked: 0 });
    expect(second).toEqual({ claimed: 1, sent: 0, retrying: 0, failed: 1, blocked: 0 });
    expect(repository.failed).toHaveLength(2);
    expect(repository.failed[0]).toMatchObject({
      status: "retrying",
      attemptCount: 1,
      lastError: "Too Many Requests"
    });
    expect(repository.failed[1]).toMatchObject({
      status: "failed",
      attemptCount: 2,
      lastError: "Too Many Requests"
    });
  });

  it("does not read from or update the customer message delivery queue", () => {
    const apiSrc = path.join(process.cwd(), "apps/api/src");
    const serviceSource = readFileSync(
      path.join(
        apiSrc,
        "modules/manager-notifications/services/manager-notification-sender-service.ts"
      ),
      "utf8"
    );
    const repositorySource = readFileSync(
      path.join(
        apiSrc,
        "modules/manager-notifications/repositories/manager-notification-outbox-repository.ts"
      ),
      "utf8"
    );
    const scriptSource = readFileSync(
      path.join(apiSrc, "scripts/deliver-manager-notifications-once.ts"),
      "utf8"
    );
    const combinedSource = [serviceSource, repositorySource, scriptSource].join("\n");

    expect(combinedSource).not.toContain("messageDeliveries");
    expect(combinedSource).not.toContain("message_deliveries");
    expect(combinedSource).not.toContain("PostgresTelegramDeliveryRepository");
    expect(combinedSource).not.toContain("TelegramMessageDeliveryService");
  });
});

class FakeManagerNotificationRepository implements ManagerNotificationRepository {
  sent: RecordManagerNotificationSentInput[] = [];
  failed: RecordManagerNotificationFailedInput[] = [];
  claims: ClaimPendingManagerNotificationsInput[] = [];

  constructor(private readonly notifications: FakeNotificationRow[]) {}

  async claimPendingManagerNotifications(
    input: ClaimPendingManagerNotificationsInput
  ): Promise<PendingManagerNotification[]> {
    this.claims.push(input);

    return this.notifications
      .filter(
        (notification) => notification.status === "pending" || notification.status === "retrying"
      )
      .map(({ status: _status, ...notification }) => notification);
  }

  async recordManagerNotificationSent(input: RecordManagerNotificationSentInput): Promise<void> {
    this.sent.push(input);
    this.updateNotification(input.notificationId, {
      status: "sent",
      attemptCount: input.attemptCount,
      lastError: null,
      providerMessageId: input.providerMessageId,
      updatedAt: input.sentAt
    });
  }

  async recordManagerNotificationFailed(
    input: RecordManagerNotificationFailedInput
  ): Promise<void> {
    this.failed.push(input);
    this.updateNotification(input.notificationId, {
      status: input.status,
      attemptCount: input.attemptCount,
      lastError: input.lastError,
      updatedAt: input.failedAt
    });
  }

  private updateNotification(
    notificationId: string,
    patch: Pick<
      FakeNotificationRow,
      "status" | "attemptCount" | "lastError" | "updatedAt"
    > & { providerMessageId?: string }
  ) {
    const notification = this.notifications.find((row) => row.notificationId === notificationId);

    if (!notification) {
      throw new Error(`notification ${notificationId} not found`);
    }

    Object.assign(notification, patch);
  }
}

class FakeTelegramProvider implements TelegramDeliveryProvider {
  payloads: TelegramSendMessagePayload[] = [];
  signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly options: { messageId?: string; error?: Error }) {}

  async sendMessage(payload: TelegramSendMessagePayload, options?: TelegramSendMessageOptions) {
    this.payloads.push(payload);
    this.signals.push(options?.signal);

    if (this.options.error) {
      throw this.options.error;
    }

    return { messageId: this.options.messageId ?? "telegram-message-1" };
  }
}

type FakeNotificationRow = PendingManagerNotification & {
  status: "pending" | "sent" | "failed" | "retrying" | "blocked_no_destination";
  lastError?: string | null;
  providerMessageId?: string;
  updatedAt?: Date;
};

function pendingNotification(overrides: Partial<FakeNotificationRow> = {}): FakeNotificationRow {
  return {
    notificationId: "notification-1",
    leadId: "lead-1",
    publicConversationId: "conversation-public-1",
    publicMessageId: "message-public-1",
    notificationType: "telegram_urgent_needs_manager",
    destinationKind: "manager_telegram_private",
    externalChatId: "manager-chat-42",
    attemptCount: 0,
    textPreview: "Клиент написал в Telegram",
    contentType: "text",
    needsManagerReason: "telegram_urgent",
    status: "pending",
    ...overrides
  };
}
