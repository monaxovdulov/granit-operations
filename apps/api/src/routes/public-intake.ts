import type { FastifyInstance } from "fastify";

import type { IntakeRepository } from "../repositories/intake-repository.js";
import { PublicIntakeService } from "../services/public-intake-service.js";

export function registerPublicIntakeRoutes(
  app: FastifyInstance,
  repository: IntakeRepository
) {
  const service = new PublicIntakeService(repository);

  app.post("/public/intake/site-form", async (request, reply) => {
    const result = await service.acceptSiteFormSubmission(request.body);

    return reply.code(result.statusCode).send(result.body);
  });
}
