import type {
  AcceptInboundMessageInput,
  ConversationMessageRepository
} from "../../../conversations/repositories/conversation-message-repository.js";
import type {
  ManagerLeadRepository,
  TakeoverConversationByPublicIdInput
} from "../../../conversations/repositories/manager-lead-repository.js";
import type {
  BindManagerTelegramChatInput,
  ClearManagerTelegramReplyContextInput,
  CreateManagerTelegramReplyContextInput,
  FindManagerTelegramActorInput,
  ManagerTelegramRepository,
  PersistManagerTelegramReplyInput
} from "../../../conversations/repositories/manager-telegram-repository.js";

type TelegramInboundRepository = ConversationMessageRepository &
  ManagerTelegramRepository &
  Pick<ManagerLeadRepository, "takeoverConversationByPublicId">;

export type TelegramInboundUseCases = {
  acceptInboundMessage(input: AcceptInboundMessageInput): ReturnType<
    TelegramInboundRepository["acceptInboundMessage"]
  >;
  bindManagerTelegramChat(input: BindManagerTelegramChatInput): ReturnType<
    TelegramInboundRepository["bindManagerTelegramChat"]
  >;
  findManagerTelegramActor(input: FindManagerTelegramActorInput): ReturnType<
    TelegramInboundRepository["findManagerTelegramActor"]
  >;
  clearManagerTelegramReplyContext(input: ClearManagerTelegramReplyContextInput): ReturnType<
    TelegramInboundRepository["clearManagerTelegramReplyContext"]
  >;
  persistManagerTelegramReply: TelegramInboundRepository["persistManagerTelegramReply"];
  takeoverConversationByPublicId(input: TakeoverConversationByPublicIdInput): ReturnType<
    TelegramInboundRepository["takeoverConversationByPublicId"]
  >;
  createManagerTelegramReplyContext(input: CreateManagerTelegramReplyContextInput): ReturnType<
    TelegramInboundRepository["createManagerTelegramReplyContext"]
  >;
};

export class RepositoryTelegramInboundUseCases implements TelegramInboundUseCases {
  constructor(private readonly repository: TelegramInboundRepository) {}

  acceptInboundMessage(input: AcceptInboundMessageInput) {
    return this.repository.acceptInboundMessage(input);
  }

  bindManagerTelegramChat(input: BindManagerTelegramChatInput) {
    return this.repository.bindManagerTelegramChat(input);
  }

  findManagerTelegramActor(input: FindManagerTelegramActorInput) {
    return this.repository.findManagerTelegramActor(input);
  }

  clearManagerTelegramReplyContext(input: ClearManagerTelegramReplyContextInput) {
    return this.repository.clearManagerTelegramReplyContext(input);
  }

  persistManagerTelegramReply(input: PersistManagerTelegramReplyInput) {
    return this.repository.persistManagerTelegramReply(input);
  }

  takeoverConversationByPublicId(input: TakeoverConversationByPublicIdInput) {
    return this.repository.takeoverConversationByPublicId(input);
  }

  createManagerTelegramReplyContext(input: CreateManagerTelegramReplyContextInput) {
    return this.repository.createManagerTelegramReplyContext(input);
  }
}
