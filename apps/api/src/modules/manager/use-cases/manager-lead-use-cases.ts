import type {
  LeadStatus,
  ManagerLeadRepository,
} from "../../conversations/repositories/intake-repository.js";
import {
  assertManagerCanMutate,
  managerAuditFields,
  type ManagerActor
} from "./manager-actor.js";

export type ChangeManagerLeadStatusUseCaseInput = {
  actor: ManagerActor;
  leadId: string;
  status: LeadStatus;
};

export type TakeoverConversationUseCaseInput = {
  actor: ManagerActor;
  leadId: string;
  publicConversationId: string;
};

export class ManagerLeadUseCases {
  constructor(private readonly repository: ManagerLeadRepository) {}

  listLeads() {
    return this.repository.listManagerLeads();
  }

  getLead(leadId: string) {
    return this.repository.getManagerLead(leadId);
  }

  changeStatus(input: ChangeManagerLeadStatusUseCaseInput) {
    assertManagerCanMutate(input.actor);

    return this.repository.changeManagerLeadStatus({
      leadId: input.leadId,
      status: input.status,
      ...managerAuditFields(input.actor)
    });
  }

  takeoverConversation(input: TakeoverConversationUseCaseInput) {
    assertManagerCanMutate(input.actor);

    return this.repository.takeoverConversation({
      leadId: input.leadId,
      publicConversationId: input.publicConversationId,
      ...managerAuditFields(input.actor)
    });
  }
}
