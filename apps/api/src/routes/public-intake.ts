import type { FastifyInstance } from "fastify";

import type { IntakeRepository } from "../repositories/intake-repository.js";
import { PublicIntakeService } from "../services/public-intake-service.js";
import { PublicWidgetIntakeService } from "../services/public-widget-intake-service.js";

export function registerPublicIntakeRoutes(
  app: FastifyInstance,
  repository: IntakeRepository
) {
  const service = new PublicIntakeService(repository);
  const widgetService = new PublicWidgetIntakeService(repository);

  app.post("/public/intake/site-form", async (request, reply) => {
    const result = await service.acceptSiteFormSubmission(request.body);

    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/public/intake/site-widget/messages", async (request, reply) => {
    const result = await widgetService.acceptSiteWidgetMessage(request.body);

    return reply.code(result.statusCode).send(result.body);
  });
}
