import { randomBytes } from "node:crypto";

import { and, eq, or, sql } from "drizzle-orm";
import { sha256Hex } from "@granit/shared";

import {
  conversationMessages,
  conversations,
  leadTimelineEvents,
  leads,
  managerTelegramBindings,
  managerTelegramBindTokens,
  managerTelegramReplyContexts,
  managerUsers,
  messageDeliveries,
  type OperationsDb
} from "@granit/db";

import { managerMessageQueuedTimelineEvent } from "../../timeline/timeline-events.js";
import {
  IdempotencyConflictError,
  ManagerTelegramReplyContextMissingError,
  ManagerTelegramReplyRequiresTakeoverError
} from "./lead-conversation-types.js";
import type {
  BindManagerTelegramChatInput,
  BindManagerTelegramChatResult,
  ClearManagerTelegramReplyContextInput,
  CreateManagerTelegramBindTokenInput,
  CreateManagerTelegramBindTokenResult,
  CreateManagerTelegramReplyContextInput,
  CreateManagerTelegramReplyContextResult,
  FindManagerTelegramActorInput,
  ManagerTelegramActor,
  ManagerTelegramBindingStatus,
  ManagerTelegramRepository,
  PersistManagerTelegramReplyInput,
  PersistManagerTelegramReplyResult
} from "./manager-telegram-repository.js";

export class PostgresManagerTelegramRepository implements ManagerTelegramRepository {
  constructor(private readonly db: OperationsDb) {}

  async getManagerTelegramBindingStatus(
    managerUserId: string
  ): Promise<ManagerTelegramBindingStatus> {
    const [binding] = await this.db
      .select({
        externalChatId: managerTelegramBindings.externalChatId,
        username: managerTelegramBindings.username,
        displayName: managerTelegramBindings.displayName,
        boundAt: managerTelegramBindings.boundAt
      })
      .from(managerTelegramBindings)
      .where(
        and(
          eq(managerTelegramBindings.managerUserId, managerUserId),
          eq(managerTelegramBindings.status, "active")
        )
      )
      .limit(1);

    if (!binding) {
      return { bound: false };
    }

    return {
      bound: true,
      username: binding.username ?? undefined,
      displayName: binding.displayName ?? undefined,
      externalChatId: maskExternalChatId(binding.externalChatId),
      boundAt: binding.boundAt.toISOString()
    };
  }

