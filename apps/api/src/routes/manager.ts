import type { FastifyInstance } from "fastify";

import type { IntakeRepository } from "../repositories/intake-repository.js";

export function registerManagerRoutes(app: FastifyInstance, repository: IntakeRepository) {
  app.get("/manager/leads", async () => {
    const leads = await repository.listManagerLeads();

    return { leads };
  });

  app.get<{ Params: { leadId: string } }>("/manager/leads/:leadId", async (request, reply) => {
    const lead = await repository.getManagerLead(request.params.leadId);

    if (!lead) {
      return reply.code(404).send({ error: "not_found" });
    }

    return { lead };
  });
}
