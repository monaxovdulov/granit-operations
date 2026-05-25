import type { ManagerTelegramRepository } from "../../conversations/repositories/manager-telegram-repository.js";
import {
  assertManagerCanMutate,
  type ManagerActor
} from "./manager-actor.js";

export type CreateManagerTelegramBindTokenUseCaseInput = {
  actor: ManagerActor;
};

export class ManagerTelegramBindingUseCases {
  constructor(private readonly repository: ManagerTelegramRepository) {}

  getBindingStatus(managerUserId: string) {
    return this.repository.getManagerTelegramBindingStatus(managerUserId);
  }

  createBindToken(input: CreateManagerTelegramBindTokenUseCaseInput) {
    assertManagerCanMutate(input.actor);

    return this.repository.createManagerTelegramBindToken({
      managerUserId: input.actor.id,
      managerEmail: input.actor.email,
      managerRole: input.actor.role
    });
  }
}
