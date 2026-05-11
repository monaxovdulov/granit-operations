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

The current implementation focus is S01:

```text
website form -> operations intake API -> stored lead -> manager visibility
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
apps/api/          Fastify intake API placeholder
apps/manager/      manager panel placeholder
packages/contracts public intake contract artifacts
packages/db        Drizzle/Postgres schema placeholder
packages/shared    shared operations utilities placeholder
docs/              implementation docs derived from the main wiki
```

No app dependencies are installed in this scaffold.
