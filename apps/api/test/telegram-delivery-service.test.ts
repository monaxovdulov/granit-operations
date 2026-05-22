import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TelegramBotApiDeliveryProvider,
  TelegramDeliveryProviderError,
  TelegramMessageDeliveryService,
  type ClaimPendingTelegramDeliveriesInput,
  type MarkStaleTelegramDeliveriesUncertainInput,
  type PendingTelegramDelivery,
  type RecordTelegramDeliveryFailedInput,
  type RecordTelegramDeliverySentInput,
  type TelegramDeliveryProvider,
  type TelegramDeliveryRepository,
  type TelegramSendMessageOptions,
  type TelegramSendMessagePayload
} from "../src/services/telegram-delivery-service.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Telegram message delivery sender", () => {
  it("turns pending message delivery into a Telegram sendMessage payload and records success", async () => {
    const repository = new FakeTelegramDeliveryRepository([
      pendingDelivery({ body: "Здравствуйте. Уточню детали заказа." })
    ]);
    const provider = new FakeTelegramDeliveryProvider({
      messageId: "tg-sent-1001"
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      retryBackoffMs: 30000
    });
    const abortController = new AbortController();

    const result = await service.deliverPendingBatch(7, { signal: abortController.signal });

    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      retrying: 0,
      failed: 0,
      blocked: 0,
      uncertain: 0
    });
    expect(repository.staleMarks).toHaveLength(1);
    expect(repository.claims).toEqual([
      {
        providerAccountId: "bot-main",
        limit: 7,
        retryBackoffMs: 30000
      }
    ]);
    expect(provider.payloads).toEqual([
      {
        chat_id: "customer-chat-42",
        text: "Здравствуйте. Уточню детали заказа."
      }
    ]);
    expect(provider.signals).toEqual([abortController.signal]);
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

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retrying: 1,
      failed: 0,
      blocked: 0,
      uncertain: 0
    });
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

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retrying: 0,
      failed: 1,
      blocked: 0,
      uncertain: 0
    });
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

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 1,
      uncertain: 0
    });
    expect(provider.payloads).toEqual([]);
    expect(repository.failed[0]).toMatchObject({
      status: "blocked_no_destination",
      attemptCount: 0
    });
  });

  it("records uncertain when the provider result is unknown", async () => {
    const repository = new FakeTelegramDeliveryRepository([pendingDelivery({ attemptCount: 1 })]);
    const provider = new FakeTelegramDeliveryProvider({
      error: new TelegramDeliveryProviderError(
        "Telegram Bot API request timed out",
        false,
        undefined,
        true,
        "timeout"
      )
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      maxAttempts: 3
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 0,
      uncertain: 1
    });
    expect(repository.failed[0]).toMatchObject({
      status: "uncertain",
      attemptCount: 2,
      lastError: "Telegram Bot API request timed out"
    });
  });

  it("keeps interrupted claimed rows retryable when stop is requested before provider send", async () => {
    const repository = new FakeTelegramDeliveryRepository([pendingDelivery({ attemptCount: 1 })]);
    const provider = new FakeTelegramDeliveryProvider({
      messageId: "unused"
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      maxAttempts: 3
    });
    const abortController = new AbortController();
    abortController.abort();

    const result = await service.deliverPendingBatch(undefined, { signal: abortController.signal });

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      retrying: 1,
      failed: 0,
      blocked: 0,
      uncertain: 0
    });
    expect(provider.payloads).toEqual([]);
    expect(repository.failed[0]).toMatchObject({
      status: "retrying",
      attemptCount: 1,
      lastError: "telegram delivery interrupted before provider call"
    });
  });

  it("reports stale processing rows as uncertain without auto-retrying them", async () => {
    const repository = new FakeTelegramDeliveryRepository([], { staleCount: 2 });
    const provider = new FakeTelegramDeliveryProvider({
      messageId: "unused"
    });
    const service = new TelegramMessageDeliveryService(repository, provider, {
      providerAccountId: "bot-main",
      processingStaleMs: 60000
    });

    const result = await service.deliverPendingBatch();

    expect(result).toEqual({
      claimed: 0,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 0,
      uncertain: 2
    });
    expect(repository.claims).toHaveLength(1);
    expect(provider.payloads).toEqual([]);
  });
});

describe("Telegram Bot API delivery provider", () => {
  it("passes an AbortSignal to fetch and reads the Telegram message id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const abortController = new AbortController();
    const provider = new TelegramBotApiDeliveryProvider("bot123:secretToken", { timeoutMs: 5000 });

    const result = await provider.sendMessage(
      {
        chat_id: "customer-chat-42",
        text: "Ответ менеджера"
      },
      { signal: abortController.signal }
    );

    expect(result).toEqual({ messageId: "42" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/botbot123:secretToken/sendMessage",
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("turns provider timeout into an unknown delivery result", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit).signal;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        })
    );
    const provider = new TelegramBotApiDeliveryProvider("bot123:secretToken", { timeoutMs: 10 });

    const promise = provider.sendMessage({
      chat_id: "customer-chat-42",
      text: "Ответ менеджера"
    });
    const assertion = expect(promise).rejects.toMatchObject({
      resultUnknown: true,
      code: "timeout"
    });
    await vi.advanceTimersByTimeAsync(10);

    await assertion;
  });
});

class FakeTelegramDeliveryRepository implements TelegramDeliveryRepository {
  sent: RecordTelegramDeliverySentInput[] = [];
  failed: RecordTelegramDeliveryFailedInput[] = [];
  claims: ClaimPendingTelegramDeliveriesInput[] = [];
  staleMarks: MarkStaleTelegramDeliveriesUncertainInput[] = [];

  constructor(
    private readonly deliveries: PendingTelegramDelivery[],
    private readonly options: { staleCount?: number } = {}
  ) {}

  async claimPendingTelegramDeliveries(
    input: ClaimPendingTelegramDeliveriesInput
  ): Promise<PendingTelegramDelivery[]> {
    this.claims.push(input);
    return this.deliveries;
  }

  async markStaleTelegramDeliveriesUncertain(
    input: MarkStaleTelegramDeliveriesUncertainInput
  ): Promise<number> {
    this.staleMarks.push(input);
    return this.options.staleCount ?? 0;
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
