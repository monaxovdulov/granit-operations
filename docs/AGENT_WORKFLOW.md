# Agent Workflow - granit-operations

Status: active source map updated on 2026-07-20
Repo role: intake API, manager workflow, Postgres operational state, app-owned website widget AI runtime, Telegram manager delivery path, observability/evals

## Before Editing

1. Read `docs/source-of-truth.md`.
2. Read planning source-of-truth docs for boundaries and slice order.
3. Check `git status --short`.
4. Read `.agents/state/granit-dev-workflow.json` if it exists.
5. Do not overwrite unrelated dirty work.

## Current External Repo Map

- `granit-operations`: backend/API, Postgres operational state, manager panel, AI runtime, app-owned send gate, CORS, observability/evals.
- `monaxovdulov/landing-granit-static`: current customer-facing static landing and browser form/widget integration. Local checkout: `/home/devuser/ai-projects/landing-granit-static`.
- `granit-site-cms`: not the current customer-facing landing source for AI/widget staging. Do not use it as the paired-smoke target unless a later accepted ADR/task explicitly promotes it.

When staging the website widget AI path, pair-smoke against the active `landing-granit-static` consumer and the `granit-operations` public API.

## Where To Write

| Record | Path |
|---|---|
| Human-readable status | `docs/PROJECT_STATUS_RU.md` |
| Repo-local ADRs | `docs/adr/` |
| Task docs | `docs/tasks/` |
| Smoke/review/release evidence | `docs/release/evidence/` |
| Machine-readable state | `.agents/state/granit-dev-workflow.json` |

## ADR Rules

Use repo-local ADRs only for meaningful operations decisions that do not change cross-project architecture.

Examples:

- implementation details for intake persistence;
- manager panel local structure;
- operations-only observability storage detail;
- operations-only backup procedure detail.

Architecture, repo boundaries, release/deploy policy, AI gates and implementation
order for this repository are decided in repo-local owner docs and ADRs. The
active AI order is `PR0a-PR9`; historical external planning links are provenance
only.

## Task Rules

Every agent task should create or update a file in `docs/tasks/`. Use `docs/tasks/TEMPLATE_RU.md`.

For S01, tasks must explicitly say whether the work touches:

- public intake API;
- provider contract;
- database schema/migration;
- manager visibility;
- idempotency;
- validation/failure behavior;
- release smoke/evidence.

Database schema, migrations, auth, AI policy, notification destinations, deploy, and backup/restore are review-required.

## Evidence Rules

Use `docs/release/evidence/` for smoke/review/release proof. Do not store secrets, DB URLs, tokens, raw lead data, private notification destinations, deployment credentials, or full private logs.

For S01 provider evidence, record:

- contract version `site_form.v1`;
- request accepted only after persistence;
- lead visible in manager read surface;
- failure path result;
- idempotency behavior;
- public response does not leak internal ids/traces;
- paired smoke link to active `landing-granit-static` evidence.

## State Updates

Update `.agents/state/granit-dev-workflow.json` after meaningful steps:

- mode/state;
- current git HEAD;
- dirty summary;
- task summary;
- checks run;
- next safe action.

State points to docs. It does not replace task/evidence docs.

## Owner Confirmation Required

Ask before:

- staging or production deploy;
- changing deploy scripts, Docker, proxy, runtime env, or server routing;
- changing DB schema/migrations after review has started;
- changing auth, permissions, secrets, env files, backup/restore, or notification destinations;
- changing public intake contract behavior;
- enabling AI, Telegram, urgent notifications, or widget AI;
- changing takeover, handoff, `agent_allowed_to_reply`, prompts, tools, model settings, or eval gates.

## GitHub Issues Note

GitHub Issues can later become the external board for assignments and discussion. This repo still keeps task and evidence docs because they are the durable implementation record.
