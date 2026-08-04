# AI-REF: repo-local source-of-truth realignment

Статус: `technical_done`; независимая проверка не выполнялась.

Goal: `AI-LIVE-REF-ROADMAP`.

Позиция: governance/architecture correction перед продолжением roadmap.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`1338fc7b25e79f9884f8c88fd987f85d4656028b` /
тот же SHA; commit не создавался.

## 1. Один результат

Активные документы `granit-operations` больше не требуют внешний planning repo
для AI architecture или implementation order и согласованы с текущим кодом:
app-owned queue, direct runtime по умолчанию и roadmap PR0a-PR9.

## 2. Источники истины

1. Owner-решение в текущем поручении от 2026-08-04.
2. Текущий код, contracts и migrations на base SHA.
3. `AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md` и
   `AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`.

## 3. Область

Разрешены только активные repo-local entrypoints, architecture maps, ADR index,
runtime-boundary reconciliation и эта карточка.

Вне области: runtime code, tests, schema/migrations, public contracts, prompts,
policy/privacy/send gate, deploy, secrets и любые изменения другого repo.

Исторические task/evidence документы сохраняются без переписывания.

## 4. Критерии успеха

- [x] Repo-local docs определяют current-code facts и target owner decisions
  отдельно.
- [x] Active AI roadmap указан как PR0a-PR9.
- [x] Primary runtime описан как app-owned queue + direct model boundary.
- [x] Mastra ограничен bounded staging adapter ролью.
- [x] Исторические внешние ссылки объявлены provenance, а не инструкциями.

## 5. Стоп-гейт

Архитектурная смена source-of-truth и roadmap ownership явно одобрена владельцем
2026-08-04 поручением отвязать repo от старого planning app и ориентироваться на
реальный код и новый план.

Новых DB/public contract/policy/runtime activation/deploy решений нет.

## 6. Выполнение

Затронуты README, source map, agent workflow, architecture/boundary/
observability maps, ADR index и ADR-010. Добавлен ADR-012.

Системное решение отделяет три вещи: фактическое поведение кода, target owner
architecture и исторический provenance.

## 7. Evidence

Тесты, typecheck и build не запускались: рабочий код не менялся. Независимый
Reviewer и post-edit проверки не выполнялись.

Непроверено: все ли неактивные исторические документы достаточно явно
распознаются будущими агентами как provenance без чтения active source map.

Rollback: вернуть только перечисленные documentation changes и удалить ADR-012
с этой карточкой; runtime rollback не требуется.

## 8. Передача

Следующий технический шаг остаётся прежним: закрыть independent evidence PR2,
затем начинать PR3 `ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn`.
