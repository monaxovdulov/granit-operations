import type { LeadStatus } from "../../conversations/repositories/lead-conversation-types.js";
import type { ManagerLeadRepository } from "../../conversations/repositories/manager-lead-repository.js";
import type { AiReviewLabel } from "../../conversations/repositories/manager-lead-repository.js";
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

export type RecordAiReviewLabelUseCaseInput = {
  actor: ManagerActor;
  leadId: string;
  aiRunId: string;
  label: AiReviewLabel;
  note?: string;
};

export type SetManagerAiControlUseCaseInput = {
  actor: ManagerActor;
  enabled: boolean;
  expectedVersion: number;
};

export type SetConversationAiControlUseCaseInput = {
  actor: ManagerActor;
  leadId: string;
  publicConversationId: string;
  enabled: boolean;
};

export class ManagerLeadUseCases {
  constructor(private readonly repository: ManagerLeadRepository) {}

  listLeads() {
    return this.repository.listManagerLeads();
  }

  getLead(leadId: string) {
    return this.repository.getManagerLead(leadId);
  }

  getAiControl() {
    if (!this.repository.getManagerAiControl) {
      throw new Error("manager AI control repository capability is unavailable");
    }

    return this.repository.getManagerAiControl();
  }

  setAiControl(input: SetManagerAiControlUseCaseInput) {
    assertManagerCanMutate(input.actor);

    if (!this.repository.setManagerAiControl) {
      throw new Error("manager AI control repository capability is unavailable");
    }

    return this.repository.setManagerAiControl({
      enabled: input.enabled,
      expectedVersion: input.expectedVersion,
      ...managerAuditFields(input.actor)
    });
  }

  setConversationAiControl(input: SetConversationAiControlUseCaseInput) {
    assertManagerCanMutate(input.actor);

    if (!this.repository.setConversationAiControl) {
      throw new Error("conversation AI control repository capability is unavailable");
    }

    return this.repository.setConversationAiControl({
      leadId: input.leadId,
      publicConversationId: input.publicConversationId,
      enabled: input.enabled,
      ...managerAuditFields(input.actor)
    });
  }

  recordAiReviewLabel(input: RecordAiReviewLabelUseCaseInput) {
    assertManagerCanMutate(input.actor);

    return this.repository.recordAiReviewLabel({
      leadId: input.leadId,
      aiRunId: input.aiRunId,
      label: input.label,
      note: input.note,
      ...managerAuditFields(input.actor)
    });
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
