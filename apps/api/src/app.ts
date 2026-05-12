import Fastify from "fastify";

import type { IntakeRepository } from "./repositories/intake-repository.js";
import { registerManagerRoutes } from "./routes/manager.js";
import { registerPublicIntakeRoutes } from "./routes/public-intake.js";

export type BuildApiOptions = {
  repository: IntakeRepository;
  logger?: boolean;
};

export function buildApi(options: BuildApiOptions) {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", async () => ({
    ok: true,
    service: "granit-operations-api"
  }));

  registerPublicIntakeRoutes(app, options.repository);
  registerManagerRoutes(app, options.repository);

  return app;
}
