# Срез AI-рефакторинга: AI-REF-PR0A — настоящий PostgreSQL test harness

Статус: `planned` для bounded implementation после `needs_redesign`

Создан: 2026-08-03

Репозиторий: `granit-operations`

Владелец: владелец проекта

Ветка: `codex/ai-refactor-agent-governance-design`

Исходный SHA: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`

Сверенный `origin/main`: `3ead589a8975944000d14e0cdb25c480afa73bcc`

Деревья исходного SHA и `origin/main` одинаковы:
`d7c772b701e2c047298352e87eb2ad1c2ec6402c`.

Goal: `AI-LIVE-REF-ROADMAP`, thread
`019fc912-6005-73f2-ba46-ccb40eb26334`, первый технический срез.

Governance v2 override от 2026-08-03:

- исторические шестиролевые передачи и hard line limits ниже сохранены как
  provenance;
- действуют `AGENTS.md`, минимальный playbook и архитектурный redesign раздела
  17;
- hashes и числа раздела 17 используются как reproducible baseline и
  ориентир, а не как причина остановки сами по себе;
- вариант A, bounded implementation и добавление PR 0b одобрены созданием
  Goal владельцем;
- после технического результата нужен свежий независимый Reviewer, совмещающий
  Code Scout; после `accept` Goal переходит к PR 0b автоматически;
- production schema/migrations PR 0a не меняет. Конкретная реализация PR 0b
  отдельно остановится на schema/migration stop-gate.

## 1. Один ожидаемый результат

Одна обязательная команда без `P2_TEST_DATABASE_URL` поднимает одноразовый
PostgreSQL, применяет явно утверждённый manifest активной схемы и на реальном
`PostgresIntakeRepository` воспроизводимо проверяет concurrency, lease/fault
injection, burst сообщений, manager takeover во время generation и отсутствие
дублирующих inbound/job/outbound записей.

Срез создаёт доказательный стенд и фиксирует красные будущие инварианты. Он не
исправляет найденные race conditions и не меняет production behavior.

## 2. Почему этот срез нужен

Проблема:

- `apps/api/test/widget-ai-job-worker.test.ts` использует
  `MemoryIntakeRepository` и не моделирует `FOR UPDATE SKIP LOCKED`, реальные
  транзакции, lease expiry и уникальные индексы PostgreSQL;
- существующие PostgreSQL tests зависят от `P2_TEST_DATABASE_URL` и полностью
  skip-аются, когда переменная отсутствует;
- для queue/worker path отсутствует real-PostgreSQL suite;
- без такого baseline нельзя безопасно проектировать PR 1 commit fence и PR 2
  latest-wins.

Почему она возникла:

- durable `site_widget.v2` worker был покрыт быстрым memory-double;
- PostgreSQL evidence добавлялась точечно для observability, но не стала
  самодостаточным harness;
- история migrations содержит конкурирующие файлы с номерами `0010`, `0011` и
  `0012`, поэтому наивное применение всех файлов по имени не создаёт текущую
  активную схему.

Почему её нельзя безопасно оставить как есть:

- зелёные memory-тесты могут скрывать неправильный claim, lease reclaim,
  ordering и duplicate behavior;
- future commit fence может быть построен поверх ложного baseline;
- сценарии stale worker и burst нельзя честно классифицировать как уже
  защищённые или ожидаемо красные.

## 3. Исходное состояние

| Проверка | Факт |
|---|---|
| `git status --short --branch` | Tracked governance docs изменены владельцем/предыдущим запуском; untracked owner-review, AI-REF-001, control-plane docs, human knowledge и `output/`. Их не изменять. |
| Исходный SHA | `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`. |
| `origin/main` | `3ead589a8975944000d14e0cdb25c480afa73bcc`; tree совпадает с исходным SHA. |
| Docker | Доступен, server `29.1.3`. |
| PostgreSQL image | Локально доступен `postgres:16-alpine`; наблюдавшийся digest `sha256:4327b9fd295502f326f44153a1045a7170ddbfffed1c3829798328556cfd09e2`. |
| Внешняя test DB | `P2_TEST_DATABASE_URL` отсутствует. |
| Memory worker baseline | `apps/api/test/widget-ai-job-worker.test.ts`: 4 passed. |
| Existing PostgreSQL baseline | `apps/api/test/p2-observability-postgres.test.ts`: 10 skipped без env. |
| PostgreSQL job claim | `PostgresIntakeRepository.claimSiteWidgetAiJob` использует transaction, expired-lease reclaim, attempt increment и `FOR UPDATE SKIP LOCKED`. |
| PostgreSQL finish | `finishSiteWidgetAiJob` обновляет только `processing` job с совпавшим `attemptCount`. |
| Send gate | `persistAiReplyWithSendGate` атомарно проверяет manager/global gate и пишет outbound, но не проверяет lease attempt или более новый inbound. |
| Duplicate protection | Уникальные индексы существуют для job inbound IDs и message idempotency; реальный concurrent proof для worker path отсутствует. |

### 3.1 Проверка migration baseline

Архитектор выполнил два disposable-container probe:

1. Лексикографическое применение всех `packages/db/migrations/*.sql` падает на
   `0011_ai_handoff_degradation.sql`: `relation "ai_runs" already exists`.
2. Явный active-schema manifest успешно создаёт `widget_ai_jobs`, `ai_runs`,
   `ai_quality_events` и `ai_runtime_controls`.

Проверенный порядок manifest:

```text
0001_s01_intake.sql
0002_s02_manager_auth.sql
0003_s03_min_lifecycle.sql
0004_s04_widget_persistence.sql
0005_s05_website_safe_ai.sql
0006_p0_channel_neutral_conversation.sql
0007_telegram_manager_mini_panel.sql
0008_allow_manager_conversation_messages.sql
0009_telegram_delivery_processing_uncertain.sql
0010_ai_dialog_stage_b.sql
0011_ai_handoff_degradation.sql
0012_grounded_widget_ai.sql
0013_live_widget_memory_shadow.sql
0014_manager_ai_runtime_controls.sql
0015_ai_quality_events.sql
0016_widget_ai_jobs.sql
```

Явно исключённые конфликтующие ветки:

```text
0010_ai_run_quality_observability.sql
0011_live_v2_controlled_no_reply.sql
0012_manager_ai_runtime_controls.sql
```

Это test-only manifest текущего baseline, а не исправление migration history.
Harness обязан сравнивать каталог migrations с manifest плюс явный exclusion
list и падать при неизвестном файле.

## 4. Источники истины

| Приоритет | Файл или источник | Что обязательно сохранить |
|---:|---|---|
| 1 | `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md:142-173,1090-1100` | Real PostgreSQL прежде commit fence; concurrency, lease/fault, burst, takeover, duplicates. |
| 2 | `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md` | App-owned primary, PostgreSQL evidence gap, PR 0a первым в lazy-пакете. |
| 3 | `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md` | App-owned primary; старые Mastra/live-v2 `0010/0011` не являются активной migration веткой. |
| 4 | `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md` | Persistence и send gate принадлежат приложению/PostgreSQL. |
| 5 | `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` | Фактические claim, finish, persistence и manager gate semantics. |
| 6 | `packages/db/migrations/0016_widget_ai_jobs.sql` | Текущие job columns и unique/claim indexes. |
| 7 | Официальная документация Testcontainers for Node.js | Использовать специализированный `@testcontainers/postgresql`, одноразовый PostgreSQL и connection URI. |

Owner review остаётся архитектурным input для PR 0a, а не доказательством
фактического поведения.

## 5. Варианты решения

### Вариант A — Testcontainers и явный active-schema manifest

- Суть: новый helper запускает pinned PostgreSQL container, применяет manifest,
  выдаёт isolated DB и гарантированно останавливает container.
- Объём: одна dev dependency, lockfile, один helper, один focused suite и один
  npm script.
- Риски: Docker/image недоступны; test-only manifest может устареть; suite
  медленнее memory tests.
- Обратимость: удалить dependency, script и два test-файла; production state не
  затрагивается.
- Доказательства: command проходит без env; тесты не имеют skip branch; schema
  manifest проверяется; container удаляется после suite.

### Вариант B — только внешний `P2_TEST_DATABASE_URL`

- Суть: расширить существующий условный PostgreSQL suite.
- Объём: меньше файлов и без новой зависимости.
- Риски: тесты остаются skip по умолчанию; состояние и migrations внешней DB
  не воспроизводимы; destructive cleanup требует доверия к URL.
- Обратимость: высокая.
- Доказательства: сильные только при вручную подготовленной DB.

### Вариант C — собственный Docker CLI harness

- Суть: запускать `docker run/exec/rm` через `node:child_process`.
- Объём: без npm dependency, но больше собственного lifecycle/error-handling
  кода.
- Риски: brittle parsing, cleanup при signal/crash, различия Docker/Podman и
  повторение готовой библиотеки.
- Обратимость: высокая.
- Доказательства: возможны, но harness сам требует больше тестирования.

## 6. Принятое решение

Рекомендация Архитектора: вариант A.

Почему:

- единственный вариант делает real PostgreSQL suite обязательным и
  самодостаточным без секретной env;
- Docker подтверждён в текущей среде;
- специализированный официальный module управляет lifecycle и случайным port;
- явный manifest превращает уже найденный migration conflict в видимый fail-fast
  contract, не исправляя его внутри PR 0a.

Почему не выбраны остальные:

- B сохраняет исходный false-green через skip;
- C создаёт собственную инфраструктурную оркестрацию без продуктовой пользы.

Дата и формулировка одобрения владельца:

- 2026-08-03;
- «Одобряю контракт PR 0a, четыре разрешённых файла, лимит 600/900 строк, dev
  dependency `@testcontainers/postgresql` и disposable Docker container».
- Одобрение включает pinned PostgreSQL image, используемый только disposable
  test harness.

## 7. Критерии успеха

- [ ] `npm run test:widget-ai:postgres` без `P2_TEST_DATABASE_URL` запускает
  disposable PostgreSQL, применяет manifest и выполняет тесты без skip.
- [ ] Два одновременных claim на один доступный job дают ровно одного
  владельца lease; второй claim не получает тот же attempt.
- [ ] После expiry новый claim увеличивает attempt, а finish старого attempt не
  меняет состояние нового владельца lease.
- [ ] Manager takeover, выполненный пока fake generator удерживается
  управляемым barrier, блокирует commit: outbound отсутствует, job/run получает
  наблюдаемый blocked/fallback result.
- [ ] Искусственный сбой после outbound commit, но до успешного finish job,
  затем retry оставляет ровно один outbound и один job для inbound.
- [ ] Два одновременных одинаковых webhook/intake request оставляют не более
  одного inbound и одного job; после обработки существует ровно один outbound.
- [ ] Burst из трёх разных visitor messages воспроизводится через persistence и
  queue. Желаемый инвариант «один ответ на последний accumulated context»
  записан как executable expected-failure и действительно красный на baseline.
- [ ] Новый inbound во время generation и потеря lease во время model call
  записаны как executable expected-failure; они не маскируются `skip`.
- [ ] Expected-failure тест неожиданно ставший зелёным валит suite и требует
  обновить контракт/ожидание, а не молча сохраняет xfail.
- [ ] Все проверки считают строки непосредственно в PostgreSQL tables, а не по
  внутренним счётчикам memory-double.
- [ ] Production source, migrations, schema, public contracts, prompts, model
  settings, manager control и runtime config не изменены.

## 8. Область работы

### Разрешённые файлы рабочего кода

- нет.

### Разрешённые test/infrastructure файлы

- `package.json`;
- `package-lock.json`;
- новый `apps/api/test/helpers/postgres-widget-ai-test-harness.ts`;
- новый `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`.

### Разрешённые документы

- только `docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md`.

### Затрагиваемые модули и контракты

- test-only lifecycle disposable PostgreSQL;
- test-only active migration manifest;
- `PostgresIntakeRepository` только как неизменяемая system under test;
- `WidgetAiJobWorker` и `PublicWidgetIntakeService` только через public/tested
  API;
- таблицы `conversations`, `conversation_messages`, `widget_ai_jobs`, `ai_runs`
  и `ai_runtime_controls` только внутри disposable DB.

## 9. Явно вне области

- любые изменения `apps/api/src/**` и `packages/db/**`;
- исправление или перенумерация migrations;
- `message_sequence`, `generation_epoch`, commit/lease fence;
- debounce, supersede, latest-wins и fresh context;
- PR 0c hotfix/kill-list;
- изменение v1/v2 public contract или HTTP behavior;
- prompts, renderer, verifier, catalog, model/provider config;
- CI workflow, deploy, staging/production DB и другой репозиторий;
- изменение существующих P2/P3 PostgreSQL tests;
- автоматический старт PR 0c.

Если тест доказывает production defect, он остаётся expected-failure и
записывается как evidence для PR 1/PR 2. Исправлять его в PR 0a запрещено.

## 10. Лимит изменений

| Ограничение | Значение |
|---|---:|
| Максимум файлов рабочего кода | 0 |
| Строки рабочего кода | 0 |
| Максимум новых файлов рабочего кода | 0 |
| Максимум test/infrastructure файлов | 4 |
| Максимум новых test helper/spec файлов | 2 |
| Ориентир test/infrastructure diff | 600 строк |
| Порог обязательной остановки | более 900 строк без учёта `package-lock.json` или нужен пятый infrastructure/test файл |
| Максимум новых direct dependencies | 1 dev dependency |

## 11. Действия с отдельным разрешением

- [x] Новая dev dependency: `@testcontainers/postgresql`.
- [x] Локальный disposable Docker container и pinned PostgreSQL image.
- [ ] Миграция БД.
- [ ] Публичный контракт.
- [ ] Промпт, инструмент, AI-policy или настройка модели.
- [ ] Приватность, send-time gate или manager takeover behavior.
- [ ] Изменение другого репозитория.
- [ ] Платная оценка на живой модели.
- [ ] Staging/production среда, секреты или runtime-конфигурация.

Полученное разрешение:

- получено 2026-08-03: четыре разрешённых файла, лимит 600/900 строк, одна dev
  dependency `@testcontainers/postgresql` и disposable Docker container с
  pinned PostgreSQL image.
- дополнительное одобрение 2026-08-03: «Одобряю для PR 0a считать
  `package-lock.json` отдельным machine-generated исключением из лимита; лимит
  600/900 применяется к `package.json` + helper/spec + task doc, dependency
  остаётся `@testcontainers/postgresql`».

## 12. Последовательность ролей

| Порядок | Роль | Модель | Reasoning | Разрешённая запись | Результат |
|---:|---|---|---|---|---|
| 1 | Архитектор | GPT-5.6 Sol | `medium` | Только этот документ | `slice_proposed` |
| 2 | Исполнитель | GPT-5.5 | `xhigh` | Четыре test/infrastructure файла и этот документ | Harness и evidence, `technical_done` |
| 3 | Исследователь кода | GPT-5.4 | `high` | Только раздел 16 | Свежий поиск false-green, race и cleanup gaps |
| 4 | Проверяющий | GPT-5.6 Sol | `medium` или выше по риску | Только раздел 17 | Независимый verdict |
| 5 | Исправление при `needs_fix` | GPT-5.5 | `xhigh` | Только прежние четыре файла | Один bounded repair |
| 6 | Учитель | GPT-5.6 Sol | `medium` | Отложено до конца `AI-LIVE-REF-FOUNDATION` | Общий teach-back пакета |

Субагенты, Multi-agent, Terra и Ultra запрещены.

## 13. Условия обязательной остановки

- нужен production source, schema/migration, existing test или пятый
  infrastructure/test файл;
- требуется менять claim, finish, persistence, gate или worker behavior;
- migration manifest нельзя воспроизвести без исправления migration history;
- Docker/Testcontainers требует secret, privileged изменение host или внешнюю
  рабочую DB;
- expected-failure нельзя выразить так, чтобы он исполнялся и был защищён от
  неожиданного green;
- тест зависит от реальной model/provider сети или недетерминированного sleep;
- превышен лимит;
- критерии успеха доказаны.

При остановке выставить `needs_human_decision`, `needs_evidence` или
`needs_redesign` по причине; не расширять область самостоятельно.

Сработало в запуске Исполнителя 2026-08-03:

- `npm install --save-dev @testcontainers/postgresql` изменил
  `package-lock.json` на `1897` insertions и `86` deletions;
- вместе с `package.json` текущий machine-generated dependency diff составляет
  `1899` insertions и `86` deletions ещё до добавления helper/spec;
- это превышает утверждённый hard stop `>900` строк, хотя сама direct
  dependency была одобрена;
- helper/spec не добавлялись, production code/schema/migrations не менялись.

Нужно решение владельца: считать `package-lock.json` отдельным
machine-generated исключением из лимита или поднять hard limit для PR 0a.

Решение получено 2026-08-03: `package-lock.json` считается отдельным
machine-generated исключением; лимит 600/900 применяется к `package.json`,
helper/spec и этому task doc.

## 14. Выполнение Исполнителем

Начальный SHA: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`.

Итоговый SHA: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde` (без commit).

Фактически затронутые файлы:

- `package.json`;
- `package-lock.json`;
- `apps/api/test/helpers/postgres-widget-ai-test-harness.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
- `docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md`.

Краткое решение:

- добавлен `npm run test:widget-ai:postgres`;
- добавлена dev dependency `@testcontainers/postgresql`;
- helper запускает pinned disposable PostgreSQL image, запрещает
  `P2_TEST_DATABASE_URL`, проверяет manifest drift, применяет active-schema
  manifest и закрывает client/container;
- suite проверяет real PostgreSQL claim/lease, lease reclaim, stale finish,
  manager takeover during generation, lost finish after outbound commit,
  concurrent duplicate intake и executable expected-failure для burst,
  newer-inbound и lost-lease fences.

Отклонения от исходного контракта:

- `package-lock.json` исключён из 600/900 line limit отдельным одобрением
  владельца 2026-08-03;
- других отклонений нет; production source/schema/migrations/existing tests не
  изменялись.

Прямое влияние: test-only PostgreSQL harness и npm script.

Косвенное влияние: `npm install` добавил transitive dev dependency tree
`testcontainers`; runtime code и deploy не затронуты.

## 15. Обязательные проверки и доказательства

| Команда или проверка | Ожидаемый результат |
|---|---|
| `npm run test:widget-ai:postgres` | Real PostgreSQL suite выполнен без skip; active tests green; expected-failure действительно падают ожидаемым образом. |
| Повтор `npm run test:widget-ai:postgres` | Второй чистый container/run также green; нет зависимости от остаточного state. |
| `npx vitest run apps/api/test/widget-ai-job-worker.test.ts --maxWorkers=1` | 4 existing memory worker tests green. |
| `npx vitest run apps/api/test/p2-observability-postgres.test.ts --maxWorkers=1` | Зафиксировать существующие skip без `P2_TEST_DATABASE_URL`; не выдавать их за PR 0a evidence. |
| `npm run typecheck` | green. |
| `npm run build` | green. |
| `git diff --check` | green. |
| `git diff --stat` и полный file list | В пределах контракта. |
| Container lifecycle check | После обоих запусков нет container PR 0a; connection закрыта и cleanup выполнен. |

Фактические доказательства 2026-08-03:

- `npm run test:widget-ai:postgres` — 8 passed, disposable PostgreSQL,
  expected-failure cases исполнились через `ExpectedInvariantViolation`;
- повтор `npm run test:widget-ai:postgres` — 8 passed на новом container;
- `npx vitest run apps/api/test/widget-ai-job-worker.test.ts --maxWorkers=1` —
  4 passed;
- `npx vitest run apps/api/test/p2-observability-postgres.test.ts --maxWorkers=1` —
  10 skipped без `P2_TEST_DATABASE_URL`, не считается PR 0a evidence;
- `npm run typecheck` — green;
- `npm run build` — green;
- `git diff --check` — green;
- `docker ps -a --filter label=granit.pr0a.widget-ai-postgres=true` — пусто;
- line counts: helper 139 строк, spec 416 строк; `package.json` +2 строки;
- `package-lock.json`: 1897 insertions / 86 deletions, machine-generated
  exception по одобрению владельца.

Дополнительные доказательства Исправления 2026-08-03:

- `npm run test:widget-ai:postgres` — 8 passed после исправления xfail/run
  assertions;
- повтор `npm run test:widget-ai:postgres` — 8 passed на новом container;
- `npx vitest run apps/api/test/widget-ai-job-worker.test.ts --maxWorkers=1` —
  4 passed;
- `npx vitest run apps/api/test/p2-observability-postgres.test.ts --maxWorkers=1` —
  10 skipped без `P2_TEST_DATABASE_URL`, не считается PR 0a evidence;
- `npm run typecheck` — green;
- `npm run build` — green;
- `git diff --check` — green;
- `docker ps -a --filter label=granit.pr0a.widget-ai-postgres=true` — пусто;
- line counts после исправления: helper 139 строк, spec 490 строк;
  `package.json` +2 строки; `package-lock.json` остаётся machine-generated
  exception.

Full `npm test` не является success gate PR 0a из-за уже зафиксированного
красного baseline вне этого среза. Если он запускается, все прежние failures
записываются отдельно от новых regressions.

Непроверенные области, которые обязательны к записи:

- Docker-less runner/CI, поскольку CI workflow вне области;
- staging/production PostgreSQL version и фактически применённая migration
  history;
- performance/load beyond deterministic two-worker and three-message cases;
- correctness будущих PR 1/PR 2 fixes.

Откат:

- удалить npm script/dev dependency/lockfile delta и два новых test-файла;
- disposable container не хранит business data и должен быть удалён harness;
- production rollback не требуется, потому что production code/schema не
  меняются.

## 16. Отчёт Исследователя кода

Проверка выполнена по коду `package.json`,
`apps/api/test/helpers/postgres-widget-ai-test-harness.ts` и
`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`.

Подтверждённые замечания:

1. `needs_fix` — executable expected-failure можно пройти не по целевому stale /
   latest-wins invariant, а по более грубой деградации «reply вообще не
   записался».
   - Доказательство: общий wrapper
     `expectBaselineViolation(...)` принимает только
     `ExpectedInvariantViolation`
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:294-302`).
     При этом три xfail-сценария бросают этот тип только по итоговым count-check:
     burst — `outboundCount !== 1`
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:192-196`),
     newer-inbound — `staleOutbounds !== 0`
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:222-225`),
     lost-lease — `staleOutbounds !== 0`
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:251-255`).
     Если baseline сломается так, что worker перестанет сохранять outbound вообще
     или начнёт всегда уходить в fallback/blocked без stale commit, эти xfail
     останутся зелёными и не докажут, что воспроизведён именно нужный race.
   - Последствие: PR 0a может сохранить ложное доказательство для PR 1 / PR 2:
     «красный invariant зафиксирован», хотя фактически тест прошёл по другому
     отказу.
   - Уверенность: высокая.

2. `needs_evidence` — проверка manager takeover не валидирует ветку `ai_runs`,
   хотя в критерии зафиксирован наблюдаемый `job/run` результат.
   - Доказательство: fake reply helper намеренно не передаёт `action` и `intent`
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:363-372`), а
     запись `aiRun` в `saveSiteWidgetAiMessage(...)` происходит только когда оба
     поля присутствуют
     (`apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:471-509`).
     Поэтому `expect(await countAiRuns()).toBe(0)` в scenario manager takeover
     (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:124-132`)
     является заранее истинным и не различает «takeover корректно заблокировал
     run-path» от «run-path вообще не был задействован данным fake generator».
   - Последствие: сценарий уверенно доказывает blocked job и отсутствие outbound,
     но не даёт отдельного PostgreSQL-доказательства для run/fallback semantics.
   - Уверенность: средняя.

Проверено без замечаний:

- Assertions действительно читают PostgreSQL tables, а не memory counters:
  row-count helpers идут через `harness.db.select(...)` по
  `conversation_messages`, `widget_ai_jobs`, `conversations`, `ai_runs`
  (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:304-347`).
- Случайного `skip` при отсутствии Docker в PR 0a нет: script всегда запускает
  suite
  (`package.json`, `test:widget-ai:postgres`), а `beforeAll` без condition сразу
  поднимает harness
  (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:45-47`).
- Harness fail-fast по migration drift и не использует внешнюю test DB:
  unknown/missing `.sql` приводят к throw
  (`apps/api/test/helpers/postgres-widget-ai-test-harness.ts:107-124`),
  `P2_TEST_DATABASE_URL` явно запрещён
  (`apps/api/test/helpers/postgres-widget-ai-test-harness.ts:48-53`).
- Barrier-сценарии действительно конкурентные, а не последовательные: worker
  запускается до `await gate.entered`, takeover / reclaim выполняется пока
  generator удержан на `await gate.wait`
  (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:114-123`,
  `216-220`, `241-249`).

Оставшийся непокрытый риск:

- Cleanup после обычного завершения подтверждён, но отдельного кодового
  механизма именно на process signal helper не добавляет: закрытие завязано на
  `afterAll` и `stopHarness(...)`
  (`apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:53-55`,
  `apps/api/test/helpers/postgres-widget-ai-test-harness.ts:133-139`).
  Для normal run этого достаточно; для `SIGINT` / kill cleanup здесь опирается
  не на код PR 0a, а на внешнее поведение runner/Testcontainers и не доказан
  самой реализацией.

## 17. Независимая проверка

Проверка выполнена 2026-08-03 отдельным read-only проходом после Исправления.
Точная модель среды не была подтверждена как требуемая `GPT-5.6 Sol`;
владелец после явного предупреждения поручил продолжить на текущей модели. Это
зафиксировано как отклонение, а не скрытая подмена модели.

Исходный и текущий SHA:
`7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`; commit в ходе проверки не
создавался. Production source и migrations не изменены.

Независимо повторённые доказательства:

- `npm run test:widget-ai:postgres` — два последовательных запуска, каждый
  `8 passed`, без skip и на новом disposable PostgreSQL;
- `docker ps -a --filter label=granit.pr0a.widget-ai-postgres=true` — после
  прогонов и дополнительного probe контейнеров нет;
- `npx vitest run apps/api/test/widget-ai-job-worker.test.ts --maxWorkers=1` —
  `4 passed`;
- `npx vitest run apps/api/test/p2-observability-postgres.test.ts --maxWorkers=1`
  — существующие `10 skipped`, не засчитаны как evidence PR 0a;
- `npm run typecheck`, `npm run build`, `git diff --check` — green;
- SQL assertions suite читают `conversation_messages`, `widget_ai_jobs`,
  `conversations` и `ai_runs`; typed xfail принимают только ожидаемый code и
  падают при неожиданном green или посторонней ошибке.

### Самостоятельные находки

1. `needs_redesign` — green suite не проходит через production-shaped
   `ai_runs` persistence path.
   - Обычный fake reply в
     `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts:429-438` не
     содержит `action` и `intent`; поэтому
     `PublicWidgetIntakeService` не формирует `aiRun`
     (`apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:471-509`).
   - Grounded production generator заполняет оба поля
     (`apps/api/src/modules/ai/services/grounded-widget-ai-service.ts:350-357`).
   - Отдельный disposable-PostgreSQL probe с тем же harness и fake reply,
     дополненным `action: "answer"` и `intent: "product_selection"`, дал:
     intake `202`, worker processed `true`, job `degraded` с
     `terminal_reason=ai_persistence_unconfirmed`, только один visitor message,
     ноль outbound и ноль `ai_runs`.
   - Следствие: текущие success/fault tests доказывают claim/lease/send-gate
     подмножество, но не доказывают основной grounded commit path. Уже
     признанное расхождение active migration manifest и Drizzle schema нельзя
     обходить reply без `action/intent`; его нужно сначала сделать отдельным
     executable red invariant и вернуть Архитектору решение о канонической
     schema/migration ветке.

2. `needs_redesign` — контракт PR 0a потерял обязательный сценарий из
   приоритетного owner review.
   - `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md:155-166`
     требует `Shadow turn -> не пишет state и не делает handoff` на real
     PostgreSQL baseline.
   - Новый suite не собирает `ShadowWidgetAiReplyGenerator`/shadow sink и не
     проверяет отсутствие slot/requirement/handoff mutations. Существующий
     `apps/api/test/shadow-widget-ai.test.ts` является unit/memory test и не
     заменяет PostgreSQL invariant.

3. `needs_evidence` — соблюдение line limit не воспроизводится от указанного
   base SHA.
   - Одобрение в разделе 11 явно применяет `600/900` к `package.json +
     helper/spec + task doc`, исключая только `package-lock.json`.
   - Текущие размеры: helper `139`, spec `490`, task doc до этой проверки
     `608`, `package.json` `+2`: всего `1239` строк от Git baseline. Evidence в
     разделе 15 task doc не учитывает.
   - Если имелся отдельный role-start snapshot уже созданного task doc, он не
     зафиксирован SHA или другим воспроизводимым артефактом. Архитектору нужен
     явный пересмотр лимита или доказуемый baseline ролей.

4. Неблокирующий сам по себе, но обязательный для нового контракта cleanup gap:
   `stopHarness(...)` подавляет ошибки и `database.client.end`, и
   `container.stop`
   (`apps/api/test/helpers/postgres-widget-ai-test-harness.ts:133-139`). Текущие
   ручные проверки подтверждают отсутствие контейнеров, однако будущая ошибка
   cleanup оставит suite зелёным. Harness должен сигнализировать normal-run
   cleanup failure; signal/kill остаётся отдельной непроверенной областью.

### Карта влияния

- Прямо: test-only PostgreSQL lifecycle, migration manifest, queue/worker
  concurrency и fault-injection evidence.
- Косвенно: достоверность будущих PR 0c/PR 1/PR 2; они не должны проектироваться
  на предположении, что production-shaped grounded commit уже доказан.
- Не затронуто: public HTTP contract, prompts/tools/model settings, manager
  controls, production schema/migrations, deploy и другие репозитории.

### Verdict

`needs_redesign`.

PR 0a не принят, PR 0c не начинается. Архитектор должен ограниченно пересобрать
контракт PR 0a: добавить executable production-shaped `ai_runs` baseline,
вернуть PostgreSQL shadow invariant, определить каноническую границу
schema/migration evidence, заново утвердить line limit и cleanup criterion. Это
не разрешает исправлять production runtime внутри текущего reviewer run.

### Редизайн Архитектора после `needs_redesign`

Редизайн подготовлен 2026-08-03. Точная модель среды не подтверждена как
требуемая `GPT-5.6 Sol`; владелец после предупреждения явно поручил продолжить
на текущей модели. Рабочий код, tests и migrations Архитектор не менял.

#### Уточнённая проблема

PR 0a правильно доказал PostgreSQL claim, lease, duplicate и send-gate
подмножество, но не может считаться полным baseline текущего app-owned runtime:

- production-shaped grounded reply с `action` и `intent` входит в `aiRun`
  persistence и деградирует на test-only active migration manifest;
- обязательный shadow invariant из owner review не перенесён в real-PostgreSQL
  suite;
- normal-run cleanup фактически сработал, но ошибки cleanup подавляются;
- первоначальный общий line limit нельзя воспроизвести между ролями, потому что
  task doc был untracked и не имел отдельного role-start snapshot.

#### Варианты

**Вариант A — честный PR 0a baseline и отдельный PR 0b для schema/migrations
(рекомендован).**

- В PR 0a добавить production-shaped reply как typed executable
  expected-failure с точной причиной `ai_run_schema_mismatch`; неожиданное
  успешное сохранение или другая деградация валят suite.
- Добавить real-PostgreSQL shadow scenario: grounded shadow candidate может
  содержать slot/handoff предложения, но в operational tables не появляются
  его slot/requirement/handoff mutations; допустима только отдельная
  `ai_shadow_comparisons` observation и поведение выбранного legacy response.
- Сделать normal cleanup fail-closed: client и container stop предпринимаются
  оба, а ошибка любого шага возвращается test runner.
- Не менять schema, migrations и production source в PR 0a.
- После `accept` PR 0a отдельным срезом PR 0b выбрать каноническую migration
  history и сделать production-shaped `ai_runs` path зелёным.
- Риск: пакет `AI-LIVE-REF-FOUNDATION` потребуется явно расширить; PR 0c
  сдвигается после PR 0b.
- Обратимость: test-only repair удаляется без production rollback.

**Вариант B — переключить harness на альтернативную observability migration
ветку.**

- Плюс: Drizzle `aiRuns` приблизится к широкой схеме.
- Минусы: возвращает исключённую ветку Mastra/live-v2, конфликтует с ADR-010,
  не доказывает фактически применённую migration history и требует решения о
  нескольких таблицах/constraints сразу.
- Вердикт Архитектора: отклонить.

**Вариант C — добавить test-only `ALTER TABLE` после active manifest.**

- Плюс: production-shaped test можно быстро сделать зелёным.
- Минусы: создаёт схему, которой нет ни в одном deploy path, скрывает настоящий
  migration defect и превращает harness в отдельную реализацию production DB.
- Вердикт Архитектора: отклонить как костыль.

#### Рекомендованное решение PR 0a

Один уточнённый результат:

> Одна обязательная команда на disposable PostgreSQL доказывает уже работающие
> claim/lease/idempotency/send-gate инварианты, строго воспроизводит
> production-shaped `ai_runs` schema mismatch как typed expected-failure,
> доказывает отсутствие grounded shadow mutations в operational state и
> fail-closed завершает normal container cleanup.

Новые критерии поверх раздела 7:

- [ ] Production-shaped reply содержит `action` и `intent`, действительно
  передаёт `aiRun` в repository и завершается только ожидаемым
  `ai_run_schema_mismatch`; ноль outbound не считается общим допустимым
  результатом без проверки точной причины.
- [ ] Если production-shaped path неожиданно становится green, suite падает и
  требует обновить baseline/контракт.
- [ ] Shadow scenario использует реальный `PostgresIntakeRepository`, управляемый
  barrier для grounded result и SQL counts до/после обработки.
- [ ] Grounded shadow candidate не создаёт `conversation_slots`,
  `conversation_requirements`, `conversation_handoffs` и не переводит
  conversation в manager/needs-manager state.
- [ ] Ровно одна допустимая shadow observation сохраняется в
  `ai_shadow_comparisons`; её повтор не создаёт дубликат.
- [ ] Normal cleanup пытается закрыть и DB client, и container; ошибка любого
  шага делает запуск красным. `SIGINT`/kill остаётся явно непроверенной областью.
- [ ] Existing восемь PostgreSQL scenarios продолжают исполняться; их typed
  reasons не ослабляются.

#### Пересмотренная область и лимит

Разрешённая запись второго bounded Repair после отдельного одобрения владельца:

- `apps/api/test/helpers/postgres-widget-ai-test-harness.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
- разделы выполнения/evidence этого task doc.

Заморожены без изменений:

- `package.json` — baseline SHA-256
  `9f821e6e61109bca23d22546f2a44a30d8c311d23840405ec426b7ddfa4892e9`;
- `package-lock.json` — baseline SHA-256
  `fc4cc2956edf6a1fd11e7aa8d446e2ec24338a5d6aef6e6dadbfb2cedc869405`;
- весь `apps/api/src/**`, `packages/db/**`, существующие tests и другой repo.

Воспроизводимый implementation baseline:

- helper: 139 строк, SHA-256
  `b3856a70416cb5497deee773cbd4b444200184e70f677ad7beca916910f18e1d`;
- spec: 490 строк, SHA-256
  `dfa1fff6a72879c59f8c9c0ccb44b6c7f9778efa7cf2cd31da0a6c60d04ba5d9`.

Ориентир bounded implementation:

- максимум 2 изменённых test/infrastructure файла;
- максимум `+180` net строк helper + spec от указанных hashes;
- существенный выход за `+260` net строк требует объяснения Reviewer, но не
  отдельного одобрения владельца, пока не меняются результат и risk profile;
- task doc считается отдельно: только фактические evidence/передача, максимум
  `+100` net строк от Architect handoff line count, который фиксируется ниже;
- Architect handoff baseline task doc: `861` строк;
- удаление/механическое сжатие assertions не используется для обхода лимита.

#### Обязательные проверки второго Repair

- `npm run test:widget-ai:postgres` дважды;
- SQL evidence по production-shaped xfail и shadow state tables;
- `npx vitest run apps/api/test/widget-ai-job-worker.test.ts --maxWorkers=1`;
- `npm run typecheck`;
- `npm run build`;
- `git diff --check`;
- проверка hashes frozen files;
- `docker ps -a --filter label=granit.pr0a.widget-ai-postgres=true` после обоих
  запусков;
- полный scoped diff от указанных helper/spec hashes и список непроверенных
  областей.

#### Условия остановки

- Для PR 0a требуется изменить production schema/migration/source, package
  files, existing test или добавить новый файл.
- Production-shaped failure нельзя отличить typed reason от другой деградации.
- Shadow invariant требует менять app-context или production shadow semantics.
- Diff существенно расширился без связи с критериями PR 0a.
- Возникла попытка сделать schema green через test-only DDL.
- Все уточнённые критерии уже доказаны.

#### Требуемые решения владельца

Решения получены 2026-08-03 при переходе на минимальный Goal-контур:

- [x] Одобрен вариант A и уточнённый контракт PR 0a.
- [x] Одобрен bounded implementation прежней test-only области; прежнее
  ограничение числа Repair-циклов отменено governance v2.
- [x] Одобрено добавить в Goal новый PR 0b
  `canonical AI schema/migration reconciliation` после PR 0a и до PR 0c.

Одобрение PR 0b в roadmap не одобряет конкретную migration: перед изменением
schema/migrations Goal обязан остановиться с точным решением и rollback.

## 18. Исправление

Разрешён один запуск только внутри прежних четырёх файлов. Нужен новый файл,
production change, migration или новый package — вернуть Архитектору.

Исправление выполнено 2026-08-03 внутри прежней области.

Что изменено:

- `ExpectedInvariantViolation` получил typed reason; wrapper принимает только
  ожидаемый reason конкретного xfail-сценария;
- burst xfail теперь читает outbound rows из PostgreSQL, проверяет persisted
  outbounds, stale idempotency keys и тело latest-context ответа; ноль outbound
  больше не считается ожидаемым красным результатом;
- newer-inbound и lost-lease xfail дополнительно проверяют visitor/job
  prerequisites и бросают expected violation только по stale reply reason;
- manager takeover использует `replyWithAiRun(...)`; spy на
  `saveSiteWidgetAiMessage(...)` проверяет, что service реально передал
  `aiRun` в repository до send-gate block, после чего outbound и `ai_runs`
  остаются пустыми.

Промежуточная проверка показала, что делать все fake replies `aiRun`-capable и
требовать success-path `countAiRuns() === 1` нельзя внутри PR 0a без новой
schema/migration развилки: active manifest и текущая Drizzle schema расходятся
для расширенного `ai_runs` insert. Это не исправлялось, потому что production
schema/migrations явно вне области PR 0a.

## 19. Контрольный список понимания

Статус после будущего `accept`: `teaching_deferred`.

Per-slice checklist для общего Учителя пакета:

- [ ] Почему memory repository не доказывает PostgreSQL claim/lease semantics.
- [ ] Какие active invariants уже green на реальном PostgreSQL.
- [ ] Какие stale/burst invariants остаются executable expected-failure.
- [ ] Почему test-only migration manifest не исправляет migration history.
- [ ] Какой результат PR 0a опроверг бы безопасность плана PR 1/PR 2.

## 20. Кандидат следующего среза

Следующий срез Goal после независимого `accept` PR 0a:

- PR 0b — канонизация AI schema/migration history и green
  production-shaped `ai_runs` persistence на app-owned runtime.

PR 0b входит в Goal, но его собственные файлы, migration strategy, rollback и
доказательства требуют schema/migration stop-gate. Этот документ не разрешает
менять schema или migrations.

PR 0c — короткие hotfix-ы — начинается только после независимого `accept` PR 0b.

Любые commit fence/latest-wins fixes, подсказанные красными тестами, остаются PR
1/PR 2 и не выполняются в PR 0a.

## 21. Передача следующему запуску

```text
Следующий запуск Goal

Роль: Исполнитель bounded PR 0a implementation
Модель и reasoning: сильная coding-модель, high/xhigh рекомендуется
Документ среза: docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md
Исходный SHA: 7aa3e892b4f29b817d53e0d7b13443ee9c16bcde
Текущий SHA: 7aa3e892b4f29b817d53e0d7b13443ee9c16bcde
Текущий статус: planned после needs_redesign и принятого redesign
Разрешённая запись: только helper/spec из пересмотренной области и evidence/передача этого task doc
Обязательный вход: независимый review, redesign Архитектора, baseline hashes и Goal governance v2
Ожидаемый результат: production-shaped typed xfail, PostgreSQL shadow invariant и fail-closed normal cleanup
Условия остановки: четыре стоп-гейта AGENTS.md; не делать test-only DDL; не начинать PR 0b до независимого accept PR 0a
```
