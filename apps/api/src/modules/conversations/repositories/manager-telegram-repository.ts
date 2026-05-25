export type ManagerTelegramBindingStatus = {
  bound: boolean;
  username?: string;
  displayName?: string;
  externalChatId?: string;
  boundAt?: string;
};

export type CreateManagerTelegramBindTokenInput = {
  managerUserId: string;
  managerEmail: string;
  managerRole: string;
};

export type CreateManagerTelegramBindTokenResult = {
  token: string;
  expiresAt: string;
};

export type BindManagerTelegramChatInput = {
  token: string;
  providerAccountId: string;
  externalChatId: string;
  externalUserId?: string;
  username?: string;
  displayName?: string;
  providerUpdateId?: string;
  providerMessageId?: string;
};

export type BindManagerTelegramChatResult =
  | {
      status: "bound";
      managerUserId: string;
      managerEmail: string;
      managerRole: string;
      bindingId: string;
    }
  | {
      status: "invalid_token" | "expired_token" | "used_token";
    };

export type ManagerTelegramActor = {
  managerUserId: string;
  managerEmail: string;
  managerRole: string;
  bindingId: string;
  externalChatId: string;
};

export type FindManagerTelegramActorInput = {
  providerAccountId: string;
  externalChatId: string;
  externalUserId?: string;
  username?: string;
  displayName?: string;
};

export type CreateManagerTelegramReplyContextInput = {
  managerUserId: string;
  managerTelegramBindingId: string;
  publicConversationId: string;
};

export type CreateManagerTelegramReplyContextResult = {
  leadId: string;
  publicConversationId: string;
  expiresAt: string;
};

export type ClearManagerTelegramReplyContextInput = {
  managerUserId: string;
  managerTelegramBindingId: string;
  reason: "cancelled" | "expired" | "used";
};

export type PersistManagerTelegramReplyInput = {
  managerUserId: string;
  managerEmail: string;
  managerRole: string;
  managerTelegramBindingId: string;
  publicMessageId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  body: string;
  providerAccountId: string;
  externalChatId: string;
  providerUpdateId?: string;
  providerMessageId?: string;
  metadata: Record<string, unknown>;
};

export type PersistManagerTelegramReplyResult = {
  leadId: string;
  publicConversationId: string;
  publicMessageId: string;
  deliveryStatus: "pending";
  replayed: boolean;
};

export interface ManagerTelegramRepository {
  getManagerTelegramBindingStatus(managerUserId: string): Promise<ManagerTelegramBindingStatus>;
  createManagerTelegramBindToken(
    input: CreateManagerTelegramBindTokenInput
  ): Promise<CreateManagerTelegramBindTokenResult>;
  bindManagerTelegramChat(
    input: BindManagerTelegramChatInput
  ): Promise<BindManagerTelegramChatResult>;
  findManagerTelegramActor(
    input: FindManagerTelegramActorInput
  ): Promise<ManagerTelegramActor | null>;
  createManagerTelegramReplyContext(
    input: CreateManagerTelegramReplyContextInput
  ): Promise<CreateManagerTelegramReplyContextResult | null>;
  clearManagerTelegramReplyContext(input: ClearManagerTelegramReplyContextInput): Promise<void>;
  persistManagerTelegramReply(
    input: PersistManagerTelegramReplyInput
  ): Promise<PersistManagerTelegramReplyResult>;
}
