import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

import type { PublicIntakeServiceResult } from "../use-cases/public-intake-service.js";
import type {
  PublicWidgetHistoryServiceResult,
  PublicWidgetIntakeServiceResult
} from "../use-cases/public-widget-intake-service.js";

export type PublicIntakeRouteUseCases = {
  siteForm: {
    acceptSiteFormSubmission(rawBody: unknown): Promise<PublicIntakeServiceResult>;
  };
  siteWidget: {
    acceptSiteWidgetMessage(rawBody: unknown): Promise<PublicWidgetIntakeServiceResult>;
    getSiteWidgetHistory(
      publicSessionId: string,
      schemaVersion?: "site_widget.history.v1" | "site_widget.history.v2"
    ): Promise<PublicWidgetHistoryServiceResult>;
  };
};

export type PublicIntakeRouteOptions = {
  cors?: {
    allowedOrigins: string[];
  };
};

export function registerPublicIntakeRoutes(
  app: FastifyInstance,
  useCases: PublicIntakeRouteUseCases,
  options: PublicIntakeRouteOptions = {}
) {
  app.register(
    async (publicRoutes) => {
      const allowedOrigins = options.cors?.allowedOrigins ?? [];

      if (allowedOrigins.length > 0) {
        await publicRoutes.register(cors, {
          origin: (origin, callback) => {
            callback(null, Boolean(origin && allowedOrigins.includes(origin)));
          },
          methods: ["GET", "POST", "OPTIONS"],
          allowedHeaders: ["content-type", "accept"],
          credentials: false
        });
      }

      publicRoutes.options("/intake/site-form", async (_request, reply) =>
        reply.code(204).send()
      );
      publicRoutes.options("/intake/site-widget/messages", async (_request, reply) =>
        reply.code(204).send()
      );

      registerPublicIntakeRouteHandlers(publicRoutes, useCases);
    },
    { prefix: "/public" }
  );
}

function registerPublicIntakeRouteHandlers(
  app: FastifyInstance,
  useCases: PublicIntakeRouteUseCases
) {
  app.post("/intake/site-form", async (request, reply) => {
    const result = await useCases.siteForm.acceptSiteFormSubmission(request.body);

    return reply.code(result.statusCode).send(result.body);
  });

  app.post("/intake/site-widget/messages", async (request, reply) => {
    const result = await useCases.siteWidget.acceptSiteWidgetMessage(request.body);

    return reply.code(result.statusCode).send(result.body);
  });

  app.get<{
    Params: { publicSessionId: string };
    Querystring: { schema_version?: string };
  }>(
    "/intake/site-widget/sessions/:publicSessionId/history",
    async (request, reply) => {
      const result = await useCases.siteWidget.getSiteWidgetHistory(
        request.params.publicSessionId,
        request.query.schema_version === "site_widget.history.v2"
          ? "site_widget.history.v2"
          : "site_widget.history.v1"
      );

      return reply.code(result.statusCode).send(result.body);
    }
  );
}
