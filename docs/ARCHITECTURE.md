# Architecture

Status: S03 manager UI slice needs review

Canonical sources:

- `/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/11-final-adr-foundation-stack.md`
- `/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/19-system-boundaries.md`
- `/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/22-ts-stack-focus.md`

`granit-operations` is the business operations application.

Target shape:

```text
Fastify/Drizzle intake API
manager backend and manager panel
Telegram adapter later
Mastra/OpenAI AI workflows later
Postgres operational state
observability/evals/review loop
deploy/smoke/rollback scripts later
```

Current focus:

```text
React/Vite/Mantine manager panel -> protected manager API -> server-side Yandex session
```

Protected manager access:

```text
manager.botops.ru
  -> Yandex ID login
  -> operations allowlist/role check
  -> server-side session
  -> manager UI/API
```

Yandex identity is authentication only. Authorization remains operations-owned through DB users, roles, and statuses.

Initial layout:

```text
apps/api/          Fastify intake API, auth routes, manager static app host
apps/manager/      React/Vite/Mantine manager panel
packages/contracts public intake contract artifacts
packages/db        Drizzle/Postgres schema and migrations
packages/shared    operations-local shared utilities
docs/              implementation docs derived from the main wiki
```

Route handlers should be protocol adapters. Domain services own business behavior and must not rely on hidden request/reply mutation.

Do not add AI replies, Telegram, widget AI, urgent production notifications, full SEO migration, or production deploy in S03.
