# Task Docs

Этот каталог хранит task records. Наличие файла, прежнего lifecycle status или
roadmap-формулировки не делает его текущей инструкцией: карточка активируется
только отдельной командой владельца.

## Last completed operations task

Владелец завершил
[`AUTOMATIC_MAIN_TO_STAGING_RU.md`](AUTOMATIC_MAIN_TO_STAGING_RU.md):
repo-local автоматизацию `granit-operations/main → staging` только для
backend/manager. Следующая AI-карточка этим автоматически не активирована.

## Active AI route

1. `../source-of-truth.md` — карта полномочий и источников истины.
2. `../architecture/AI_CURRENT_RUNTIME_RU.md` — проверенная карта текущего
   production assembly и его границ.

Активной `AI_REF_*` карточки сейчас нет. Следующий срез выбирает владелец
отдельной командой; task index не продолжает roadmap автоматически.

## Starting a future card

Шаблон для отдельно активированной задачи: `AI_REFACTOR_SLICE_TEMPLATE_RU.md`.

## Historical records

`AI_REF_AILR_00_RUNTIME_HARNESS_MAP_RU.md` принят пятым свежим Reviewer на
fingerprint `5ab09846f682dfe618dbd973b29a4e8b0b3736e7319233c8b37c60f9a8974cbb`;
это predecessor evidence, а не второй active срез.

`AI_REF_AILR_01_VALIDATOR_OBSERVABILITY_RU.md` принят свежим Reviewer на
fingerprint `d72aa14603fb500b7a6cac4848863880bf71f2b75a7783e97cdd8a18cd47624e`;
это predecessor evidence, а не active policy.

`AI_REF_AILR_02_VALIDATOR_POLICY_RU.md` принят восьмым свежим Reviewer на exact
41-entry payload с critical/high/medium/low `0/0/0/0`; это predecessor evidence,
а не active catalog route.

`AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md` — закрытый implementation record.
Его catalog/tool-loop и full-context части представлены текущим кодом и
проверяются по current-runtime map; карточка больше не задаёт следующий шаг.

`AI_LAYER_SIMPLIFICATION_GOAL_RU.md` завершена вместе с AILR-03 и остаётся
историческим owner roadmap, а не долгоживущим control plane.

`ARCHIVE_RU.md` перечисляет retired AI/S01—S04 task records, их canonical
replacement и published commits. Archive index и Git history сохраняют
provenance, но не задают текущий roadmap.

Accepted ADR остаются в `../adr/`, а воспроизводимые отчёты проверок — в
`../release/evidence/`.

Operations/staging/Telegram task records, оставшиеся в этом каталоге, не входят
в active AI route и выполняются только по отдельному текущему поручению.

## Completed Goals and planning input

`AI_RUNTIME_CONVERGENCE_GOAL_RU.md` закрыта со статусом
`understanding_verified`; `AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md`
сохраняет accepted/publication provenance.

`AI_LAYER_REFACTOR_DRAFT_RU.md` — исходный неактивный planning input прежней
Goal. `AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md` имеет статус `planning_input` и
тоже не становится active-card из-за наличия в рабочем дереве или ссылки на
LGC-срез. Каждый его срез требует отдельной команды владельца.

Перед каждой новой behavioral задачей обязателен code-derived preflight и
применимый owner stop-gate.
