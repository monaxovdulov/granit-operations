import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";

const DEFAULT_MANAGER_DIST_ROOT = fileURLToPath(new URL("../../../manager/dist/", import.meta.url));

export type ManagerShellOptions = {
  distRoot?: string;
};

export function registerManagerShellRoutes(
  app: FastifyInstance,
  options: ManagerShellOptions = {}
) {
  const distRoot = options.distRoot ?? DEFAULT_MANAGER_DIST_ROOT;
  const assetsRoot = path.join(distRoot, "assets");

  if (existsSync(assetsRoot)) {
    app.register(fastifyStatic, {
      root: assetsRoot,
      prefix: "/manager/assets/",
      decorateReply: false,
      maxAge: "1h",
      immutable: true
    });
  }

  app.get("/", async (_request, reply) => sendManagerIndex(reply, distRoot));
  app.get("/manager", async (_request, reply) => sendManagerIndex(reply, distRoot));
  app.get("/manager/", async (_request, reply) => reply.redirect("/manager"));
}

async function sendManagerIndex(reply: FastifyReply, distRoot: string) {
  const indexPath = path.join(distRoot, "index.html");

  reply.header("content-type", "text/html; charset=utf-8");
  reply.header("x-robots-tag", "noindex, nofollow");
  reply.header("cache-control", "no-store");

  try {
    return reply.send(await readFile(indexPath, "utf8"));
  } catch {
    return reply.code(503).send(renderMissingBuildPage());
  }
}

function renderMissingBuildPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Granit Manager</title>
</head>
<body>
  <main style="font-family: system-ui, sans-serif; padding: 24px;">
    <h1>Manager app is not built</h1>
    <p>Run <code>npm -w @granit/manager run build</code> before serving /manager.</p>
  </main>
</body>
</html>`;
}
