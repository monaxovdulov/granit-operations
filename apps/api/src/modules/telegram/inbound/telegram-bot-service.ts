import { randomUUID } from "node:crypto";

import { sha256Hex, stableStringify } from "@granit/shared";

import {
  ManagerTelegramReplyContextMissingError,
  ManagerTelegramReplyRequiresTakeoverError,
  type ConversationContentType,
  type NeedsManagerReason
} from "../../conversations/repositories/lead-conversation-types.js";
import type { TelegramInboundUseCases } from "./use-cases/telegram-inbound-use-cases.js";

export type TelegramBotServiceOptions = {
  enabled: boolean;
  providerAccountId?: string;
  webhookSecret?: string;
  publicManagerBaseUrl?: string;
};

export type TelegramWebhookResult = {
  ok: true;
  status:
    | "accepted"
    | "bound_manager"
    | "bind_token_invalid"
    | "bind_token_expired"
    | "bind_token_used"
    | "manager_cancelled_reply_context"
    | "manager_takeover_done"
    | "manager_reply_context_created"
    | "manager_reply_requires_takeover"
    | "manager_reply_context_missing"
    | "manager_reply_queued"
    | "manager_forbidden"
    | "manager_unbound"
    | "ignored_manager_message_without_context"
    | "ignored_command"
    | "ignored_unsupported_update";
};

export class TelegramBotService {
  constructor(
    private readonly useCases: TelegramInboundUseCases,
    private readonly options: TelegramBotServiceOptions
  ) {}

  get enabled() {
    return this.options.enabled;
  }

  get configured() {
    return Boolean(this.options.providerAccountId && this.options.webhookSecret);
  }

  validateSecret(secret: string | undefined) {
    return Boolean(this.options.webhookSecret && secret === this.options.webhookSecret);
  }

  async handleUpdate(rawUpdate: unknown): Promise<TelegramWebhookResult> {
    const update = readTelegramUpdate(rawUpdate);

    if (!update) {
      return { ok: true, status: "ignored_unsupported_update" };
    }

    if (update.callback_query) {
      return this.handleCallbackQuery(update.update_id, update.callback_query);
    }

    if (update.message) {
      return this.handleMessage(update.update_id, update.message);
    }

    return { ok: true, status: "ignored_unsupported_update" };
  }

  private async handleMessage(
    updateId: number,
    message: TelegramMessage
  ): Promise<TelegramWebhookResult> {
    const providerAccountId = requiredProviderAccountId(this.options);
    const chatId = String(message.chat.id);
    const from = message.from;
    const text = message.text?.trim() ?? "";
    const startToken = readStartToken(text);

    if (!isPrivateChat(message.chat) || !from) {
      return { ok: true, status: "ignored_unsupported_update" };
    }

    if (startToken) {
      const result = await this.useCases.bindManagerTelegramChat({
        token: startToken,
        providerAccountId,
        externalChatId: chatId,
        externalUserId: from ? String(from.id) : undefined,
        username: from?.username,
        displayName: telegramDisplayName(from),
        providerUpdateId: String(updateId),
        providerMessageId: String(message.message_id)
      });

      if (result.status === "bound") {
        return { ok: true, status: "bound_manager" };
      }

      if (result.status === "expired_token") {
        return { ok: true, status: "bind_token_expired" };
      }

      if (result.status === "used_token") {
        return { ok: true, status: "bind_token_used" };
      }

      return { ok: true, status: "bind_token_invalid" };
    }

    const actor = await this.useCases.findManagerTelegramActor({
      providerAccountId,
      externalChatId: chatId,
      externalUserId: from ? String(from.id) : undefined,
      username: from?.username,
      displayName: telegramDisplayName(from)
    });

    if (actor) {
      if (isCancelCommand(text)) {
        await this.useCases.clearManagerTelegramReplyContext({
          managerUserId: actor.managerUserId,
          managerTelegramBindingId: actor.bindingId,
          reason: "cancelled"
        });

        return { ok: true, status: "manager_cancelled_reply_context" };
      }

      if (isTelegramCommand(text)) {
        return { ok: true, status: "ignored_command" };
      }

      if (actor.managerRole === "viewer") {
        return { ok: true, status: "manager_forbidden" };
      }

      if (!text) {
        return { ok: true, status: "ignored_manager_message_without_context" };
      }

      try {
        await this.useCases.persistManagerTelegramReply({
          managerUserId: actor.managerUserId,
          managerEmail: actor.managerEmail,
          managerRole: actor.managerRole,
          managerTelegramBindingId: actor.bindingId,
          publicMessageId: randomUUID(),
          idempotencyKey: `telegram-manager-reply:${providerAccountId}:${chatId}:${message.message_id}`,
          requestFingerprint: sha256Hex(stableStringify({ updateId, chatId, text })),
          body: text,
          providerAccountId,
          externalChatId: chatId,
          providerUpdateId: String(updateId),
          providerMessageId: String(message.message_id),
          metadata: {
            source: "telegram_manager_reply",
            provider_account_id: providerAccountId
          }
        });

        return { ok: true, status: "manager_reply_queued" };
      } catch (error) {
        if (error instanceof ManagerTelegramReplyContextMissingError) {
          return { ok: true, status: "manager_reply_context_missing" };
        }

        if (error instanceof ManagerTelegramReplyRequiresTakeoverError) {
          return { ok: true, status: "manager_reply_requires_takeover" };
        }

        throw error;
      }
    }

    if (isTelegramCommand(text)) {
      return { ok: true, status: "ignored_command" };
    }

    await this.useCases.acceptInboundMessage(
      telegramMessageToInbound({
        updateId,
        message,
        providerAccountId,
        publicManagerBaseUrl: this.options.publicManagerBaseUrl
      })
    );

    return { ok: true, status: "accepted" };
  }

