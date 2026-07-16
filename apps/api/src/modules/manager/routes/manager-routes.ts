import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ManagerAuthRuntime } from "../../auth/manager-auth.js";
import type { AuthenticatedManager } from "../../auth/repositories/manager-auth-repository.js";
import {
  LEAD_STATUSES,
  isLeadStatus
} from "../../conversations/repositories/lead-conversation-types.js";
import { AiControlVersionConflictError } from "../../conversations/repositories/manager-lead-repository.js";
import { ManagerForbiddenError } from "../use-cases/manager-actor.js";
import type { ManagerLeadUseCases } from "../use-cases/manager-lead-use-cases.js";

export function registerManagerRoutes(
  app: FastifyInstance,
  useCases: ManagerLeadUseCases,
  auth: ManagerAuthRuntime
) {
  app.get("/manager/ai-control", async (request, reply) => {
    const manager = await authenticateManager(request, reply, auth);

    if (!manager) {
      return;
    }

    return { control: await useCases.getAiControl() };
  });

  app.patch<{ Body: { enabled?: unknown; version?: unknown } }>(
    "/manager/ai-control",
    async (request, reply) => {
      const manager = await authenticateManager(request, reply, auth);

      if (!manager) {
        return;
      }

      if (
        typeof request.body?.enabled !== "boolean" ||
        typeof request.body?.version !== "number" ||
        !Number.isInteger(request.body.version) ||
        Number(request.body.version) < 1
      ) {
        return reply.code(400).send({ error: "invalid_ai_control" });
      }

      const control = await mapManagerError(reply, () =>
        useCases.setAiControl({
          actor: manager,
          enabled: request.body.enabled as boolean,
          expectedVersion: request.body.version as number
        })
      );

      if (control === "mapped_error") {
        return;
      }

      return { control };
    }
  );

  app.get("/manager/leads", async (request, reply) => {
    const manager = await authenticateManager(request, reply, auth);

    if (!manager) {
      return;
    }

    const leads = await useCases.listLeads();

    return { leads };
  });

  app.get<{ Params: { leadId: string } }>(
    "/manager/leads/:leadId",
    async (request, reply) => {
      const manager = await authenticateManager(request, reply, auth);

      if (!manager) {
        return;
      }

      const lead = await useCases.getLead(request.params.leadId);

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );

  app.patch<{ Params: { leadId: string }; Body: { status?: unknown } }>(
    "/manager/leads/:leadId/status",
    async (request, reply) => {
      const manager = await authenticateManager(request, reply, auth);

      if (!manager) {
        return;
      }

      if (!isLeadStatus(request.body?.status)) {
        return reply.code(400).send({
          error: "invalid_lead_status",
          allowed_statuses: LEAD_STATUSES
        });
      }

      const status = request.body.status;
      const lead = await mapManagerError(reply, () =>
        useCases.changeStatus({
          actor: manager,
          leadId: request.params.leadId,
          status
        })
      );

      if (lead === "mapped_error") {
        return;
      }

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );

  app.patch<{ Params: { leadId: string; publicConversationId: string } }>(
    "/manager/leads/:leadId/conversations/:publicConversationId/takeover",
    async (request, reply) => {
      const manager = await authenticateManager(request, reply, auth);

      if (!manager) {
        return;
      }

      const lead = await mapManagerError(reply, () =>
        useCases.takeoverConversation({
          actor: manager,
          leadId: request.params.leadId,
          publicConversationId: request.params.publicConversationId
        })
      );

      if (lead === "mapped_error") {
        return;
      }

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );

  app.patch<{
    Params: { leadId: string; publicConversationId: string };
    Body: { enabled?: unknown };
  }>(
    "/manager/leads/:leadId/conversations/:publicConversationId/ai-control",
    async (request, reply) => {
      const manager = await authenticateManager(request, reply, auth);

      if (!manager) {
        return;
      }

      if (typeof request.body?.enabled !== "boolean") {
        return reply.code(400).send({ error: "invalid_conversation_ai_control" });
      }

      const lead = await mapManagerError(reply, () =>
        useCases.setConversationAiControl({
          actor: manager,
          leadId: request.params.leadId,
          publicConversationId: request.params.publicConversationId,
          enabled: request.body.enabled as boolean
        })
      );

      if (lead === "mapped_error") {
        return;
      }

      if (!lead) {
        return reply.code(404).send({ error: "not_found" });
      }

      return { lead };
    }
  );
}

async function authenticateManager(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: ManagerAuthRuntime
): Promise<AuthenticatedManager | null> {
  const user = await auth.authenticateSession({ cookieHeader: readCookieHeader(request) });

  if (!user) {
    await reply.code(401).send({ error: "manager_auth_required" });
    return null;
  }

  return user;
}

async function mapManagerError<T>(
  reply: FastifyReply,
  operation: () => Promise<T>
): Promise<T | "mapped_error"> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiControlVersionConflictError) {
      await reply.code(409).send({ error: "ai_control_version_conflict" });
      return "mapped_error";
    }

    if (error instanceof ManagerForbiddenError) {
      await reply.code(403).send({ error: "manager_forbidden" });
      return "mapped_error";
    }

    throw error;
  }
}

function readCookieHeader(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;

  return Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;
}
