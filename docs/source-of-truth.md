# Source Of Truth

Status: active repo-local source map approved by the owner on 2026-08-04

`granit-operations` no longer depends on an external planning repository for AI
architecture, scope, gates or implementation order.

## Authority

Use two kinds of truth without mixing them:

1. Current executable behavior is established by the checked-out `main` SHA,
   public contracts, active Drizzle schema/migrations, runtime assembly and
   executable tests.
2. Target AI architecture and implementation order are established by accepted
   repo-local owner decisions, ADRs and the active `AI_REF_*` slice card.

The active decision hierarchy is:

1. `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`;
2. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
3. `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
4. `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`;
5. `docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
6. `docs/tasks/AI_REF_CONV_4_ACTIVE_DOCUMENTATION_RU.md`, единственная active
   AI-card, и exact-SHA evidence;
7. current code, contracts, migrations and tests for factual implementation
   details not decided above.

If prose and code disagree, do not silently describe the target as already
implemented. Code defines current behavior; accepted owner documents define the
target and roadmap. Record the gap in the current slice.

Historical task, evidence, design and ADR files may contain links to retired
external plans. Those links are provenance only and are not instructions or an
active source of truth.

## Current AI Direction

The approved architecture is:

```text
public intake
  -> app-owned PostgreSQL persistence and durable queue
  -> latest-wins / response-window identity / fresh context
  -> direct model boundary by default
  -> app-owned validation, commit fence and send gate
  -> atomic reply and terminal job commit
  -> app-owned observability and manager controls
```

Mastra dependency/runtime и executable `legacy_s05` path удалены принятым
CONV-3. Единственный production assembly использует app-owned direct model
boundary; возвращение второго runtime требует нового accepted ADR/owner gate.

Активный порядок определяется Goal `AI-RUNTIME-CONVERGENCE`: сейчас CONV-4,
затем CONV-5 и общий teach-back. PR0a—PR9, AI_DIALOG/Mastra и S01—S15 —
исторические этапы, не active routing.

## Active AI Route

Новый агент читает только:

1. корневой `README.md` и этот source map;
2. ADR-010 и ADR-012;
3. `AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md` и
   `AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
4. `AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md` и
   `AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
5. `AI_RUNTIME_CONVERGENCE_GOAL_RU.md` и active card из
   `docs/tasks/README.md`.

Завершённые task records сведены в `docs/tasks/ARCHIVE_RU.md`; archive и Git
history сохраняют provenance, но не расширяют обязательный контекст.

The current customer-facing landing source is decided by
`docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`.

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

## Release Boundary

This decision is not production approval. Production deploy, production
migrations, Telegram AI outbound, urgent notifications, raw AI trace capture
and any promotion of a staging adapter to primary runtime remain blocked unless
a later owner-approved release task explicitly allows them.

For customer-facing website/widget staging checks, pair `granit-operations` with the active landing repo `landing-granit-static`.
