# Архив завершённых task records

Статус: historical index; не является active roadmap или источником текущих
инструкций.

Этот индекс заменяет завершённые и дублирующие task-планы, удалённые из
рабочего дерева в CONV-4. Полный текст каждого документа остаётся в Git history
до commit CONV-4. Текущие факты всегда сверяются с `main`, accepted ADR,
release evidence и активной карточкой из `docs/tasks/README.md`.

## AI runtime convergence

| Завершённый срез | Published commit | Текущий источник |
|---|---|---|
| CONV-1 direct live-v2 adapter | `aff347bb00d07f8ee40f86203bd27a6a99b5b40f` | Goal и current direct adapter/tests |
| CONV-2 turn contract/direct cutover | `4d567d8acfef3718d92358c3980430539aea367d` | Goal, owner architecture и current model-turn contract/tests |
| CONV-3 Mastra/legacy removal | `8122a8ef44568d6b97dccee54dee074c4a1c4733` | Goal и current single-runtime assembly |
| CONV-3A logical run/attempt ledger | `e4cfe371a96ff5a7a3262c19c02776a36d979936` | Goal, migration `0022`, schema/repositories и PostgreSQL evidence tests |
| CONV-4 active documentation reduction | `d3f9cbd2213ec60bba3953c43f212aa307fd8175` | Source map, task index, этот archive и current CONV-5 card |

CONV-4 принят fresh independent Reviewer в session
`019fd523-6f6f-7741-9133-3556d176c55e` с verdict `accept` на fingerprint
`c89b49a847bf45813d3708bde8cd26ca60e4982fafe85f047a612f957c4fba76`;
замечаний всех уровней не было.

Удалённые карточки:

```text
AI_RUNTIME_CONVERGENCE_CONV_1_DIRECT_LIVE_V2_ADAPTER_RU.md
AI_RUNTIME_CONVERGENCE_CONV_2_TURN_CONTRACT_RU.md
AI_RUNTIME_CONVERGENCE_CONV_3_RUNTIME_REMOVAL_RU.md
AI_RUNTIME_CONVERGENCE_CONV_3A_ATTEMPT_LEDGER_RU.md
AI_REF_CONV_4_ACTIVE_DOCUMENTATION_RU.md
```

## AI refactor PR0a—PR2 и source realignment

PR0a—PR1 были приняты в общей refactor-линии, PR2 implementation опубликована
в `29dd8c15e4fc4459af51b7f26b49b339c4f15fb2`, а независимый current-main repair
PR2 — в `ca1cdb798829674e40b4eab7e4e948476e71d61c`. Архитектурный итог закреплён в
ADR-010, ADR-012, двух owner architecture documents, Goal и current code/tests.

Сохранённые уникальные решения владельца:

- PR0B, 2026-08-04: одобрен вариант A2 — migration `0017` выполняет
  forward-only reconciliation narrow и known-broad app-owned AI schema с явным
  `recording_contract`, без выдумывания historical evidence; competing
  `0010/0011/0012` уходят в non-executable archive. Recorded/Mastra path не
  включается и не получает caller. Разрешены только repo-local allowlist и
  disposable PostgreSQL checks; external DB apply, deploy, secrets/runtime
  config и другие repo не разрешены. Отдельное последующее «одобряю» разрешило
  только fail-closed `value ?? ""` repair historical M3 smoke consumer в
  прежнем allowlist, без расширения этих границ.
- PR2, 2026-08-04: `site_widget.v1` retired и отклоняется до persistence через
  HTTP `422`, `code="unsupported_schema_version"`,
  `supported_versions=["site_widget.v2"]`. Для v2 сочетание
  `automation.status="processing"`, `next_step="poll_history"` и active job
  status в history является authoritative `agent_thinking`; новый wire event
  или realtime transport не добавляется.

Удалённые записи:

```text
AI_REF_001_BASELINE_RECONCILIATION_RU.md
AI_REF_CP_001_CONTROL_PLANE_CONTRACT_RU.md
AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md
AI_REF_PR0B_CANONICAL_AI_SCHEMA_MIGRATION_RU.md
AI_REF_PR0C_BOUNDED_HOTFIXES_RU.md
AI_REF_PR1_TURN_IDENTITY_COMMIT_FENCE_RU.md
AI_REF_PR2_LATEST_WINS_FRESH_TURN_RU.md
AI_REF_SOURCE_OF_TRUTH_REALIGNMENT_RU.md
RECONCILE_REMAINING_BRANCHES_RU.md
```

Source-of-truth realignment теперь определяется accepted ADR-012. Внешний
planning/control-plane repo не нужен для активной работы.

## AI_DIALOG и Mastra-era планы

Уникальная техническая evidence сохранена в `docs/release/evidence/`; runtime
ownership и privacy/observability boundaries — в ADR-010, Goal и current code.
Exact facts acceptance сохраняют `AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md` и
`AI_DIALOG_P1Q_FACTS_SOURCE_AUDIT_RU.md` в release evidence.

Удалённые записи:

```text
AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md
AI_DIALOG_BOUNDARY_STAGE_A_RU.md
AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md
AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md
AI_DIALOG_MASTRA_G4_REVIEW_RU.md
AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md
AI_DIALOG_OBSERVABILITY_P2_RU.md
AI_DIALOG_PRIVACY_VISIBILITY_P3_RU.md
SERIOUS_AI_LAYER_RU.md
```

Mastra-era roadmap не активен: Mastra dependency/runtime удалены в CONV-3.

## Governance provenance

Минимальный Goal-контур заменил governance-v1. Активные правила находятся в
`AGENTS.md`, playbook, slice template и
`AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`. Удалены дублирующие
`AI_REFACTOR_AGENT_GOVERNANCE_DESIGN_RU.md` и
`AI_REFACTOR_GOVERNANCE_SIMPLIFICATION_RU.md`; их полный текст остаётся в Git
history.

## S01—S04 routing

Завершённые S01—S04 task-планы больше не задают порядок работы. Их проверяемое
provenance сохранено в одноимённых файлах `docs/release/evidence/` и accepted
ADR-001.

Удалённые записи:

```text
S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md
S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md
S02_MANAGER_AUTH_YANDEX_RU.md
S03_MANAGER_UI_MANTINE_RU.md
S03_MIN_LIFECYCLE_RU.md
S04_WIDGET_PERSISTENCE_RU.md
```

Этот раздел не заменяет текущие staging/Telegram task records, которые остаются
в дереве и запускаются только отдельным поручением владельца.
