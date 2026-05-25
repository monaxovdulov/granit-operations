import type { ConversationMessageRepository } from "./conversation-message-repository.js";
import type { ManagerLeadRepository } from "./manager-lead-repository.js";
import type { ManagerTelegramRepository } from "./manager-telegram-repository.js";
import type { PublicIntakeRepository } from "./public-intake-repository.js";

export * from "./conversation-message-repository.js";
export * from "./lead-conversation-types.js";
export * from "./manager-lead-repository.js";
export * from "./manager-telegram-repository.js";
export * from "./public-intake-repository.js";

export interface IntakeRepository
  extends PublicIntakeRepository,
    ConversationMessageRepository,
    ManagerLeadRepository,
    ManagerTelegramRepository {}
