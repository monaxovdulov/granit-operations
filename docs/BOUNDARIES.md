# Boundaries

Status: active repo-local boundary map updated on 2026-08-04

Canonical sources: `docs/source-of-truth.md`, repo-local ADRs and current code.

`granit-operations` owns operational truth:

- public intake API for `site_form` and later `site_chat`;
- leads and customer records;
- channel identities;
- conversations and messages;
- manager workflow;
- operational Postgres schema, migrations, and persistence services;
- manager backend and manager panel;
- Telegram inbound and manager-authored delivery adapters;
- app-owned website widget AI queue, runtime assembly and send gate;
- one direct server-side model boundary;
- observability/evals and review loop.

This repo must not own:

- Astro public-site rendering;
- Payload CMS public content/admin;
- public media and public SEO editorial workflow;
- public-page copy as the normal editing path;
- raw Payload content database ownership;
- public SEO migration as a site implementation task;
- unreviewed production deploys.

Model providers, Mastra, traces, Telegram, future telephony and observability
tools must not become the source of truth for queue state, lead status, manager
assignment, handoff, reminders or customer identity.

Shared contract rule:

- operations publishes a versioned public intake contract;
- `landing-granit-static` consumes a pinned version for the active rollout;
- browser/site repositories must not import operations implementation code or
  receive operations Postgres credentials.

Manager auth boundary:

- `granit-operations` owns manager login, sessions, users, roles, and allowlist.
- Yandex ID can authenticate a person, but operations decides authorization.
- `granit-site-cms` must not own manager users, roles, sessions, or private manager routes.
- Public intake remains separate from manager auth.
