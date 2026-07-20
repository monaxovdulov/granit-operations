# Source Of Truth

Status: active source map updated on 2026-07-20

The canonical source of truth for architecture, scope, gates, and implementation order is:

```text
/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/
```

Primary wiki pages for this repo:

- `00-current-brief.md`
- `02-product-requirements.md`
- `04-lead-pipeline-and-crm.md`
- `05-handoff-and-human-control.md`
- `06-channels-identity-memory.md`
- `07-agent-architecture.md`
- `12-open-questions.md`
- `15-observability-contract.md`
- `19-system-boundaries.md`
- `23-production-ready-first-release.md`
- `24-agent-driven-production-flow.md`
- `25-first-implementation-slices.md`

Repo-local docs are working implementation docs. They should copy only the specs needed to build and verify the current slice.

The research outputs, reviews, owner briefs, and prompt packs under the planning repo are archive/provenance after the 2026-05-11 wiki import. Do not copy them wholesale into this repo.

Repo-local decision for the current customer-facing landing source: `docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`.

## Boundary

`granit-operations` owns operational truth:

- leads and customer records;
- channel identities;
- conversations and messages;
- manager workflow;
- Postgres operational state;
- intake API;
- app-owned website widget AI runtime and future AI workflow slices;
- Telegram inbound/manager delivery adapters; Telegram AI outbound remains blocked;
- observability/evals and review loop.

`granit-operations` does not own Astro public rendering, Payload public CMS content, public site media, or public SEO migration.

## Current External Repo Map

For customer-facing website/widget work, the current active landing repository is:

- GitHub: `monaxovdulov/landing-granit-static`
- Local checkout: `/home/devuser/ai-projects/landing-granit-static`
- Role: static customer-facing landing and browser form/widget integration that must be paired-smoked against the `granit-operations` public API before customer-facing staging use.

`granit-site-cms` is not the current active customer-facing landing source for AI/widget staging. Treat it as a separate Astro/CMS baseline or future CMS path unless a later accepted ADR/task explicitly promotes it back into the active rollout path.

Historical release evidence may mention paired smoke with `granit-site-cms`; do not infer the current landing source from those old evidence records. Use ADR-011 and this section for current agent work.

## Current Runtime Slice

The original scaffold started with S01:

```text
website form -> operations intake API -> stored lead -> manager visibility
```

`main` has since advanced beyond that scaffold. The current staging candidate includes the app-owned website widget AI runtime, grounded generator/verifier boundary, send gate, manager controls and sanitized quality visibility.

This is still not production approval. Production deploy, production migrations, Telegram AI outbound, urgent notifications, raw AI trace capture and Mastra as a primary runtime remain blocked unless a later owner-approved release task explicitly allows them.

For customer-facing website/widget staging checks, pair `granit-operations` with the active landing repo `landing-granit-static`.
