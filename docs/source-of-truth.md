# Source Of Truth

Status: active repo-local source map approved by the owner on 2026-08-04

<!-- architecture-guard: active-ai-documents
AGENTS.md
README.md
docs/AGENT_WORKFLOW.md
docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md
docs/AI_POLICY.md
docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md
docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md
docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md
docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md
docs/source-of-truth.md
docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md
docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md
docs/tasks/README.md
-->

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
6. `docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md`, единственная active
   AI-card, и exact-SHA evidence трёх repo;
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

Goal `AI-RUNTIME-CONVERGENCE` закрыта как `understanding_verified`. Активный
порядок определяется Goal `AI-LAYER-SIMPLIFICATION`: AILR-00, AILR-01 и AILR-02
приняты. Текущий AILR-03 OneShot объединяет прежние catalog-срезы 03—06: от
versioned authority и server-validated recommendation IDs до `history.v2`
кнопки, focus в актуальном каталоге и deterministic transcript eval. Он не
получает право на commit/push/deploy без отдельной команды владельца.
PR0a—PR9, CONV-1—CONV-5,
AI_DIALOG/Mastra и S01—S15 — исторические этапы, не active routing.

## Active AI Route

Новый агент читает только:

1. корневой `README.md` и этот source map;
2. текущую `docs/AI_POLICY.md`, ADR-010 и ADR-012;
3. `AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md` и
   `AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
4. `AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md` и
   `AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
5. `AI_LAYER_SIMPLIFICATION_GOAL_RU.md` и active card из
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