  private async handleCallbackQuery(
    _updateId: number,
    callbackQuery: TelegramCallbackQuery
  ): Promise<TelegramWebhookResult> {
    const providerAccountId = requiredProviderAccountId(this.options);
    const chat = callbackQuery.message?.chat;

    if (!chat || !isPrivateChat(chat) || !callbackQuery.data) {
      return { ok: true, status: "ignored_unsupported_update" };
    }

    const actor = await this.useCases.findManagerTelegramActor({
      providerAccountId,
      externalChatId: String(chat.id),
      externalUserId: String(callbackQuery.from.id),
      username: callbackQuery.from.username,
      displayName: telegramDisplayName(callbackQuery.from)
    });

    if (!actor) {
      return { ok: true, status: "manager_unbound" };
    }

    if (actor.managerRole === "viewer") {
      return { ok: true, status: "manager_forbidden" };
    }

    const action = readCallbackAction(callbackQuery.data);

    if (!action) {
      return { ok: true, status: "ignored_unsupported_update" };
    }

    if (action.kind === "takeover") {
      await this.useCases.takeoverConversationByPublicId({
        publicConversationId: action.publicConversationId,
        changedByManagerId: actor.managerUserId,
        changedByManagerEmail: actor.managerEmail,
        changedByManagerRole: actor.managerRole
      });

      return { ok: true, status: "manager_takeover_done" };
    }

    try {
      const context = await this.useCases.createManagerTelegramReplyContext({
        managerUserId: actor.managerUserId,
        managerTelegramBindingId: actor.bindingId,
        publicConversationId: action.publicConversationId
      });

      return {
        ok: true,
        status: context ? "manager_reply_context_created" : "ignored_unsupported_update"
      };
    } catch (error) {
      if (error instanceof ManagerTelegramReplyRequiresTakeoverError) {
        return { ok: true, status: "manager_reply_requires_takeover" };
      }

      throw error;
    }
  }
}

function telegramMessageToInbound(input: {
  updateId: number;
  message: TelegramMessage;
  providerAccountId: string;
  publicManagerBaseUrl?: string;
}) {
  const content = telegramMessageContent(input.message);
  const chatId = String(input.message.chat.id);
  const from = input.message.from;
  const bodyText = input.message.text ?? input.message.caption ?? "";

  return {
    publicMessageId: randomUUID(),
    channel: "telegram" as const,
    provider: "telegram_bot" as const,
    providerAccountId: input.providerAccountId,
    externalChatId: chatId,
    externalUserId: from ? String(from.id) : undefined,
    providerMessageId: String(input.message.message_id),
    providerUpdateId: String(input.updateId),
    providerSentAt: new Date(input.message.date * 1000).toISOString(),
    displayName: telegramDisplayName(from),
    username: from?.username,
    contact: {
      name: telegramDisplayName(from),
      preferredContact: "telegram" as const,
      username: from?.username
    },
    message: {
      role: "visitor" as const,
      text: bodyText,
      submittedAt: new Date(input.message.date * 1000).toISOString(),
      contentType: content.contentType,
      providerFileId: content.providerFileId,
      providerFileUniqueId: content.providerFileUniqueId,
      mimeType: content.mimeType,
      fileSize: content.fileSize,
      durationSeconds: content.durationSeconds,
      caption: input.message.caption,
      metadata: content.metadata
    },
    idempotencyKey: `telegram:${input.providerAccountId}:${chatId}:${input.message.message_id}`,
    requestFingerprint: sha256Hex(
      stableStringify({
        update_id: input.updateId,
        message_id: input.message.message_id,
        chat_id: chatId,
        from_id: from?.id,
        text: bodyText,
        content
      })
    ),
    automationRequested: false,
    needsManagerReason: classifyNeedsManagerReason(bodyText, content.contentType),
    managerPanelBaseUrl: input.publicManagerBaseUrl,
    metadata: {
      schema_version: "telegram_update.v1",
      event_type: "telegram.message_received",
      chat_type: input.message.chat.type,
      provider_account_id: input.providerAccountId
    }
  };
}

