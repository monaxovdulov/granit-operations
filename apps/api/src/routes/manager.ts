import type { FastifyInstance } from "fastify";

import type { ManagerAuthRuntime, RequestWithManager } from "../auth/manager-auth.js";
import {
  LEAD_STATUSES,
  isLeadStatus,
  type IntakeRepository
} from "../repositories/intake-repository.js";

export function registerManagerRoutes(
  app: FastifyInstance,
  repository: IntakeRepository,
  auth: ManagerAuthRuntime
) {
  app.get("/manager/leads", { preHandler: auth.requireManagerSession }, async () => {
    const leads = await repository.listManagerLeads();

    return { leads };
  });

  app.get<{ Params: { leadId: string } }>(
    "/manager/leads/:leadId",
    { preHandler: auth.requireManagerSession },
    async (request, reply) => {
      const lead = await repository.getManagerLead(request.params.leadId);

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );

  app.patch<{ Params: { leadId: string }; Body: { status?: unknown } }>(
    "/manager/leads/:leadId/status",
    { preHandler: auth.requireManagerSession },
    async (request, reply) => {
      const managerUser = (request as RequestWithManager).managerUser;

      if (!managerUser) {
        return reply.code(401).send({ error: "manager_auth_required" });
      }

      if (managerUser.role === "viewer") {
        return reply.code(403).send({ error: "manager_forbidden" });
      }

      if (!isLeadStatus(request.body?.status)) {
        return reply.code(400).send({
          error: "invalid_lead_status",
          allowed_statuses: LEAD_STATUSES
        });
      }

      const lead = await repository.changeManagerLeadStatus({
        leadId: request.params.leadId,
        status: request.body.status,
        changedByManagerId: managerUser.id,
        changedByManagerEmail: managerUser.email,
        changedByManagerRole: managerUser.role
      });

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );

  app.patch<{ Params: { leadId: string; publicSessionId: string } }>(
    "/manager/leads/:leadId/conversations/:publicSessionId/takeover",
    { preHandler: auth.requireManagerSession },
    async (request, reply) => {
      const managerUser = (request as RequestWithManager).managerUser;

      if (!managerUser) {
        return reply.code(401).send({ error: "manager_auth_required" });
      }

      if (managerUser.role === "viewer") {
        return reply.code(403).send({ error: "manager_forbidden" });
      }

      const lead = await repository.takeoverSiteWidgetConversation({
        leadId: request.params.leadId,
        publicSessionId: request.params.publicSessionId,
        changedByManagerId: managerUser.id,
        changedByManagerEmail: managerUser.email,
        changedByManagerRole: managerUser.role
      });

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );
}
