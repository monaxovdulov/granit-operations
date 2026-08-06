# ADR-012: Repo-local AI Source Of Truth

Status: accepted by owner
Date: 2026-08-04
Repo scope: `granit-operations`
Related active Goal: `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md`;
retired task provenance: `docs/tasks/ARCHIVE_RU.md`

Current-state reconciliation (2026-08-06): this ADR's ownership decision remains
accepted, while its original PR0a—PR9 sequencing and bounded-Mastra wording are
historical. The current implementation order is the active
`AI-RUNTIME-CONVERGENCE` Goal/card. CONV-3 removed the Mastra dependency/runtime
and executable `legacy_s05`; returning a second runtime requires a new accepted
ADR and owner stop-gate. Historical wording below is retained as decision
provenance, not active routing.

## Context

Старые внешние planning-документы описывали Mastra-based workflow runtime и
порядок S01-S15. Позже owner-review текущего кода принял другую архитектуру:
app-owned PostgreSQL queue, latest-wins, fresh context, direct runtime boundary
и последовательный AI-roadmap PR0a-PR9.

Локальный `source-of-truth.md` продолжал объявлять внешний wiki каноном. Это
создавало риск, что следующий агент вернёт Mastra как primary orchestrator или
пойдёт по устаревшему delivery order вопреки текущему коду и owner-решениям.

## Decision

`granit-operations` является самодостаточным источником истины для своей AI
архитектуры, runtime ownership, gates и implementation order.

Текущие факты определяются кодом, контрактами, активными migrations и тестами
на проверяемом SHA. Целевая архитектура определяется repo-local owner docs,
принятыми ADR и текущей карточкой AI-среза.

Primary architecture:

```text
app-owned PostgreSQL queue
  -> latest-wins and fresh context
  -> direct model boundary by default
  -> app-owned validation and commit fence
  -> app-owned send gate and manager takeover
  -> atomic persisted reply/job outcome
```

Первоначально утверждённый roadmap:
`PR0a -> PR0b -> PR0c -> PR1 -> ... -> PR9`; его текущая замена указана в
reconciliation note выше.

Mastra не является primary runtime, source of truth или roadmap owner.
На момент принятия ADR `mastra_openai_api` сохранялся только как bounded staging
adapter и не владел queue semantics, business state, send gate, public
contracts, migrations или manager controls. Его последующее удаление
зафиксировано reconciliation note выше.

Старые task, evidence, design и ADR могут хранить внешние ссылки как provenance.
Такие ссылки не являются действующими инструкциями. Для текущей работы не
требуется читать или синхронизировать внешний planning repository.

## Consequences

- Новые AI-задачи начинаются с `README.md`, `docs/source-of-truth.md`, этого ADR,
  актуальных owner architecture docs и текущей `AI_REF_*` карточки.
- Расхождение кода и target docs фиксируется как gap, а не скрывается выбором
  удобного источника.
- Изменение runtime ownership или roadmap снова требует owner stop-gate.
- Другие репозитории затрагиваются только отдельным явно одобренным task.
- Исторические evidence-файлы не переписываются задним числом.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Сохранить внешний wiki абсолютным каноном | Он противоречит принятому owner roadmap и текущей роли Mastra. |
| Переписать все исторические task/evidence | Это уничтожит provenance и создаст ложную историю решений. |
| Удалить Mastra-код немедленно | Существующий bounded staging path является отдельным cleanup/runtime решением и не нужен для смены источника истины. |

## Owner Impact

Владелец и агенты могут анализировать удалённый `main` без загрузки отдельного
planning repo. Текущая система и план переделки находятся в одном репозитории.

## Links

- `docs/source-of-truth.md`
- `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`
- `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`
- `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`
- `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md`
