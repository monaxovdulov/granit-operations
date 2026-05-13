import Fastify from "fastify";

import { createManagerAuth, type ManagerAuthOptions } from "./auth/manager-auth.js";
import type { IntakeRepository } from "./repositories/intake-repository.js";
import { registerManagerAuthRoutes } from "./routes/manager-auth.js";
import {
  registerManagerShellRoutes,
  type ManagerShellOptions
} from "./routes/manager-shell.js";
import { registerManagerRoutes } from "./routes/manager.js";
import { registerPublicIntakeRoutes } from "./routes/public-intake.js";

export type BuildApiOptions = {
  repository: IntakeRepository;
  managerAuth?: ManagerAuthOptions;
  managerShell?: ManagerShellOptions;
  logger?: boolean;
};

export function buildApi(options: BuildApiOptions) {
  const app = Fastify({ logger: options.logger ?? false });
  const managerAuth = createManagerAuth(options.managerAuth);

  app.get("/health", async () => ({
    ok: true,
    service: "granit-operations-api"
  }));

  registerPublicIntakeRoutes(app, options.repository);
  registerManagerAuthRoutes(app, managerAuth);
  registerManagerShellRoutes(app, options.managerShell);
  registerManagerRoutes(app, options.repository, managerAuth);

  return app;
}
