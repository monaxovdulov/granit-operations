# Architecture

Status: initial scaffold

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

Current S01 focus:

```text
website form -> operations intake API -> stored lead -> manager visibility
```

Initial layout:

```text
apps/api/          Fastify intake API placeholder
apps/manager/      manager panel placeholder
packages/contracts public intake contract artifacts
packages/db        Drizzle/Postgres schema placeholder
packages/shared    operations-local shared utilities
docs/              implementation docs derived from the main wiki
```

Route handlers should be protocol adapters. Domain services own business behavior and must not rely on hidden request/reply mutation.

Do not add AI replies, Telegram, widget AI, urgent production notifications, full SEO migration, or production deploy in S01.
