# Task Docs

Этот каталог хранит task records, но только явно указанная карточка является
активным AI-маршрутом. Наличие другого файла в каталоге не делает его текущей
инструкцией.

## Active AI route

1. `../source-of-truth.md` — карта полномочий и фактического состояния.
2. `AI_LAYER_SIMPLIFICATION_GOAL_RU.md` — текущая долгоживущая Goal.
3. `AI_REF_AILR_02_VALIDATOR_POLICY_RU.md` — единственная active AI-card:
   AILR-02 оставляет terminal reject только для структурно непригодного ответа,
   выполняет безопасный component repair и удаляет semantic regex из live path.

Шаблон новой карточки: `AI_REFACTOR_SLICE_TEMPLATE_RU.md`.

## Historical records

`AI_REF_AILR_00_RUNTIME_HARNESS_MAP_RU.md` принят пятым свежим Reviewer на
fingerprint `5ab09846f682dfe618dbd973b29a4e8b0b3736e7319233c8b37c60f9a8974cbb`;
это predecessor evidence, а не второй active срез.

`AI_REF_AILR_01_VALIDATOR_OBSERVABILITY_RU.md` принят свежим Reviewer на
fingerprint `d72aa14603fb500b7a6cac4848863880bf71f2b75a7783e97cdd8a18cd47624e`;
это predecessor evidence, а не active policy.

`ARCHIVE_RU.md` перечисляет retired AI/S01—S04 task records, их canonical
replacement и published commits. Archive index и Git history сохраняют
provenance, но не задают текущий roadmap.

Accepted ADR остаются в `../adr/`, а воспроизводимые отчёты проверок — в
`../release/evidence/`.

Operations/staging/Telegram task records, оставшиеся в этом каталоге, не входят
в active AI route и выполняются только по отдельному текущему поручению.

## Completed Goal and planning input

`AI_RUNTIME_CONVERGENCE_GOAL_RU.md` закрыта со статусом
`understanding_verified`; `AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md`
сохраняет accepted/publication provenance.

`AI_LAYER_REFACTOR_DRAFT_RU.md` — исходный неактивный planning input новой
Goal. Он не задаёт второй roadmap: фактический порядок находится только в
`AI_LAYER_SIMPLIFICATION_GOAL_RU.md`. Перед каждым behavioral срезом по-прежнему
обязателен code-derived preflight и применимый owner stop-gate.
