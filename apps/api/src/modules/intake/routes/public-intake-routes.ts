import type { FastifyInstance } from "fastify";

import type { PublicIntakeServiceResult } from "../use-cases/public-intake-service.js";
import type { PublicWidgetIntakeServiceResult } from "../use-cases/public-widget-intake-service.js";

export type PublicIntakeRouteUseCases = {
  siteForm: {
    acceptSiteFormSubmission(rawBody: unknown): Promise<PublicIntakeServiceResult>;
  };
  siteWidget: {
    acceptSiteWidgetMessage(rawBody: unknown): Promise<PublicWidgetIntakeServiceResult>;
  };
};

export function registerPublicIntakeRoutes(
  app: FastifyInstance,
  useCases: PublicIntakeRouteUseCases
) {
  app.post("/site-form", async (request, reply) => {
    const result = await useCases.siteForm.acceptSiteFormSubmission(request.body);

    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/site-widget/messages", async (request, reply) => {
    const result = await useCases.siteWidget.acceptSiteWidgetMessage(request.body);

    return reply.code(result.statusCode).send(result.body);
  });
}
