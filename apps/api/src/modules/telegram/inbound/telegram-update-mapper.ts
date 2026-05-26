import { sha256Hex, stableStringify } from "@granit/shared";

import type { AcceptInboundMessageInput } from "../../conversations/repositories/conversation-message-repository.js";
import type {
  ConversationContentType,
  NeedsManagerReason
} from "../../conversations/repositories/lead-conversation-types.js";

export type TelegramInboundMapperInput = {
  publicMessageId: string;
  updateId: number;
  message: TelegramMessage;
  providerAccountId: string;
  publicManagerBaseUrl?: string;
};

export type TelegramMessageContent = {
  contentType: ConversationContentType;
  providerFileId?: string;
  providerFileUniqueId?: string;
  mimeType?: string;
  fileSize?: number;
  durationSeconds?: number;
  metadata: Record<string, unknown>;
};

export type TelegramCallbackAction = {
  kind: "takeover" | "reply";
  publicConversationId: string;
};

export function telegramMessageToInbound(
  input: TelegramInboundMapperInput
): AcceptInboundMessageInput {
  const content = telegramMessageContent(input.message);
  const chatId = String(input.message.chat.id);
  const from = input.message.from;
  const bodyText = input.message.text ?? input.message.caption ?? "";
  const submittedAt = new Date(input.message.date * 1000).toISOString();

  return {
    publicMessageId: input.publicMessageId,
    channel: "telegram",
    provider: "telegram_bot",
    providerAccountId: input.providerAccountId,
    externalChatId: chatId,
    externalUserId: from ? String(from.id) : undefined,
    providerMessageId: String(input.message.message_id),
    providerUpdateId: String(input.updateId),
    providerSentAt: submittedAt,
    displayName: telegramDisplayName(from),
    username: from?.username,
    contact: {
      name: telegramDisplayName(from),
      preferredContact: "telegram",
      username: from?.username
    },
    message: {
      role: "visitor",
      text: bodyText,
      submittedAt,
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

export function classifyNeedsManagerReason(
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

export function telegramMessageContent(message: TelegramMessage): TelegramMessageContent {
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

export function readTelegramUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<TelegramUpdate>;

  if (typeof candidate.update_id !== "number") {
    return null;
  }

  return candidate as TelegramUpdate;
}

export function readStartToken(text: string) {
  const match = /^\/start(?:@\w+)?(?:\s+(.+))?$/i.exec(text);
  return match?.[1]?.trim();
}

export function isCancelCommand(text: string) {
  return /^\/cancel(?:@\w+)?$/i.test(text);
}

export function isTelegramCommand(text: string) {
  return /^\/[a-z0-9_]+(?:@\w+)?(?:\s|$)/i.test(text);
}

export function isPrivateChat(chat: TelegramChat) {
  return chat.type === "private";
}

export function readCallbackAction(data: string): TelegramCallbackAction | null {
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

export function telegramDisplayName(user: TelegramUser | undefined) {
  if (!user) {
    return undefined;
  }

  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username;
}

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: {
    chat: TelegramChat;
  };
  data?: string;
};

export type TelegramMessage = {
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

export type TelegramChat = {
  id: number | string;
  type?: string;
};

export type TelegramUser = {
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
