export type TelegramDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "retrying"
  | "blocked_no_destination"
  | "blocked"
  | "uncertain";

export type PendingTelegramDelivery = {
  deliveryId: string;
  leadId: string;
  conversationMessageId: string;
  publicConversationId: string;
  publicMessageId: string;
  body: string;
  providerAccountId: string | null;
  externalChatId: string | null;
  attemptCount: number;
};

export type ClaimPendingTelegramDeliveriesInput = {
  providerAccountId: string;
  limit: number;
  retryBackoffMs?: number;
};

export type MarkStaleTelegramDeliveriesUncertainInput = {
  providerAccountId: string;
  staleBefore: Date;
  lastError: string;
  markedAt: Date;
  limit?: number;
};

export type RecordTelegramDeliverySentInput = {
  deliveryId: string;
  leadId: string;
  conversationMessageId: string;
  publicConversationId: string;
  publicMessageId: string;
  providerMessageId: string;
  attemptCount: number;
  sentAt: Date;
};

export type RecordTelegramDeliveryFailedInput = {
  deliveryId: string;
  leadId: string;
  publicConversationId: string;
  publicMessageId: string;
  status: Exclude<TelegramDeliveryStatus, "pending" | "processing" | "sent">;
  attemptCount: number;
  lastError: string;
  failedAt: Date;
};

export type TelegramDeliveryRepository = {
  claimPendingTelegramDeliveries(
    input: ClaimPendingTelegramDeliveriesInput
  ): Promise<PendingTelegramDelivery[]>;
  markStaleTelegramDeliveriesUncertain(
    input: MarkStaleTelegramDeliveriesUncertainInput
  ): Promise<number>;
  recordTelegramDeliverySent(input: RecordTelegramDeliverySentInput): Promise<void>;
  recordTelegramDeliveryFailed(input: RecordTelegramDeliveryFailedInput): Promise<void>;
};

export type TelegramSendMessagePayload = {
  chat_id: string;
  text: string;
};

export type TelegramSendMessageResult = {
  messageId: string;
};

export type TelegramSendMessageOptions = {
  signal?: AbortSignal;
};

export type TelegramDeliveryProvider = {
  sendMessage(
    payload: TelegramSendMessagePayload,
    options?: TelegramSendMessageOptions
  ): Promise<TelegramSendMessageResult>;
};

export type TelegramDeliveryBatchResult = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  blocked: number;
  uncertain: number;
};

export type TelegramMessageDeliveryServiceOptions = {
  providerAccountId: string;
  batchSize?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  processingStaleMs?: number;
};

export class TelegramDeliveryProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
    readonly resultUnknown = false,
    readonly code?: "timeout" | "aborted" | "network" | "provider"
  ) {
    super(message);
    this.name = "TelegramDeliveryProviderError";
  }
}

export class TelegramMessageDeliveryService {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly processingStaleMs: number;

  constructor(
    private readonly repository: TelegramDeliveryRepository,
    private readonly provider: TelegramDeliveryProvider,
    private readonly options: TelegramMessageDeliveryServiceOptions
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 0;
    this.processingStaleMs = options.processingStaleMs ?? 300000;
  }

  async deliverPendingBatch(
    limit = this.batchSize,
    input: { signal?: AbortSignal } = {}
  ): Promise<TelegramDeliveryBatchResult> {
    const uncertainFromStaleProcessing =
      await this.repository.markStaleTelegramDeliveriesUncertain({
        providerAccountId: this.options.providerAccountId,
        staleBefore: new Date(Date.now() - this.processingStaleMs),
        lastError: "telegram delivery processing state expired without a known provider result",
        markedAt: new Date(),
        limit
      });
    const deliveries = await this.repository.claimPendingTelegramDeliveries({
      providerAccountId: this.options.providerAccountId,
      limit,
      retryBackoffMs: this.retryBackoffMs
    });
    const result: TelegramDeliveryBatchResult = {
      claimed: deliveries.length,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 0,
      uncertain: uncertainFromStaleProcessing
    };

    for (const delivery of deliveries) {
      if (input.signal?.aborted) {
        await this.repository.recordTelegramDeliveryFailed({
          deliveryId: delivery.deliveryId,
          leadId: delivery.leadId,
          publicConversationId: delivery.publicConversationId,
          publicMessageId: delivery.publicMessageId,
          status: "retrying",
          attemptCount: delivery.attemptCount,
          lastError: "telegram delivery interrupted before provider call",
          failedAt: new Date()
        });
        result.retrying += 1;
        continue;
      }

      if (!delivery.externalChatId) {
        await this.repository.recordTelegramDeliveryFailed({
          deliveryId: delivery.deliveryId,
          leadId: delivery.leadId,
          publicConversationId: delivery.publicConversationId,
          publicMessageId: delivery.publicMessageId,
          status: "blocked_no_destination",
          attemptCount: delivery.attemptCount,
          lastError: "telegram customer chat id is missing",
          failedAt: new Date()
        });
        result.blocked += 1;
        continue;
      }

      const attemptCount = delivery.attemptCount + 1;

      try {
        const sent = await this.provider.sendMessage({
          chat_id: delivery.externalChatId,
          text: delivery.body
        }, input);

        await this.repository.recordTelegramDeliverySent({
          deliveryId: delivery.deliveryId,
          leadId: delivery.leadId,
          conversationMessageId: delivery.conversationMessageId,
          publicConversationId: delivery.publicConversationId,
          publicMessageId: delivery.publicMessageId,
          providerMessageId: sent.messageId,
          attemptCount,
          sentAt: new Date()
        });
        result.sent += 1;
      } catch (error) {
        const deliveryError = normalizeDeliveryError(error);
        const status = deliveryError.resultUnknown
          ? "uncertain"
          : deliveryError.retryable && attemptCount < this.maxAttempts
            ? "retrying"
            : "failed";

        await this.repository.recordTelegramDeliveryFailed({
          deliveryId: delivery.deliveryId,
          leadId: delivery.leadId,
          publicConversationId: delivery.publicConversationId,
          publicMessageId: delivery.publicMessageId,
          status,
          attemptCount,
          lastError: deliveryError.message,
          failedAt: new Date()
        });

        if (status === "uncertain") {
          result.uncertain += 1;
        } else if (status === "retrying") {
          result.retrying += 1;
        } else {
          result.failed += 1;
        }
      }
    }

    return result;
  }
}

