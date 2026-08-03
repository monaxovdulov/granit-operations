# Governance-only: минимальный Goal-контур AI-рефакторинга

Статус: `technical_done`

Дата: 2026-08-03

Владелец: владелец проекта

Goal thread: `019fc912-6005-73f2-ba46-ccb40eb26334`

Base/head SHA: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde` — commit не создавался.

## Результат

Весь owner roadmap PR0a–PR9 переведён в одну долгоживущую Goal с одним активным
срезом, двумя обязательными ролями, автоматическим переходом после независимого
`accept` и четырьмя высокорисковыми стоп-гейтами.

Рабочий AI-код, tests, migrations, package files, runtime config и другие
репозитории не менялись этим governance-срезом.

## Решение

- Одна Goal хранит цель и порядок PR0a -> PR0b -> PR0c -> PR1–PR9.
- Исполнитель реализует и исправляет подтверждённые замечания.
- Свежий независимый Reviewer объединяет Code Scout и техническую приёмку.
- Архитектор нужен только при реальной развилке.
- Учитель запускается один раз после roadmap или крупной вехи.
- File/line budgets являются ориентирами, кроме high-risk срезов.
- Следующий заранее запланированный срез начинается автоматически после
  `accept`.

Не отменены: один изменяемый срез, независимое принятие, evidence/rollback,
сохранение dirty worktree и запрет субагентов.

## Стоп-гейты

Новое решение владельца обязательно только для ещё не одобренных:

1. архитектурной развилки/roadmap/ownership;
2. migration/schema или публичного контракта;
3. prompt/tool/model-policy/privacy/send gate/takeover;
4. deploy/secrets/runtime config/платного вызова/другого repo.

## Затронутые governance-файлы

- `AGENTS.md`;
- `docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
- `docs/tasks/AI_REFACTOR_SLICE_TEMPLATE_RU.md`;
- `docs/architecture/AI_REFACTOR_AGENT_GOVERNANCE_DESIGN_RU.md`;
- `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`;
- `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md`;
- `docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md`;
- этот документ.

## Проверки

- [x] Согласованность терминов и переходов через `rg`: в активных governance
  файлах не осталось старых требований ручного старта каждого среза, точной
  модели как blocker или per-slice Teacher.
- [x] `git diff --check`: green; отдельный поиск trailing whitespace по
  tracked/untracked governance docs также пуст.
- [x] Полный governance file list зафиксирован выше. Tracked numstat:
  `AGENTS.md +43/-36`, playbook `+175/-401`, historical design `+53/-10`,
  template `+85/-273`; новые документы: architecture `190` строк, task `78`
  строк. AI-REF-001 и PR0a остаются untracked owner/task docs, поэтому Git не
  даёт для них воспроизводимый pre-change numstat.
- [x] Подтверждено, что `apps/api/src/**` и `packages/db/**` не затронуты этим
  governance-срезом.
- [x] Pre-existing package/helper/spec hashes не изменились:
  `package.json=9f821e6e...`, `package-lock.json=fc4cc295...`,
  `helper=b3856a70...`, `spec=dfa1fff6...`.

## Непроверено

- Поведение автоматического продолжения на полном roadmap до PR9; оно будет
  проверяться фактическими переходами Goal.
- Независимый Reviewer этого governance diff.

## Rollback

Вернуть только перечисленные governance-документы к предыдущему содержанию и
остановить активную Goal. Production rollback не нужен.

## Передача

Следующий шаг — свежий независимый review governance diff. После `accept` Goal
автоматически продолжает bounded implementation PR0a.