  async createManagerTelegramBindToken(
    input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult> {
    const token = randomBytes(18).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.db.insert(managerTelegramBindTokens).values({
      managerUserId: input.managerUserId,
      tokenHash: hashTelegramBindToken(token),
      expiresAt
    });

    return {
      token,
      expiresAt: expiresAt.toISOString()
    };
  }

  async bindManagerTelegramChat(
    input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult> {
    const [tokenRow] = await this.db
      .select({
        tokenId: managerTelegramBindTokens.id,
        managerUserId: managerTelegramBindTokens.managerUserId,
        expiresAt: managerTelegramBindTokens.expiresAt,
        usedAt: managerTelegramBindTokens.usedAt,
        managerEmail: managerUsers.email,
        managerRole: managerUsers.role,
        managerStatus: managerUsers.status
      })
      .from(managerTelegramBindTokens)
      .innerJoin(managerUsers, eq(managerTelegramBindTokens.managerUserId, managerUsers.id))
      .where(eq(managerTelegramBindTokens.tokenHash, hashTelegramBindToken(input.token)))
      .limit(1);

    if (!tokenRow || tokenRow.managerStatus !== "active") {
      return { status: "invalid_token" };
    }

    if (tokenRow.usedAt) {
      return { status: "used_token" };
    }

    const now = new Date();

    if (tokenRow.expiresAt <= now) {
      return { status: "expired_token" };
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(managerTelegramBindings)
        .set({
          status: "revoked",
          revokedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(managerTelegramBindings.provider, "telegram_bot"),
            eq(managerTelegramBindings.providerAccountId, input.providerAccountId),
            eq(managerTelegramBindings.status, "active"),
            or(
              eq(managerTelegramBindings.managerUserId, tokenRow.managerUserId),
              eq(managerTelegramBindings.externalChatId, input.externalChatId)
            )
          )
        );

      const [binding] = await tx
        .insert(managerTelegramBindings)
        .values({
          managerUserId: tokenRow.managerUserId,
          provider: "telegram_bot",
          providerAccountId: input.providerAccountId,
          externalChatId: input.externalChatId,
          externalUserId: input.externalUserId ?? null,
          username: input.username ?? null,
          displayName: input.displayName ?? null,
          status: "active",
          metadata: {
            provider_update_id: input.providerUpdateId ?? null,
            provider_message_id: input.providerMessageId ?? null
          },
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          boundAt: now
        })
        .returning({ id: managerTelegramBindings.id });

      if (!binding) {
        throw new Error("manager Telegram binding insert returned no row");
      }

      await tx
        .update(managerTelegramBindTokens)
        .set({ usedAt: now })
        .where(eq(managerTelegramBindTokens.id, tokenRow.tokenId));

      return {
        status: "bound",
        managerUserId: tokenRow.managerUserId,
        managerEmail: tokenRow.managerEmail,
        managerRole: tokenRow.managerRole,
        bindingId: binding.id
      };
    });
  }

  async findManagerTelegramActor(
    input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null> {
    const [row] = await this.db
      .select({
        bindingId: managerTelegramBindings.id,
        managerUserId: managerUsers.id,
        managerEmail: managerUsers.email,
        managerRole: managerUsers.role,
        managerStatus: managerUsers.status,
        externalChatId: managerTelegramBindings.externalChatId
      })
      .from(managerTelegramBindings)
      .innerJoin(managerUsers, eq(managerTelegramBindings.managerUserId, managerUsers.id))
      .where(
        and(
          eq(managerTelegramBindings.provider, "telegram_bot"),
          eq(managerTelegramBindings.providerAccountId, input.providerAccountId),
          eq(managerTelegramBindings.externalChatId, input.externalChatId),
          eq(managerTelegramBindings.externalUserId, input.externalUserId ?? ""),
          eq(managerTelegramBindings.status, "active")
        )
      )
      .limit(1);

    if (!row || row.managerStatus !== "active") {
      return null;
    }

    await this.db
      .update(managerTelegramBindings)
      .set({
        externalUserId: input.externalUserId ?? undefined,
        username: input.username ?? undefined,
        displayName: input.displayName ?? undefined,
        lastSeenAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(managerTelegramBindings.id, row.bindingId));

    return {
      managerUserId: row.managerUserId,
      managerEmail: row.managerEmail,
      managerRole: row.managerRole,
      bindingId: row.bindingId,
      externalChatId: row.externalChatId
    };
  }

  async createManagerTelegramReplyContext(
    input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null> {
    const [conversation] = await this.db
      .select({
        id: conversations.id,
        leadId: conversations.leadId,
        publicConversationId: conversations.publicConversationId,
        channel: conversations.channel,
        aiState: conversations.aiState,
        agentAllowedToReply: conversations.agentAllowedToReply
      })
      .from(conversations)
      .where(eq(conversations.publicConversationId, input.publicConversationId))
      .limit(1);

    if (!conversation) {
      return null;
    }

    if (
      conversation.channel !== "telegram" ||
      conversation.agentAllowedToReply ||
      conversation.aiState !== "manager_active"
    ) {
      throw new ManagerTelegramReplyRequiresTakeoverError();
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx
        .update(managerTelegramReplyContexts)
        .set({
          status: "cancelled",
          updatedAt: now
        })
        .where(
          and(
            eq(managerTelegramReplyContexts.managerUserId, input.managerUserId),
            eq(managerTelegramReplyContexts.status, "pending")
          )
        );

      await tx.insert(managerTelegramReplyContexts).values({
        managerUserId: input.managerUserId,
        managerTelegramBindingId: input.managerTelegramBindingId,
        leadId: conversation.leadId,
        conversationId: conversation.id,
        publicConversationId: conversation.publicConversationId,
        status: "pending",
        expiresAt,
        createdAt: now,
        updatedAt: now
      });
    });

    return {
      leadId: conversation.leadId,
      publicConversationId: conversation.publicConversationId,
      expiresAt: expiresAt.toISOString()
    };
  }

  async clearManagerTelegramReplyContext(
    input: ClearManagerTelegramReplyContextInput
  ): Promise<void> {
    await this.db
      .update(managerTelegramReplyContexts)
      .set({
        status: input.reason,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(managerTelegramReplyContexts.managerUserId, input.managerUserId),
          eq(managerTelegramReplyContexts.managerTelegramBindingId, input.managerTelegramBindingId),
          eq(managerTelegramReplyContexts.status, "pending")
        )
      );
  }

  async persistManagerTelegramReply(
    input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult> {
    const existing = await this.findExistingManagerReplyByIdempotencyKey(input.idempotencyKey);

    if (existing) {
      return replayExistingManagerReply(existing, input.requestFingerprint);
    }

    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [context] = await tx
          .select({
            id: managerTelegramReplyContexts.id,
            leadId: managerTelegramReplyContexts.leadId,
            conversationId: managerTelegramReplyContexts.conversationId,
            publicConversationId: managerTelegramReplyContexts.publicConversationId,
            expiresAt: managerTelegramReplyContexts.expiresAt
          })
          .from(managerTelegramReplyContexts)
          .where(
            and(
              eq(managerTelegramReplyContexts.managerUserId, input.managerUserId),
              eq(
                managerTelegramReplyContexts.managerTelegramBindingId,
                input.managerTelegramBindingId
              ),
              eq(managerTelegramReplyContexts.status, "pending")
            )
          )
          .limit(1);

        if (!context) {
          throw new ManagerTelegramReplyContextMissingError();
        }

        if (context.expiresAt <= now) {
          await tx
            .update(managerTelegramReplyContexts)
            .set({ status: "expired", updatedAt: now })
            .where(eq(managerTelegramReplyContexts.id, context.id));
          throw new ManagerTelegramReplyContextMissingError();
        }

        const [conversation] = await tx
          .select({
            id: conversations.id,
            leadId: conversations.leadId,
            publicConversationId: conversations.publicConversationId,
            channel: conversations.channel,
            channelIdentityId: conversations.channelIdentityId,
            aiState: conversations.aiState,
            agentAllowedToReply: conversations.agentAllowedToReply
          })
          .from(conversations)
          .where(eq(conversations.id, context.conversationId))
          .limit(1)
          .for("update");

        if (!conversation || conversation.leadId !== context.leadId) {
          throw new ManagerTelegramReplyContextMissingError();
        }

        if (
          conversation.channel !== "telegram" ||
          conversation.agentAllowedToReply ||
          conversation.aiState !== "manager_active"
        ) {
          throw new ManagerTelegramReplyRequiresTakeoverError();
        }

        const [turnIdentity] = await tx
          .update(conversations)
          .set({
            lastMessageSequence: sql`${conversations.lastMessageSequence} + 1`,
            generationEpoch: sql`${conversations.generationEpoch} + 1`,
            updatedAt: now
          })
          .where(eq(conversations.id, conversation.id))
          .returning({ messageSequence: conversations.lastMessageSequence });

        if (!turnIdentity) {
          throw new Error("manager reply turn identity update returned no row");
        }

        const [message] = await tx
          .insert(conversationMessages)
          .values({
            publicMessageId: input.publicMessageId,
            conversationId: conversation.id,
            leadId: conversation.leadId,
            channelIdentityId: conversation.channelIdentityId ?? null,
            direction: "outbound",
            senderRole: "manager",
            messageSequence: turnIdentity.messageSequence,
            body: input.body,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            contentType: "text",
            metadata: {
              ...input.metadata,
              public_conversation_id: conversation.publicConversationId,
              manager_user_id: input.managerUserId,
              manager_email: input.managerEmail,
              manager_role: input.managerRole,
              manager_telegram_binding_id: input.managerTelegramBindingId,
              manager_provider_update_id: input.providerUpdateId ?? null,
              manager_provider_message_id: input.providerMessageId ?? null
            },
            submittedAt: now,
            createdAt: now
          })
          .returning({
            id: conversationMessages.id,
            publicMessageId: conversationMessages.publicMessageId
          });

        if (!message) {
          throw new Error("manager reply insert returned no row");
        }

        await tx.insert(messageDeliveries).values({
          conversationMessageId: message.id,
          channel: "telegram",
          provider: "telegram_bot",
          status: "pending",
          attemptCount: 0,
          createdAt: now,
          updatedAt: now
        });

        await tx
          .update(managerTelegramReplyContexts)
          .set({ status: "used", updatedAt: now })
          .where(eq(managerTelegramReplyContexts.id, context.id));

        await tx
          .update(leads)
          .set({ updatedAt: now })
          .where(eq(leads.id, conversation.leadId));

        await tx.insert(leadTimelineEvents).values(
          managerMessageQueuedTimelineEvent({
            leadId: conversation.leadId,
            publicConversationId: conversation.publicConversationId,
            publicMessageId: message.publicMessageId,
            changedByManagerId: input.managerUserId,
            changedByManagerEmail: input.managerEmail,
            changedByManagerRole: input.managerRole,
            createdAt: now
          })
        );

        return {
          leadId: conversation.leadId,
          publicConversationId: conversation.publicConversationId,
          publicMessageId: message.publicMessageId,
          deliveryStatus: "pending",
          replayed: false
        };
      });
    } catch (error) {
      if (
        error instanceof ManagerTelegramReplyContextMissingError ||
        error instanceof ManagerTelegramReplyRequiresTakeoverError
      ) {
        throw error;
      }

      if (isUniqueViolation(error)) {
        const replay = await this.findExistingManagerReplyByIdempotencyKey(input.idempotencyKey);

        if (replay) {
          return replayExistingManagerReply(replay, input.requestFingerprint);
        }
      }

      throw error;
    }
  }

  private async findExistingManagerReplyByIdempotencyKey(idempotencyKey: string) {
    const [existing] = await this.db
      .select({
        leadId: conversationMessages.leadId,
        publicConversationId: conversations.publicConversationId,
        publicMessageId: conversationMessages.publicMessageId,
        requestFingerprint: conversationMessages.requestFingerprint,
        deliveryStatus: messageDeliveries.status
      })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversationMessages.conversationId, conversations.id))
      .leftJoin(
        messageDeliveries,
        eq(messageDeliveries.conversationMessageId, conversationMessages.id)
      )
      .where(
        and(
          eq(conversationMessages.idempotencyKey, idempotencyKey),
          eq(conversationMessages.direction, "outbound"),
          eq(conversationMessages.senderRole, "manager")
        )
      )
      .limit(1);

    return existing ?? null;
  }
}

function hashTelegramBindToken(token: string) {
  return sha256Hex(`manager-telegram-bind:${token}`);
}

function maskExternalChatId(value: string) {
  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

function replayExistingManagerReply(
  existing: {
    leadId: string;
    publicConversationId: string;
    publicMessageId: string;
    requestFingerprint: string;
    deliveryStatus: string | null;
  },
  requestFingerprint: string
): PersistManagerTelegramReplyResult {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new IdempotencyConflictError();
  }

  return {
    leadId: existing.leadId,
    publicConversationId: existing.publicConversationId,
    publicMessageId: existing.publicMessageId,
    deliveryStatus: "pending",
    replayed: true
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