export class TelegramBotApiDeliveryProvider implements TelegramDeliveryProvider {
  constructor(
    private readonly botToken: string,
    private readonly options: { timeoutMs?: number } = {}
  ) {}

  async sendMessage(
    payload: TelegramSendMessagePayload,
    options: TelegramSendMessageOptions = {}
  ): Promise<TelegramSendMessageResult> {
    const { signal, cleanup, abortReason } = createProviderAbortSignal(
      this.options.timeoutMs ?? 15000,
      options.signal
    );
    let response: Response;
    let body: Awaited<ReturnType<typeof readTelegramResponseBody>>;

    try {
      response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal
      });
      body = await readTelegramResponseBody(response);
    } catch (error) {
      const reason = abortReason();

      if (reason === "timeout") {
        throw new TelegramDeliveryProviderError(
          "Telegram Bot API request timed out",
          false,
          undefined,
          true,
          "timeout"
        );
      }

      if (reason === "aborted") {
        throw new TelegramDeliveryProviderError(
          "Telegram Bot API request was cancelled",
          false,
          undefined,
          true,
          "aborted"
        );
      }

      throw new TelegramDeliveryProviderError(
        normalizeFetchFailureMessage(error),
        false,
        undefined,
        true,
        "network"
      );
    } finally {
      cleanup();
    }

    if (!response.ok || !body.ok) {
      throw new TelegramDeliveryProviderError(
        truncateError(body.description ?? `Telegram Bot API returned ${response.status}`, 500),
        response.status === 429 || response.status >= 500,
        response.status,
        false,
        "provider"
      );
    }

    const messageId = body.result?.message_id;

    if (typeof messageId !== "number" && typeof messageId !== "string") {
      throw new TelegramDeliveryProviderError("Telegram Bot API response has no message id", false);
    }

    return { messageId: String(messageId) };
  }
}

async function readTelegramResponseBody(response: Response) {
  try {
    const body = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number | string };
    };

    return {
      ok: body.ok === true,
      description: body.description,
      result: body.result
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    return {
      ok: false,
      description: `Telegram Bot API returned non-JSON response ${response.status}`,
      result: undefined
    };
  }
}

function normalizeDeliveryError(error: unknown) {
  if (error instanceof TelegramDeliveryProviderError) {
    return {
      message: truncateError(error.message, 500),
      retryable: error.retryable,
      resultUnknown: error.resultUnknown
    };
  }

  if (error instanceof Error) {
    return {
      message: truncateError(error.message, 500),
      retryable: true,
      resultUnknown: false
    };
  }

  return {
    message: "unknown Telegram delivery error",
    retryable: true,
    resultUnknown: false
  };
}

function truncateError(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function createProviderAbortSignal(timeoutMs: number, parentSignal?: AbortSignal) {
  const abortController = new AbortController();
  let reason: "timeout" | "aborted" | null = parentSignal?.aborted ? "aborted" : null;

  const timeout = setTimeout(() => {
    reason ??= "timeout";
    abortController.abort();
  }, timeoutMs);

  const onAbort = () => {
    reason ??= "aborted";
    abortController.abort();
  };

  if (parentSignal?.aborted) {
    abortController.abort();
  } else {
    parentSignal?.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: abortController.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onAbort);
    },
    abortReason: () => reason
  };
}

function normalizeFetchFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return truncateError(`Telegram Bot API request failed before a known response: ${error.message}`, 500);
  }

  return "Telegram Bot API request failed before a known response";
}