function classifyNeedsManagerReason(
  text: string,
  contentType: ConversationContentType
): NeedsManagerReason {
  if (contentType !== "text") {
    return "telegram_media";
  }

  if (/(менеджер|оператор|человек|живой|позвон|свяж|перезвон|manager|human|operator)/i.test(text)) {
    return "telegram_human_requested";
  }

  if (/(срочн|сегодня|завтра|очень быстро|urgent|asap)/i.test(text)) {
    return "telegram_urgent";
  }

  return "telegram_new_inbound";
}

function telegramMessageContent(message: TelegramMessage) {
  if (message.voice) {
    return {
      contentType: "voice" as const,
      providerFileId: message.voice.file_id,
      providerFileUniqueId: message.voice.file_unique_id,
      mimeType: message.voice.mime_type,
      fileSize: message.voice.file_size,
      durationSeconds: message.voice.duration,
      metadata: {}
    };
  }

  if (message.sticker) {
    return {
      contentType: "sticker" as const,
      providerFileId: message.sticker.file_id,
      providerFileUniqueId: message.sticker.file_unique_id,
      fileSize: message.sticker.file_size,
      metadata: {
        emoji: message.sticker.emoji ?? null
      }
    };
  }

  if (message.video_note) {
    return {
      contentType: "video_note" as const,
      providerFileId: message.video_note.file_id,
      providerFileUniqueId: message.video_note.file_unique_id,
      fileSize: message.video_note.file_size,
      durationSeconds: message.video_note.duration,
      metadata: {}
    };
  }

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];

    return {
      contentType: "photo" as const,
      providerFileId: photo?.file_id,
      providerFileUniqueId: photo?.file_unique_id,
      fileSize: photo?.file_size,
      metadata: {
        variants: message.photo.length
      }
    };
  }

  if (message.document) {
    return {
      contentType: "document" as const,
      providerFileId: message.document.file_id,
      providerFileUniqueId: message.document.file_unique_id,
      mimeType: message.document.mime_type,
      fileSize: message.document.file_size,
      metadata: {
        file_name: message.document.file_name ?? null
      }
    };
  }

  return {
    contentType: "text" as const,
    metadata: {}
  };
}

function readTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TelegramUpdate>;

  if (typeof candidate.update_id !== "number") {
    return null;
  }

  return candidate as TelegramUpdate;
}

function readStartToken(text: string) {
  const match = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(text);
  return match?.[1]?.trim();
}

function isCancelCommand(text: string) {
  return /^\/cancel(?:@\w+)?$/i.test(text);
}

function isTelegramCommand(text: string) {
  return /^\/[a-z0-9_]+(?:@\w+)?(?:\s|$)/i.test(text);
}

function isPrivateChat(chat: TelegramChat) {
  return chat.type === "private";
}

function readCallbackAction(data: string) {
  const [kind, publicConversationId] = data.split(":");

  if (
    (kind === "takeover" || kind === "reply") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      publicConversationId ?? ""
    )
  ) {
    return { kind, publicConversationId: publicConversationId ?? "" };
  }

  return null;
}

function telegramDisplayName(user: TelegramUser | undefined) {
  if (!user) {
    return undefined;
  }

  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
}

function requiredProviderAccountId(options: TelegramBotServiceOptions) {
  if (!options.providerAccountId) {
    throw new Error("Telegram provider account id is not configured");
  }

  return options.providerAccountId;
}

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: {
    chat: TelegramChat;
  };
  data?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  voice?: TelegramFile & {
    duration?: number;
    mime_type?: string;
  };
  sticker?: TelegramFile & {
    emoji?: string;
  };
  video_note?: TelegramFile & {
    duration?: number;
  };
  photo?: TelegramPhotoSize[];
  document?: TelegramFile & {
    file_name?: string;
    mime_type?: string;
  };
};

type TelegramChat = {
  id: number | string;
  type?: string;
};

type TelegramUser = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramFile = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
};

type TelegramPhotoSize = TelegramFile & {
  width?: number;
  height?: number;
};
