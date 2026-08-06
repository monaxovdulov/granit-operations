# Карточка среза AI-RUNTIME-CONVERGENCE: CONV-4 — активная документация

Статус: `accepted_pending_publish`; третья fresh independent review выдала
`accept` без findings.

Goal: `AI-RUNTIME-CONVERGENCE`.

Позиция в roadmap: после принятого и опубликованного CONV-3A, перед CONV-5.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`e4cfe371a96ff5a7a3262c19c02776a36d979936` /
тот же SHA до документационных изменений.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier интерфейсом
сессии не раскрыт. Две независимые проверки зафиксированы ниже; после второго
repair требуется третья fresh-сессия.

## 1. Один результат

Новый агент получает обязательный AI-контекст только через короткий
repo-local маршрут, а завершённые task-планы не участвуют в active routing и
остаются доступными через release evidence, accepted ADR, компактный archive
index и Git history.

Почему это следующий срез: CONV-3A принят и опубликован обычным fast-forward в
`origin/main` commit `e4cfe371a96ff5a7a3262c19c02776a36d979936`; Goal заранее требует
documentation reduction до anti-clutter guardrails CONV-5.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | tracked tree чист; `output/` — pre-existing user-owned untracked path и не читается/не изменяется |
| Base/head/origin | `HEAD == origin/main == e4cfe371a96ff5a7a3262c19c02776a36d979936` |
| Активный runtime | один app-owned direct runtime; CONV-3A logical run/attempt ledger опубликован |
| Текущий routing | `docs/tasks/README.md` перечисляет десятки завершённых S/AI_DIALOG/AI_REF карточек как current records |
| Исторический объём | выбранные завершённые task-планы занимают около 8 000 строк; соответствующие ADR/release evidence/Goal остаются в дереве |

Источники истины по приоритету:

1. ADR-012, `docs/source-of-truth.md` и текущий код на base SHA;
2. два owner architecture documents, minimal Goal governance и playbook;
3. `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md` и эта карточка;
4. accepted ADR/release evidence для исторического provenance.

## 3. Область и исключения

Разрешено:

- сделать README, source map, Goal и task index коротким активным маршрутом;
- создать один компактный archive index с именами retired task records,
  replacement evidence и published commit SHA;
- удалить только завершённые дублирующие AI_DIALOG, AI_REF, CONV-1—CONV-3A и
  S01—S04 task-планы после проверки inbound links;
- перенаправить repo-local ссылки с удаляемых task docs на ADR, release
  evidence, Goal или archive index;
- в repair привести stale contract narratives к уже принятому и реализованному
  `site_widget.v2`, не меняя executable contract или public behavior;
- удалить дублирующий governance-v1 overview, сохранив его provenance в Git
  history и archive index.

Явно вне области:

- production code, executable contract artifacts, migrations, tests,
  runtime/config/env;
- prompt/model/tools/policy/privacy/send gate/manager takeover;
- accepted ADR и `docs/release/evidence/**`;
- текущие operations/staging/Telegram task records, не являющиеся старым
  S01—S04 или AI routing;
- другой репозиторий, deploy, внешние вызовы и `output/`.

Массовое удаление имеет точный allowlist:

