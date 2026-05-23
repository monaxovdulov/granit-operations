import type {
  AcceptInboundMessageInput,
  BindManagerTelegramChatInput,
  ClearManagerTelegramReplyContextInput,
  CreateManagerTelegramReplyContextInput,
  FindManagerTelegramActorInput,
  IntakeRepository,
  TakeoverConversationByPublicIdInput
} from "../../../conversations/repositories/intake-repository.js";

export type TelegramInboundUseCases = {
  acceptInboundMessage(input: AcceptInboundMessageInput): ReturnType<
    IntakeRepository["acceptInboundMessage"]
  >;
  bindManagerTelegramChat(input: BindManagerTelegramChatInput): ReturnType<
    IntakeRepository["bindManagerTelegramChat"]
  >;
  findManagerTelegramActor(input: FindManagerTelegramActorInput): ReturnType<
    IntakeRepository["findManagerTelegramActor"]
  >;
  clearManagerTelegramReplyContext(input: ClearManagerTelegramReplyContextInput): ReturnType<
    IntakeRepository["clearManagerTelegramReplyContext"]
  >;
  persistManagerTelegramReply: IntakeRepository["persistManagerTelegramReply"];
  takeoverConversationByPublicId(input: TakeoverConversationByPublicIdInput): ReturnType<
    IntakeRepository["takeoverConversationByPublicId"]
  >;
  createManagerTelegramReplyContext(input: CreateManagerTelegramReplyContextInput): ReturnType<
    IntakeRepository["createManagerTelegramReplyContext"]
  >;
};

export class RepositoryTelegramInboundUseCases implements TelegramInboundUseCases {
  constructor(private readonly repository: IntakeRepository) {}

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

  persistManagerTelegramReply(input: Parameters<IntakeRepository["persistManagerTelegramReply"]>[0]) {
    return this.repository.persistManagerTelegramReply(input);
  }

  takeoverConversationByPublicId(input: TakeoverConversationByPublicIdInput) {
    return this.repository.takeoverConversationByPublicId(input);
  }

  createManagerTelegramReplyContext(input: CreateManagerTelegramReplyContextInput) {
    return this.repository.createManagerTelegramReplyContext(input);
  }
}
