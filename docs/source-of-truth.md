# Source Of Truth

Status: active repo-local source map, refreshed for current runtime on 2026-08-27

<!-- architecture-guard: active-ai-documents
AGENTS.md
README.md
docs/AGENT_WORKFLOW.md
docs/AI_POLICY.md
docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md
docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md
docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md
docs/architecture/AI_CURRENT_RUNTIME_RU.md
docs/source-of-truth.md
docs/tasks/README.md
-->

`granit-operations` no longer depends on an external planning repository for AI
architecture, scope, gates or implementation order.

## Authority

Не смешивайте четыре уровня:

1. Текущее исполняемое поведение определяют проверяемый checkout SHA,
   production assembly, публичные контракты, Drizzle schema/migrations и
   executable tests.
2. Короткая проверенная карта этого поведения находится в
   `docs/architecture/AI_CURRENT_RUNTIME_RU.md`. Она не заменяет код.
3. Принятые решения и ограничения находятся в
   `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md`,
   `docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`,
   `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md` и
   `docs/AI_POLICY.md`.
4. Порядок работы задают `AGENTS.md` и `docs/AGENT_WORKFLOW.md`. Отдельная
   задача становится текущей только по явной команде владельца и отражается в
   `docs/tasks/README.md`; сейчас active AI-card отсутствует.

Routing/lifecycle ссылки внутри принятых документов на прежние Goal и cards —
исторический контекст. Они не возвращают заменённый процесс и не создают второй
roadmap. Если prose и код расходятся, prose нельзя выдавать за уже
реализованное состояние.

## Current AI Runtime

Фактический production route на проверенном SHA:

```text
public intake
  -> app-owned PostgreSQL persistence and durable queue
  -> fresh app-owned conversation context
  -> executeModelTurn
  -> model-owned bounded search_catalog при необходимости
  -> app-owned validation, commit fence and send gate
  -> atomic reply and terminal job commit
  -> app-owned observability and manager controls
```

Первый model call выбирает `final` или `search_catalog`; search path допускает
ровно один второй model call. Приложение валидирует output и recommendation
IDs, перечитывает send gate и только затем допускает atomic persistence.
Подробности и оставшийся executable legacy debt зафиксированы в current-runtime
map без объявления будущей расчистки реализованной.

## Active AI Route

Для runtime-задачи новый агент идёт коротким маршрутом:

1. `README.md` и этот source map;
2. `docs/architecture/AI_CURRENT_RUNTIME_RU.md`;
3. применимые `docs/AI_POLICY.md` и принятые ADR-010—ADR-012;
4. `docs/tasks/README.md`, чтобы проверить наличие отдельно активированной
   карточки.

Процессные правила уже приходят из `AGENTS.md` и
`docs/AGENT_WORKFLOW.md`. Они не требуют чтения прежних Goal/process roadmaps.

## Historical provenance

Сохранены без роли обязательного маршрута:

- `docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
- `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`;
- `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
- `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
- `docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md`;
- `docs/tasks/AI_REF_AILR_00_RUNTIME_HARNESS_MAP_RU.md`;
- `docs/tasks/AI_REF_AILR_01_VALIDATOR_OBSERVABILITY_RU.md`;
- `docs/tasks/AI_REF_AILR_02_VALIDATOR_POLICY_RU.md`;
- `docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md`;
- `docs/tasks/ARCHIVE_RU.md`.

Git history и эти records сохраняют происхождение решений, но не продолжают
работу автоматически.

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
