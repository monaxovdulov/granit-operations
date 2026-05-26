import { describe, expect, it } from "vitest";

import {
  classifyNeedsManagerReason,
  isCancelCommand,
  isPrivateChat,
  isTelegramCommand,
  readCallbackAction,
  readStartToken,
  readTelegramUpdate,
  telegramDisplayName,
  telegramMessageContent,
  telegramMessageToInbound,
  type TelegramMessage
} from "../src/modules/telegram/inbound/telegram-update-mapper.js";

describe("Telegram inbound update mapper", () => {
  it("maps text Telegram messages into deterministic inbound DTOs", () => {
    const message = telegramTextMessage({
      messageId: 501,
      chatId: 42,
      fromId: 42,
      text: "Срочно нужен памятник"
    });
    const input = {
      publicMessageId: "telegram-public-message-1",
      updateId: 2001,
      message,
      providerAccountId: "bot-main",
      publicManagerBaseUrl: "https://manager.example"
    };

    const inbound = telegramMessageToInbound(input);
    const replay = telegramMessageToInbound(input);

    expect(inbound).toMatchObject({
      publicMessageId: "telegram-public-message-1",
      channel: "telegram",
      provider: "telegram_bot",
      providerAccountId: "bot-main",
      externalChatId: "42",
      externalUserId: "42",
      providerMessageId: "501",
      providerUpdateId: "2001",
      providerSentAt: new Date(message.date * 1000).toISOString(),
      displayName: "Telegram Visitor",
      username: "telegram_visitor",
      contact: {
        name: "Telegram Visitor",
        preferredContact: "telegram",
        username: "telegram_visitor"
      },
      message: {
        role: "visitor",
        text: "Срочно нужен памятник",
        submittedAt: new Date(message.date * 1000).toISOString(),
        contentType: "text",
        metadata: {}
      },
      idempotencyKey: "telegram:bot-main:42:501",
      automationRequested: false,
      needsManagerReason: "telegram_urgent",
      managerPanelBaseUrl: "https://manager.example",
      metadata: {
        schema_version: "telegram_update.v1",
        event_type: "telegram.message_received",
        chat_type: "private",
        provider_account_id: "bot-main"
      }
    });
    expect(inbound.requestFingerprint).toBe(replay.requestFingerprint);
  });

  it("maps media messages as manager-visible Telegram media inbound", () => {
    const message: TelegramMessage = {
      message_id: 601,
      date: 1_779_109_200,
      chat: {
        id: 77,
        type: "private"
      },
      from: {
        id: 77,
        first_name: "Photo",
        username: "photo_visitor"
      },
      caption: "Фото памятника",
      photo: [
        {
          file_id: "small-file-id",
          file_unique_id: "small-unique-id",
          file_size: 100,
          width: 90,
          height: 90
        },
        {
          file_id: "large-file-id",
          file_unique_id: "large-unique-id",
          file_size: 1000,
          width: 1280,
          height: 960
        }
      ]
    };

    const inbound = telegramMessageToInbound({
      publicMessageId: "telegram-public-message-2",
      updateId: 2101,
      message,
      providerAccountId: "bot-main"
    });

    expect(inbound.needsManagerReason).toBe("telegram_media");
    expect(inbound.message).toMatchObject({
      text: "Фото памятника",
      contentType: "photo",
      providerFileId: "large-file-id",
      providerFileUniqueId: "large-unique-id",
      fileSize: 1000,
      caption: "Фото памятника",
      metadata: {
        variants: 2
      }
    });
    expect(telegramMessageContent(message)).toMatchObject({
      contentType: "photo",
      providerFileId: "large-file-id",
      metadata: {
        variants: 2
      }
    });
  });

  it("classifies text and non-text manager needs without service dependencies", () => {
    expect(classifyNeedsManagerReason("Нужен человек", "text")).toBe(
      "telegram_human_requested"
    );
    expect(classifyNeedsManagerReason("urgent request", "text")).toBe("telegram_urgent");
    expect(classifyNeedsManagerReason("Здравствуйте", "text")).toBe("telegram_new_inbound");
    expect(classifyNeedsManagerReason("voice", "voice")).toBe("telegram_media");
  });

  it("parses existing manager commands and callback actions", () => {
    const publicConversationId = "00000000-0000-4000-8000-000000000000";

    expect(readStartToken("/start bind-token-1")).toBe("bind-token-1");
    expect(readStartToken("/start@granit_bot bind-token-2")).toBe("bind-token-2");
    expect(readStartToken("/start")).toBeUndefined();
    expect(isCancelCommand("/cancel@granit_bot")).toBe(true);
    expect(isTelegramCommand("/unknown payload")).toBe(true);
    expect(isTelegramCommand("plain message")).toBe(false);
    expect(readCallbackAction(`takeover:${publicConversationId}`)).toEqual({
      kind: "takeover",
      publicConversationId
    });
    expect(readCallbackAction(`reply:${publicConversationId}`)).toEqual({
      kind: "reply",
      publicConversationId
    });
    expect(readCallbackAction(`unknown:${publicConversationId}`)).toBeNull();
  });

  it("keeps raw update, chat and display-name parsing pure", () => {
    const message = telegramTextMessage({});

    expect(readTelegramUpdate({ update_id: 1, message })).toMatchObject({ update_id: 1 });
    expect(readTelegramUpdate({ update_id: "1", message })).toBeNull();
    expect(readTelegramUpdate(null)).toBeNull();
    expect(isPrivateChat({ id: 1, type: "private" })).toBe(true);
    expect(isPrivateChat({ id: 1, type: "group" })).toBe(false);
    expect(
      telegramDisplayName({
        id: 1,
        first_name: "First",
        last_name: "Last",
        username: "username"
      })
    ).toBe("First Last");
    expect(telegramDisplayName({ id: 1, username: "username" })).toBe("username");
  });
});

function telegramTextMessage(
  overrides: {
    messageId?: number;
    chatId?: number;
    fromId?: number;
    text?: string;
  } = {}
): TelegramMessage {
  return {
    message_id: overrides.messageId ?? 101,
    date: 1_779_109_200,
    chat: {
      id: overrides.chatId ?? 42,
      type: "private"
    },
    from: {
      id: overrides.fromId ?? 42,
      first_name: "Telegram",
      last_name: "Visitor",
      username: "telegram_visitor"
    },
    text: overrides.text ?? "Здравствуйте"
  };
}
