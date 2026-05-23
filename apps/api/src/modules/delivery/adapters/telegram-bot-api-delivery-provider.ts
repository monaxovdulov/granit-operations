import {
  TelegramDeliveryProviderError,
  type TelegramDeliveryProvider,
  type TelegramSendMessageOptions,
  type TelegramSendMessagePayload,
  type TelegramSendMessageResult
} from "../services/telegram-delivery-service.js";

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
    return truncateError(
      `Telegram Bot API request failed before a known response: ${error.message}`,
      500
    );
  }

  return "Telegram Bot API request failed before a known response";
}

function truncateError(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