```text
docs/architecture/AI_REFACTOR_AGENT_GOVERNANCE_DESIGN_RU.md
docs/tasks/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md
docs/tasks/AI_DIALOG_BOUNDARY_STAGE_A_RU.md
docs/tasks/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md
docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md
docs/tasks/AI_DIALOG_MASTRA_G4_REVIEW_RU.md
docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md
docs/tasks/AI_DIALOG_OBSERVABILITY_P2_RU.md
docs/tasks/AI_DIALOG_PRIVACY_VISIBILITY_P3_RU.md
docs/tasks/AI_REFACTOR_GOVERNANCE_SIMPLIFICATION_RU.md
docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md
docs/tasks/AI_REF_CP_001_CONTROL_PLANE_CONTRACT_RU.md
docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md
docs/tasks/AI_REF_PR0B_CANONICAL_AI_SCHEMA_MIGRATION_RU.md
docs/tasks/AI_REF_PR0C_BOUNDED_HOTFIXES_RU.md
docs/tasks/AI_REF_PR1_TURN_IDENTITY_COMMIT_FENCE_RU.md
docs/tasks/AI_REF_PR2_LATEST_WINS_FRESH_TURN_RU.md
docs/tasks/AI_REF_SOURCE_OF_TRUTH_REALIGNMENT_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_1_DIRECT_LIVE_V2_ADAPTER_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_2_TURN_CONTRACT_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_3_RUNTIME_REMOVAL_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_3A_ATTEMPT_LEDGER_RU.md
docs/tasks/RECONCILE_REMAINING_BRANCHES_RU.md
docs/tasks/S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md
docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md
docs/tasks/S02_MANAGER_AUTH_YANDEX_RU.md
docs/tasks/S03_MANAGER_UI_MANTINE_RU.md
docs/tasks/S03_MIN_LIFECYCLE_RU.md
docs/tasks/S04_WIDGET_PERSISTENCE_RU.md
docs/tasks/SERIOUS_AI_LAYER_RU.md
```

## 4. Критерии успеха

- [x] `AGENTS.md`, README и source map ведут только через active AI set.
- [x] `docs/tasks/README.md` показывает ровно одну active AI-card — эту.
- [x] Retired tasks перечислены в одном archive index; accepted ADR и release
  evidence сохранены.
- [x] Все inbound links на удаляемые документы перенесены; repo-local broken
  links отсутствуют.
- [x] Active docs не требуют внешний planning repo.
- [x] Diff не содержит production/schema/test changes и не затрагивает
  `output/`.
- [x] Свежий независимый Reviewer выполняет documentation Code Scout и выдаёт
  `accept`.

## 5. Риски, проверки и rollback

Риски: потерять уникальное owner decision/evidence, оставить скрытую broken
link, удалить действующий operations task или сделать archive новым active
authority. До удаления каждого пути проверяются inbound references и наличие
canonical replacement.

Обязательные проверки:

- полный список changed/deleted files и `git diff --stat`;
- скриптовая проверка относительных Markdown links по tracked tree;
- `rg`-проверка active routes, внешней planning authority и удалённых имён;
- `git diff --check`;
- свежий независимый Reviewer: routing, provenance, inbound links, scope и
  false-green link checks.

Build/typecheck/runtime tests не обязательны для docs-only diff; если срез
затронет executable файл, он возвращается в `needs_evidence` и требует обычной
технической матрицы.

Непроверено: внешние ссылки и содержимое Git history за пределами локальной
доступности; они не являются active authority.

Rollback до публикации — удалить только CONV-4 diff. После публикации —
отдельный `git revert` CONV-4; runtime/schema rollback не требуется.

## 6. Первоначальный technical done Исполнителя

Итоговое состояние на неизменившейся опубликованной базе:

- `HEAD == origin/main == e4cfe371a96ff5a7a3262c19c02776a36d979936`;
- `docs/tasks` сокращён с 48 до 21 файла;
- удалено 30 документов строго по allowlist раздела 3; extra/missing paths нет;
- retired-only deletion удаляет 8 900 строк; весь diff:
  `64 files changed, 627 insertions(+), 9094 deletions(-)`;
- стабильный fingerprint diff без self-referential card/state:
  `c21bea7ff95a7913c6f3857031532039203dff68772f82e0b413ac8d5deae4d8`;
- единственный `docs/tasks/AI_REF_*.md` — текущая карточка CONV-4;
- 128 Markdown-файлов прошли скриптовую проверку относительных ссылок;
- поиск удалённых task paths вне карточки/archive пуст;
- active AI set не содержит ссылок на `granit-plan-app`,
  `codex-refactor-control-plane` или `ai-agent-stack-wiki`;
- accepted ADR и `docs/release/evidence/**` не удалялись;
- `git diff --check` passed; JSON state parse passed;
- `apps/**`, `packages/**`, package files, schema, migrations и tests не
  изменены; build/typecheck/runtime tests не запускались как неприменимые к
  docs-only diff.

Новые и изменённые файлы:

