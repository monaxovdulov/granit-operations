export type TelegramDeliveryStatus =
  | "pending"
  | "sent"
  | "failed"
  | "retrying"
  | "blocked_no_destination"
  | "blocked";

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
  status: Exclude<TelegramDeliveryStatus, "pending" | "sent">;
  attemptCount: number;
  lastError: string;
  failedAt: Date;
};

export type TelegramDeliveryRepository = {
  claimPendingTelegramDeliveries(
    input: ClaimPendingTelegramDeliveriesInput
  ): Promise<PendingTelegramDelivery[]>;
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

export type TelegramDeliveryProvider = {
  sendMessage(payload: TelegramSendMessagePayload): Promise<TelegramSendMessageResult>;
};

export type TelegramDeliveryBatchResult = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  blocked: number;
};

export type TelegramMessageDeliveryServiceOptions = {
  providerAccountId: string;
  batchSize?: number;
  maxAttempts?: number;
};

export class TelegramDeliveryProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "TelegramDeliveryProviderError";
  }
}

export class TelegramMessageDeliveryService {
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repository: TelegramDeliveryRepository,
    private readonly provider: TelegramDeliveryProvider,
    private readonly options: TelegramMessageDeliveryServiceOptions
  ) {
    this.batchSize = options.batchSize ?? 10;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async deliverPendingBatch(limit = this.batchSize): Promise<TelegramDeliveryBatchResult> {
    const deliveries = await this.repository.claimPendingTelegramDeliveries({
      providerAccountId: this.options.providerAccountId,
      limit
    });
    const result: TelegramDeliveryBatchResult = {
      claimed: deliveries.length,
      sent: 0,
      retrying: 0,
      failed: 0,
      blocked: 0
    };

    for (const delivery of deliveries) {
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
        });

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
        const status =
          deliveryError.retryable && attemptCount < this.maxAttempts ? "retrying" : "failed";

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

export class TelegramBotApiDeliveryProvider implements TelegramDeliveryProvider {
  constructor(private readonly botToken: string) {}

  async sendMessage(payload: TelegramSendMessagePayload): Promise<TelegramSendMessageResult> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const body = await readTelegramResponseBody(response);

    if (!response.ok || !body.ok) {
      throw new TelegramDeliveryProviderError(
        truncateError(body.description ?? `Telegram Bot API returned ${response.status}`, 500),
        response.status === 429 || response.status >= 500,
        response.status
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
  } catch {
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
      retryable: error.retryable
    };
  }

  if (error instanceof Error) {
    return {
      message: truncateError(error.message, 500),
      retryable: true
    };
  }

  return {
    message: "unknown Telegram delivery error",
    retryable: true
  };
}

function truncateError(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
