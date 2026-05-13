# granit-operations

Private operations repository for Granit AI.

This repo owns the business operations application:

- public intake API for `site_form` now and `site_chat` later;
- operations-owned lead, customer, channel identity, conversation, message, status, handoff, follow-up, review, trace, and eval state;
- manager backend and manager panel;
- Telegram adapter in later slices;
- Mastra/OpenAI AI workflows in later slices;
- Postgres schema, migrations, backups, smoke, rollback, and release evidence.

## Source Of Truth

The canonical source of truth is the main wiki in the planning repo:

```text
/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/
```

Repo docs here are working implementation docs derived from that wiki. The full research archive and owner prompt pack are provenance and are not copied into this repo.

## Current Scope

The current implementation focus is the protected manager UI after accepted S02 auth evidence:

```text
React/Vite/Mantine manager panel -> same-origin protected manager API -> server-side Yandex session
```

S01 must prove no false success:

- no public thank-you, inline success, or WhatsApp continuation until the backend accepts and persists the lead;
- backend failure returns safe retry/fallback behavior;
- idempotency is expected for repeated public form submissions;
- public responses must not leak internal `lead_id`, `conversation_id`, `trace_id`, manager ids, eval labels, or handoff internals.

## Disabled Initially

- AI replies are disabled.
- Telegram is disabled.
- Website widget AI is disabled.
- Urgent production notifications are disabled until real destinations exist and delivery audit is proven.
- Full SEO migration belongs to `granit-site-cms` and is deferred.
- Production deploy requires explicit owner confirmation for a concrete release candidate.

## Initial Layout

```text
apps/api/          Fastify intake API
apps/manager/      React/Vite/Mantine manager panel
packages/contracts public intake contract artifacts
packages/db        Drizzle/Postgres schema and migrations
packages/shared    shared operations utilities placeholder
docs/              implementation docs derived from the main wiki
```

S01 currently publishes `site_form.v1` and exposes:

- `POST /public/intake/site-form`;
- `GET /manager/leads`;
- `GET /manager/leads/:leadId`.

S02 backend auth now protects manager visibility:

- `GET /auth/yandex/start`;
- `GET /auth/yandex/callback`;
- `POST /auth/logout`;
- `GET /manager` React manager app shell;
- `GET /manager/me`;
- protected `GET /manager/leads`;
- protected `GET /manager/leads/:leadId`.

First manager onboarding is owner/Codex/admin-command driven with `npm run seed:manager-user -- --email user@yandex.ru --role owner`; later owner-only UI can add `Настройки -> Команда`.

This is not a production deploy.