```text
.agents/state/granit-dev-workflow.json
README.md
docs/AGENT_WORKFLOW.md
docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md
docs/PUBLIC_INTAKE_CONTRACT.md
docs/PROJECT_STATUS_RU.md
docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md
docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md
docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md
docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md
docs/architecture/AI_REVIEW_EVAL_LINKAGE_S10_RU.md
docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md
docs/release/evidence/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md
docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md
docs/release/evidence/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md
docs/release/evidence/AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md
docs/release/evidence/AI_DIALOG_MASTRA_G4_RU.md
docs/release/evidence/AI_DIALOG_OBSERVABILITY_P2_RU.md
docs/release/evidence/AI_DIALOG_P1Q_FACTS_SOURCE_AUDIT_RU.md
docs/release/evidence/AI_DIALOG_W0_WIDGET_UX_INTEGRATION_RU.md
docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md
docs/release/evidence/S02_MANAGER_AUTH_YANDEX_RU.md
docs/release/evidence/S03_MANAGER_UI_MANTINE_RU.md
docs/release/evidence/S03_MIN_LIFECYCLE_RU.md
docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md
docs/release/evidence/SITE_WIDGET_V1_CROSS_REPO_ACCEPTANCE_RU.md
docs/contracts/widget-intake-contract.md
docs/source-of-truth.md
docs/superpowers/specs/2026-07-14-live-widget-ai-design.md
docs/tasks/AI_REF_CONV_4_ACTIVE_DOCUMENTATION_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md
docs/tasks/ARCHIVE_RU.md
docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md
docs/tasks/README.md
```

Полный список удалённых файлов — exact allowlist раздела 3. Прямое влияние:
active documentation routing и historical task availability. Косвенное:
release evidence и historical architecture теперь ссылаются на archive/canonical
replacement; runtime behavior и public contracts не изменены.

Непроверено: доступность внешних HTTP links и ручное извлечение удалённых
полных текстов из Git history. Локальные ссылки и наличие canonical replacement
проверены. Rollback — вернуть только этот 64-file docs/state diff; code/schema
rollback не требуется.

Первоначальный вердикт Исполнителя `technical_done` отменён findings первого
Reviewer; author не принимает собственную работу.

## 7. Первый независимый review и bounded repair

Fresh read-only Reviewer: session
`019fd506-07b6-7712-a6f3-8651a5de43b0`, `gpt-5.6-sol`, reasoning `high`.
Verdict: `changes_requested` на fingerprint
`c21bea7ff95a7913c6f3857031532039203dff68772f82e0b413ac8d5deae4d8`.

Findings:

1. state продолжал ссылаться на удалённую карточку CONV-3A;
2. обязательные ADR/governance/playbook одновременно называли текущими старый
   PR0a—PR9 roadmap и удалённый Mastra adapter;
3. archive не сохранял уникальные owner stop-gate decisions PR0B/PR2, а два
   contract narratives продолжали объявлять v1 поддерживаемым;
4. historical live-widget design выглядел текущей внешней инструкцией.

Bounded repair остаётся docs/state-only: state переключается на CONV-4;
authority docs получают явные reconciliation notes без стирания принятой
истории; archive сохраняет решения PR0B/PR2; public/widget contract docs
синхронизируются с уже принятым и executable `site_widget.v2`; design явно
маркируется historical. Это добавляет к списку изменённых файлов раздела 6:

```text
docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md
docs/PUBLIC_INTAKE_CONTRACT.md
docs/contracts/widget-intake-contract.md
```

Repair evidence на неизменившемся base/head:

- stable fingerprint без self-referential card/state:
  `8ef621241878d6fb71d2977dea3bf0cdd0511c887b5064bcc6b9a34a8a2a5861`;
- полный diff остаётся 64-файловым docs/state-only scope; 30 удалений точно
  совпадают с allowlist;
- exact-path scan больше не находит удалённых task paths вне card/archive;
- machine state ведёт к существующим CONV-4 card/Goal;
- ADR-010, ADR-012, governance, playbook и PROJECT_STATUS явно направляют к
  текущей Goal и маркируют PR0a—PR9/Mastra wording историческим;
