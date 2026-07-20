# ADR-011: Customer-Facing Landing Source

Status: accepted
Date: 2026-07-20
Repo scope: `granit-operations`
Related docs: `docs/source-of-truth.md`, `docs/SMOKE_TESTS.md`, `docs/AGENT_WORKFLOW.md`

## Context

Некоторые старые task/evidence docs в `granit-operations` упоминают paired smoke с `granit-site-cms`. Это было верно для соответствующего исторического контекста, но больше не является актуальной картой rollout.

Текущий customer-facing лендинг находится в другом репозитории:

```text
GitHub: monaxovdulov/landing-granit-static
Local:  /home/devuser/ai-projects/landing-granit-static
```

На момент фиксации локальный checkout `landing-granit-static` был на ветке `codex/site-widget-v1.0.0-rc` с head `2beffef648d42997a50ed123c304ff1103e06b5f`. Перед любым rollout агент должен перепроверять актуальную ветку и SHA.

`granit-site-cms` продолжает существовать как отдельный Astro/CMS baseline или future CMS path, но не является текущим источником customer-facing лендинга для AI/widget staging.

## Decision

For customer-facing website widget work and staging smoke with customers:

- `granit-operations` owns backend/API, Postgres operational state, manager panel, AI runtime, app-owned send gate, CORS, DB migrations and observability/evals.
- `monaxovdulov/landing-granit-static` owns the current static landing and browser form/widget integration.
- paired smoke for website form/widget paths must use `landing-granit-static` as the active consumer of the `granit-operations` public API.
- `granit-site-cms` must not be used as the current paired-smoke target unless a later accepted ADR/task explicitly promotes it back into the active rollout path.

Historical evidence that mentions `granit-site-cms` stays historical. Agents must not treat those old mentions as current rollout instructions.

## Consequences

Before staging customer testing of the website widget AI path, verify:

- the active `landing-granit-static` branch/commit intended for staging;
- browser endpoint wiring points to the intended `granit-operations` staging API;
- `granit-operations` CORS allows the exact staging landing origin and does not rely on broad production-style wildcards;
- the paired browser smoke covers public response privacy, persistence, manager visibility, fallback/takeover behavior and send-gate behavior.

Docs or evidence for new rollout work should say `landing-granit-static`, not `site-cms`, unless the task is explicitly about the CMS repo.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep using `granit-site-cms` as the paired-smoke label | Rejected because it points future agents at the wrong current landing source. |
| Rename or rewrite historical evidence records | Rejected because old evidence should remain factual for its original date. Current docs now explain how to interpret it. |
| Move the decision only into chat history | Rejected because future agents need repo-local durable guidance. |

## Owner Impact

The owner can ask agents to prepare staging/customer widget testing without re-explaining which landing repo is real. Agents should read this ADR before touching website/widget rollout evidence.

## Links

- Source of truth: `docs/source-of-truth.md`
- Agent workflow: `docs/AGENT_WORKFLOW.md`
- Smoke expectations: `docs/SMOKE_TESTS.md`
- Evidence template: `docs/release/evidence/TEMPLATE_RU.md`
