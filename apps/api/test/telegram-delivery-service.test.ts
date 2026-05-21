import { describe, expect, it } from "vitest";

import {
  TelegramDeliveryProviderError,
  TelegramMessageDeliveryService,
  type PendingTelegramDelivery,
  type RecordTelegramDeliveryFailedInput,
  type RecordTelegramDeliverySentInput,
  type TelegramDeliveryProvider,
  type TelegramDeliveryRepository,
  type TelegramSendMessagePayload
} from "../src/services/telegram-delivery-service.js";

describe("Telegram message delivery sender", () => {
  it("turns pending message delivery into a Telegram sendMessage payload and records success", async () => {
    const repository = new FakeTelegramDeliveryRepository([
      pendingDelivery({ body: "Здравствуйте. Уточню детали заказа." })
    ]);
    const provider = new FakeTelegramDeliveryProvider({
      messageId: "tg-sent-1001"
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main"
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0, blocked: 0 });
    expect(provider.payloads).toEqual([
      {
        chat_id: "customer-chat-42",
        text: "Здравствуйте. Уточню детали заказа."
      }
    ]);
    expect(repository.sent).toHaveLength(1);
    expect(repository.sent[0]).toMatchObject({
      deliveryId: "delivery-1",
      providerMessageId: "tg-sent-1001",
      attemptCount: 1
    });
  });

  it("records retrying for retryable provider failures before max attempts", async () => {
    const repository = new FakeTelegramDeliveryRepository([
      pendingDelivery({ attemptCount: 1 })
    ]);
    const provider = new FakeTelegramDeliveryProvider({
      error: new TelegramDeliveryProviderError("Too Many Requests", true, 429)
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      maxAttempts: 3
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({ claimed: 1, sent: 0, retrying: 1, failed: 0, blocked: 0 });
    expect(repository.failed[0]).toMatchObject({
      deliveryId: "delivery-1",
      status: "retrying",
      attemptCount: 2,
      lastError: "Too Many Requests"
    });
  });

  it("records failed when the retry budget is exhausted", async () => {
    const repository = new FakeTelegramDeliveryRepository([
      pendingDelivery({ attemptCount: 2 })
    ]);
    const provider = new FakeTelegramDeliveryProvider({
      error: new TelegramDeliveryProviderError("Bad Gateway", true, 502)
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      maxAttempts: 3
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({ claimed: 1, sent: 0, retrying: 0, failed: 1, blocked: 0 });
    expect(repository.failed[0]).toMatchObject({
      status: "failed",
      attemptCount: 3,
      lastError: "Bad Gateway"
    });
  });

  it("blocks rows without a customer Telegram destination before provider send", async () => {
    const repository = new FakeTelegramDeliveryRepository([
      pendingDelivery({ externalChatId: null })
    ]);
    const provider = new FakeTelegramDeliveryProvider({
      messageId: "unused"
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main"
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({ claimed: 1, sent: 0, retrying: 0, failed: 0, blocked: 1 });
    expect(provider.payloads).toEqual([]);
    expect(repository.failed[0]).toMatchObject({
      status: "blocked_no_destination",
      attemptCount: 0
    });
  });
});

class FakeTelegramDeliveryRepository implements TelegramDeliveryRepository {
  sent: RecordTelegramDeliverySentInput[] = [];
  failed: RecordTelegramDeliveryFailedInput[] = [];

  constructor(private readonly deliveries: PendingTelegramDelivery[]) {}

  async claimPendingTelegramDeliveries(): Promise<PendingTelegramDelivery[]> {
    return this.deliveries;
  }

  async recordTelegramDeliverySent(input: RecordTelegramDeliverySentInput): Promise<void> {
    this.sent.push(input);
  }

  async recordTelegramDeliveryFailed(input: RecordTelegramDeliveryFailedInput): Promise<void> {
    this.failed.push(input);
  }
}

class FakeTelegramDeliveryProvider implements TelegramDeliveryProvider {
  payloads: TelegramSendMessagePayload[] = [];

  constructor(private readonly options: { messageId?: string; error?: Error }) {}

  async sendMessage(payload: TelegramSendMessagePayload) {
    this.payloads.push(payload);

    if (this.options.error) {
      throw this.options.error;
    }

    return { messageId: this.options.messageId ?? "telegram-message-1" };
  }
}

function pendingDelivery(overrides: Partial<PendingTelegramDelivery> = {}): PendingTelegramDelivery {
  return {
    deliveryId: "delivery-1",
    leadId: "lead-1",
    conversationMessageId: "message-1",
    publicConversationId: "conversation-public-1",
    publicMessageId: "message-public-1",
    body: "Ответ менеджера клиенту",
    providerAccountId: "bot-main",
    externalChatId: "customer-chat-42",
    attemptCount: 0,
    ...overrides
  };
}
