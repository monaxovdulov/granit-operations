# Task Docs

Этот каталог хранит task records, но только явно указанная карточка является
активным AI-маршрутом. Наличие другого файла в каталоге не делает его текущей
инструкцией.

## Active AI route

1. `../source-of-truth.md` — карта полномочий и фактического состояния.
2. `AI_RUNTIME_CONVERGENCE_GOAL_RU.md` — утверждённая долгоживущая Goal.
3. `AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md` — единственная active AI-card:
   CONV-5 закрепляет single-runtime и documentation guardrails перед общим
   teach-back.

Шаблон новой карточки: `AI_REFACTOR_SLICE_TEMPLATE_RU.md`.

## Historical records

`ARCHIVE_RU.md` перечисляет retired AI/S01—S04 task records, их canonical
replacement и published commits. Archive index и Git history сохраняют
provenance, но не задают текущий roadmap.

Accepted ADR остаются в `../adr/`, а воспроизводимые отчёты проверок — в
`../release/evidence/`.

Operations/staging/Telegram task records, оставшиеся в этом каталоге, не входят
в active AI route и выполняются только по отдельному текущему поручению.
