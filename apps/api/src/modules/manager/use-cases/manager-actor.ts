export type ManagerActor = {
  id: string;
  email: string;
  role: "owner" | "manager" | "viewer";
};

export class ManagerForbiddenError extends Error {
  constructor() {
    super("manager role is not allowed to perform this action");
    this.name = "ManagerForbiddenError";
  }
}

export function assertManagerCanMutate(actor: ManagerActor): void {
  if (actor.role === "viewer") {
    throw new ManagerForbiddenError();
  }
}

export function managerAuditFields(actor: ManagerActor) {
  return {
    changedByManagerId: actor.id,
    changedByManagerEmail: actor.email,
    changedByManagerRole: actor.role
  };
}
