import { randomUUID } from "node:crypto";

import { sha256Hex, stableStringify } from "@granit/shared";

import {
  ManagerTelegramReplyContextMissingError,
  ManagerTelegramReplyRequiresTakeoverError
} from "../../conversations/repositories/lead-conversation-types.js";
import {
  isCancelCommand,
  isPrivateChat,
  isTelegramCommand,
  readCallbackAction,
  readStartToken,
  readTelegramUpdate,
  telegramDisplayName,
  telegramMessageToInbound,
  type TelegramCallbackQuery,
  type TelegramMessage
} from "./telegram-update-mapper.js";
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
        publicMessageId: randomUUID(),
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

function requiredProviderAccountId(options: TelegramBotServiceOptions) {
  if (!options.providerAccountId) {
    throw new Error("Telegram provider account id is not configured");
  }

  return options.providerAccountId;
}
