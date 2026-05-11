# Source Of Truth

Status: initial scaffold

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

## Boundary

`granit-operations` owns operational truth:

- leads and customer records;
- channel identities;
- conversations and messages;
- manager workflow;
- Postgres operational state;
- intake API;
- AI workflows later;
- Telegram adapter later;
- observability/evals and review loop.

`granit-operations` does not own Astro public rendering, Payload public CMS content, public site media, or public SEO migration.

## Current Slice

Start with S01 only:

```text
website form -> operations intake API -> stored lead -> manager visibility
```

Do not skip forward to AI replies, Telegram, urgent production notifications, website widget AI, full SEO migration, or production deploy.