- archive сохраняет ограниченные owner decisions PR0B и PR2; public contract
  docs совпадают с executable `site_widget.v2`/retired v1 semantics;
- 128 Markdown files / 83 относительные ссылки: 0 broken repo-local links;
  два outside-root control-plane link остаются явно historical и не являются
  active authority;
- `git diff --check`, JSON parse и docs/state-only scope check прошли;
- build/typecheck/runtime/PostgreSQL tests не запускались как неприменимые.

Вердикт Исполнителя после repair: `technical_done`; author не принимает
собственную работу. Требуется новый fresh independent Reviewer.

## 8. Второй независимый review и bounded repair

Fresh read-only Reviewer: session
`019fd517-2329-7d60-b6d8-10bf5afd6d03`, `gpt-5.6-sol`, reasoning `high`.
Verdict: `changes_requested` на fingerprint
`8ef621241878d6fb71d2977dea3bf0cdd0511c887b5064bcc6b9a34a8a2a5861`.

Findings:

1. два обязательных owner architecture docs и исторические начальные разделы
   Goal всё ещё позволяли прочитать PR0a—PR9/Mastra baseline как current;
2. оба current public contract docs называли `granit-site-cms` текущим consumer
   и paired-smoke target вместо `landing-granit-static`;
3. widget v2 contract ложно говорил о persisted complete turn snapshot, хотя
   migration 0019 удалила `input_payload`, а worker собирает fresh turn после
   claim.

Второй bounded repair остаётся docs/state-only. В обоих owner docs добавлены
явные reconciliation banners; весь PR0a—PR9 обозначен historical baseline, а
начальное описание Goal — историческим состоянием до CONV-1—CONV-3A. Contract
docs направляют paired smoke в текущий `landing-granit-static` и описывают
persisted response-window identity + fresh post-claim assembly.

Evidence на неизменившемся base/head:

- stable fingerprint без self-referential card/state:
  `c89b49a847bf45813d3708bde8cd26ca60e4982fafe85f047a612f957c4fba76`;
- полный diff: `66 files changed, 758 insertions(+), 9108 deletions(-)`;
  добавлены только два обязательных owner architecture docs, executable scope
  пуст, а 30 удалений по-прежнему точно совпадают с allowlist;
- stale current-consumer и persisted-snapshot формулировки удалены из двух
  current contract docs;
- один существующий `docs/tasks/AI_REF_*.md`; exact-path references на удалённые
  документы вне card/archive отсутствуют;
- 128 Markdown files / 83 относительные ссылки: 0 broken repo-local links;
  два outside-root links остаются historical и не являются active authority;
- `git diff --check` и JSON parse прошли;
- build/typecheck/runtime/PostgreSQL tests не запускались как неприменимые.

Вердикт Исполнителя после второго repair: `technical_done`; author не принимает
собственную работу. Требуется третья fresh independent review.

## 9. Третий независимый review

Fresh read-only Reviewer: session
`019fd523-6f6f-7741-9133-3556d176c55e`, `gpt-5.6-sol`, reasoning `high`.
Reviewed fingerprint:
`c89b49a847bf45813d3708bde8cd26ca60e4982fafe85f047a612f957c4fba76`.
Verdict: `accept`; blocker/high/medium/low findings отсутствуют.

Reviewer независимо подтвердил exact base/origin, полный stat, allowlist 30/30,
одну active AI-card, archive provenance, active-authority reconciliation,
consumer routing, fresh-turn/v1-retirement semantics по migration/repository/
service/tests, 128/83/0 Markdown link matrix, пустой executable scope,
`git diff --check` и JSON parse. Сеть, внешние repo/links и runtime/PostgreSQL
execution не проверялись; для docs/state-only diff они неприменимы.

Author не принимал собственную работу. CONV-4 технически принят; публикация
разрешена только после повторной сверки `origin/main` с reviewed base.

## 10. Передача

После `accept` Goal разрешает отдельный русский commit и обычный fast-forward
push, затем автоматически переходит к CONV-5.
