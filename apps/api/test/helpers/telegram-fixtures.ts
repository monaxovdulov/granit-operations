import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildApi } from "../../src/app.js";
import type {
  AcceptInboundMessageInput,
  ConversationContentType
} from "../../src/repositories/intake-repository.js";

import { MemoryIntakeRepository } from "./memory-intake-repository.js";
import {
  MemoryManagerAuthRepository,
  testManagerAuthConfig
} from "./memory-manager-auth-repository.js";

type ApiApp = ReturnType<typeof buildApi>;
type TrackApiApp = <T extends ApiApp>(app: T) => T;

export function validTelegramInbound(
  overrides: {
    idempotencyKey?: string;
    providerMessageId?: string;
    providerUpdateId?: string;
    text?: string;
    contentType?: ConversationContentType;
    providerFileId?: string;
    caption?: string;
  } = {}
): AcceptInboundMessageInput {
  const text = overrides.text ?? "Здравствуйте";

  return {
    publicMessageId: randomUUID(),
    channel: "telegram",
    provider: "telegram_bot",
    providerAccountId: "bot-main",
    externalChatId: "chat-42",
    externalUserId: "user-42",
    providerMessageId: overrides.providerMessageId,
    providerUpdateId: overrides.providerUpdateId,
    displayName: "Telegram Visitor",
    username: "telegram_visitor",
    contact: {
      name: "Telegram Visitor",
      preferredContact: "telegram",
      username: "telegram_visitor"
    },
    message: {
      role: "visitor",
      text,
      submittedAt: "2026-05-18T10:00:00.000Z",
      contentType: overrides.contentType ?? "text",
      providerFileId: overrides.providerFileId,
      caption: overrides.caption
    },
    idempotencyKey: overrides.idempotencyKey ?? "telegram-key-0001",
    requestFingerprint: `fingerprint:${overrides.providerMessageId ?? overrides.idempotencyKey ?? text}`,
    automationRequested: true,
    metadata: {
      schema_version: "telegram_update.v1",
      event_type: "telegram.message_received"
    }
  };
}

export function testTelegramBotOptions() {
  return {
    enabled: true,
    providerAccountId: "bot-main",
    webhookSecret: "test-telegram-secret",
    publicManagerBaseUrl: "https://manager.example"
  };
}

export function testTelegramSecretHeader() {
  return { "x-telegram-bot-api-secret-token": "test-telegram-secret" };
}

export async function boundTelegramManagerApp(track: TrackApiApp = (app) => app) {
  const repository = new MemoryIntakeRepository();
  const managerAuthRepository = new MemoryManagerAuthRepository();
  const app = track(
    buildApi({
      repository,
      managerAuth: {
        repository: managerAuthRepository,
        config: testManagerAuthConfig()
      },
      telegramBot: testTelegramBotOptions()
    })
  );
  const tokenResponse = await app.inject({
    method: "POST",
    url: "/manager/me/telegram-bind-token",
    headers: { cookie: managerAuthRepository.createSessionCookie() }
  });

  await app.inject({
    method: "POST",
    url: "/telegram/webhook",
    headers: testTelegramSecretHeader(),
    payload: telegramTextUpdate({
      updateId: 1901,
      messageId: 401,
      chatId: 9001,
      fromId: 9001,
      username: "owner_manager",
      text: `/start ${tokenResponse.json().bindToken.token}`
    })
  });

  return { app, repository };
}

export function telegramTextUpdate(
  overrides: {
    updateId?: number;
    messageId?: number;
    chatId?: number;
    chatType?: string;
    fromId?: number;
    username?: string;
    text?: string;
  } = {}
) {
  const fromId = overrides.fromId ?? 42;
  const username = overrides.username ?? "telegram_visitor";

  return {
    update_id: overrides.updateId ?? 1001,
    message: {
      message_id: overrides.messageId ?? 101,
      date: 1_779_109_200,
      chat: {
        id: overrides.chatId ?? 42,
        type: overrides.chatType ?? "private"
      },
      from: {
        id: fromId,
        first_name: username,
        username
      },
      text: overrides.text ?? "Здравствуйте"
    }
  };
}

export function telegramCallbackUpdate(input: {
  updateId: number;
  chatId: number;
  chatType?: string;
  fromId: number;
  data: string;
}) {
  return {
    update_id: input.updateId,
    callback_query: {
      id: `callback-${input.updateId}`,
      from: {
        id: input.fromId,
        first_name: "owner_manager",
        username: "owner_manager"
      },
      message: {
        chat: {
          id: input.chatId,
          type: input.chatType ?? "private"
        }
      },
      data: input.data
    }
  };
}

export function readFixtureSource(path: string) {
  return readFileSync(path, "utf8");
}
