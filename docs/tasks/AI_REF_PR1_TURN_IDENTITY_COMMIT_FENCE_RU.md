# Карточка среза AI-рефакторинга: AI-REF-PR1 — turn identity и commit fence

Статус: `accept`; второй fresh independent Reviewer подтвердил repair и закрыл
первоначальный blocker. PR2 начинается автоматически отдельным срезом.

Goal: `AI-LIVE-REF-ROADMAP`.

Позиция: `PR0a accept -> PR0b accept -> PR0c accept -> PR1 -> PR2`.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`777d7dca351176b30042fa8b6bd136be041ddc04` /
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.

Фактическая модель Исполнителя: текущая Codex-модель, high reasoning.

## 1. Один результат

Каждое persisted conversation message получает монотонный sequence, каждый
widget AI job фиксирует generation epoch и visitor sequence, через который он
отвечает, а send-time commit атомарно отклоняет draft, если после claim пришло
новое клиентское сообщение или произошло уже утверждённое invalidating event.

Это следующий заранее указанный срез после независимого `accept` PR0c. PR1
создаёт identity/fence foundation; coalescing, fresh assembler, supersede,
turn-key idempotency и atomic commit+job finish остаются PR2.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | dirty worktree с принятыми PR0a/PR0b/PR0c и чужими untracked owner docs/output; всё сохраняется |
| Base/head SHA | `777d7dca351176b30042fa8b6bd136be041ddc04` / тот же SHA |
| Текущие обязательные тесты | PR0a disposable PostgreSQL runtime suite, migration-chain reconciliation, typecheck/build/M3 |
| Известный красный baseline | три typed expected-failure: burst not latest-wins, newer inbound stale reply, lost lease stale reply |
| Принятая база | PR0b canonical migration `0017`; PR0c exact-hash PostgreSQL evidence `15/15` |

Executable baseline 2026-08-04: disposable PostgreSQL migration reconciliation
`4/4` и runtime suite `15/15`. Три PR0a сценария внутри runtime suite проходят
только как typed expected-failure; `newer_inbound_stale_reply` подтвердил, что
старый outbound сейчас сохраняется после более нового inbound.

Источники истины по приоритету:

1. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`, Epic
   2.1, 2.2, 2.6 и итоговый PR1 roadmap.
2. `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`: один срез,
   заранее одобренные schema/send-gate действия и автоматический переход.
3. `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md` и принятые PR0a/PR0b
   cards: реальные failure paths и canonical active migration chain.
4. ADR-008/ADR-010 и живой код: app-owned send gate, Postgres state ownership,
   sanitized observability и отсутствие внешнего runtime activation.

## 3. Точная область

Разрешённая semantics:

1. `conversations.last_message_sequence bigint not null default 0` и
   `generation_epoch bigint not null default 0`.
2. `conversation_messages.message_sequence bigint not null`, уникальный внутри
   conversation; migration детерминированно backfill-ит существующие сообщения.
3. `widget_ai_jobs.expected_generation_epoch` и
   `responds_through_sequence` — not-null identity job, backfill через связанное
   inbound message/conversation.
4. Любое новое persisted message увеличивает `last_message_sequence`; inbound
   visitor, manager message, takeover и фактическое AI disable/enable дополнительно
   увеличивают `generation_epoch`.
5. Site-widget reply commit проверяет expected epoch и что latest visitor
   sequence равен `responds_through_sequence`, затем присваивает outbound
   следующий message sequence в той же транзакции.
6. Новый inbound во время generation становится активным PostgreSQL invariant:
   stale outbound не сохраняется. Существующие takeover/idempotency/lease checks
   не ослабляются.

Точный allowlist высокорискового среза:

- `packages/db/src/schema.ts`;
- новый `packages/db/migrations/0018_widget_ai_turn_identity.sql`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- `apps/api/src/modules/conversations/repositories/postgres-manager-telegram-repository.ts`;
- `apps/api/src/modules/conversations/repositories/conversation-message-repository.ts`;
- `apps/api/src/modules/conversations/repositories/public-intake-repository.ts`;
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`;
- `apps/api/test/helpers/memory-intake-repository.ts` только для contract parity;
- `apps/api/test/helpers/postgres-widget-ai-test-harness.ts` только active
  migration manifest;
- `apps/api/test/ai-schema-migration-reconciliation.test.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
- focused existing test files только если compile/parity требует новых internal
  turn-identity полей;
- эта карточка.

Ориентир diff: до примерно 500 строк вместе с migration/backfill и
PostgreSQL system evidence. Существенное расширение требует объяснения Reviewer.

Явно вне области:

- supersede pending jobs, burst coalescing/latest-wins и изменение 600ms debounce;
- удаление полного `AiTurnInput` snapshot или fresh context assembler;
- response-window idempotency key и удаление `ai:${inboundMessageId}`;
- atomic reply commit + finish job, lease-attempt fence и local AbortController;
- worker pool/concurrency, public response shape, prompt/tools/model/privacy;
- commit, push, PR, deploy, external DB apply, secrets/runtime config и другой repo.

## 4. Критерии успеха

- [x] Disposable PostgreSQL full migration chain применяет `0018` к пустой БД,
  а reconciliation test доказывает not-null/unique/backfill contract.
- [x] Три последовательных persisted messages получают sequence `1,2,3` без
  дублей; job identity совпадает с inbound epoch/sequence.
- [x] Новый inbound во время generation блокирует старый reply commit и не
  создаёт outbound/ai_run; прежний typed expected-failure становится active pass.
- [x] Manager takeover и фактические global/conversation AI control changes
  увеличивают epoch и сохраняют прежний send gate/takeover contract.
- [x] Concurrent duplicate intake по-прежнему даёт одно inbound, один sequence
  increment и один job.
- [x] Lost-lease и burst latest-wins остаются ровно двумя документированными
  PR2 expected-failure, без ложного заявления об их исправлении.
- [x] Typecheck, build, M3, focused PostgreSQL suite, migration reconciliation и
  `git diff --check` green; известный modular/public-intake baseline не ухудшен.

Приоритет evidence: migration + real PostgreSQL concurrency/system paths;
isolated unit tests добавляются только для недоступной иначе contract parity.

## 5. Стоп-гейты

PR1 меняет schema/migration и app-owned send gate. Ровно эти поля и commit-fence
semantics заранее одобрены в текущей Goal и итоговом owner roadmap; повторное
разрешение не требуется. Public contract, prompt/model/tools/privacy и external
runtime не меняются.

Немедленная остановка нужна при необходимости изменить утверждённый split
PR1/PR2, публичный widget contract, AI policy/privacy, migration lineage 0017,
deploy/external DB или другой repo.

## 6. Риски и rollback

До реализации не проверены: migration backfill на исторических одинаковых
timestamps, все manager message writers, global control fan-out и race между
inbound insert/reply commit. Code Scout обязан проверить все три production
writers `conversation_messages`, duplicate/idempotency paths и ordering SQL.

Rollback до внешнего применения: удалить отделимый PR1 diff и migration 0018.
После применения migration безопасный rollback только roll-forward: сохранить
добавленные identity columns/data и отдельно вернуть application behavior;
drop/backfill reversal без решения владельца запрещён. В текущем срезе внешняя
БД не применяется.

## 7. Следующий срез

После fresh independent `accept`: PR2 — latest-wins на существующей очереди,
fresh assembler/response window, supersede, turn-key idempotency, atomic
reply+finish fence, lease identity и local cancellation.

## 8. Реализация и evidence Исполнителя

Исходный SHA = итоговый SHA =
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался. Реализация:

- migration `0018` добавляет conversation counters, детерминированный
  `(created_at, id)` backfill и job identity; для принятой broad lineage без
  `0016` она сначала восстанавливает canonical `widget_ai_jobs` shape;
- visitor/AI/manager writers получают sequence атомарным update одной строки
  conversation; visitor, manager reply, takeover и фактические control changes
  также двигают epoch;
- AI commit требует open conversation, runtime/agent gate, exact epoch и latest
  visitor sequence; replay без durable acceptance-time job identity fail-closed;
- control/takeover/manager-reply reads используют row lock, чтобы concurrent
  no-op или state switch не принимался по устаревшему snapshot;
- memory repository повторяет identity/fence contract; disposable PostgreSQL
  tests проверяют реальную migration и concurrency, а не mock SQL.

Проверки 2026-08-04:

- executable red baseline до production-правок: migration `4/4`, runtime
  `15/15`, но `newer_inbound_stale_reply` проходил только typed
  expected-failure и подтверждал сохранение stale outbound;
- migration reconciliation + real PostgreSQL runtime — `21/21` green;
- расширенный PostgreSQL/retention прогон — `26 passed`, `11 skipped`: skipped
  только отдельный P2 suite без `TEST_DATABASE_URL`; disposable PR1 harness
  фактически поднял PostgreSQL и прошёл;
- runtime теперь имеет `16/16`: newer-inbound — active pass; только burst
  single-generation и lost-lease attempt fence остаются typed PR2
  expected-failure;
- `npm run build` — exit 0: полный bounded typecheck (source/packages, 55 test
  groups, manager), затем Vite `2476 modules transformed`;
- M3 smoke evidence — `14/14` green;
- modular boundaries — прежний baseline `12/14`, те же два failure;
- `git diff --check` — exit 0.

Exploratory memory set дал `9/12`: два stale `ai-turn-context` assertions уже
не соответствуют даже base HEAD (ожидают отсутствующий timestamp helper и
смешивают public inbound ID с internal persistence ID), а global-stop assertion
по-прежнему ожидает отсутствие model call в существующем recorded-executor
path. PR1 этот path не вводит; его commit остаётся fail-closed. Эти три теста не
используются как positive evidence PR1 и не маскируются изменением ожиданий.

Фактически затронутые PR1 файлы:

- `packages/db/src/schema.ts`;
- `packages/db/migrations/0018_widget_ai_turn_identity.sql`;
- `conversation-message-repository.ts`, `public-intake-repository.ts`,
  `postgres-intake-repository.ts`, `postgres-manager-telegram-repository.ts`;
- `public-widget-intake-service.ts`;
- `memory-intake-repository.ts`, `postgres-widget-ai-test-harness.ts`;
- `ai-schema-migration-reconciliation.test.ts`,
  `widget-ai-postgres-runtime-invariants.test.ts`;
- compile/fixture-only: `ai-turn-context.test.ts`, `public-intake.test.ts`,
  `p2-observability-postgres.test.ts`, `p3-ai-run-span-retention.test.ts`;
- эта карточка.

Общий worktree stat включает уже принятые незакоммиченные PR0a/PR0b/PR0c:
`29 files changed, 1673 insertions(+), 742 deletions(-)` плюс untracked files;
это не размер PR1. Расширение PR1 против ориентира связано с обязательной
dual-lineage migration/backfill, memory contract parity и real-PostgreSQL
evidence; production semantics остаётся в одном результате карточки.

Прямое влияние: storage identity, все три production message writers, widget
job claim payload и reply commit. Косвенное: global control invalidates все
site-widget conversations; legacy synchronous replay без durable job identity
безопасно отказывается от новой generation. Public response, prompt, tools,
model, privacy payload и runtime activation не менялись.

Непроверено: migration на реальной внешней БД и production-scale lock latency;
conversation-close/runtime-mode DB writer сейчас отсутствует, а будущая runtime
activation остаётся PR7. PR2 всё ещё обязан закрыть supersede/coalescing, fresh
assembler, response-window key, atomic reply+finish и lease-attempt fence.
Rollback остаётся описанным в разделе 6; external apply не выполнялся.

## 9. Exact hashes для Reviewer

| Файл | SHA-256 |
|---|---|
| `packages/db/src/schema.ts` | `82888487827103dabe1b0d180d765c24813d56cc0c1bfdb81b2872928aed34e0` |
| `packages/db/migrations/0018_widget_ai_turn_identity.sql` | `d5dff27a59dc175e97142160f254be731156497d992ab7d6c3f3d4f38bf339a3` |
| `conversation-message-repository.ts` | `2c7a7afd9ddfc741960d4aa943010d9f94f2964da2b0e2e31d7a8f88d998d370` |
| `public-intake-repository.ts` | `3afb561d29d6e9f4bb6c741d63069a6a8dcf50a49f7f4c710f916988efa67b7a` |
| `postgres-intake-repository.ts` | `a5ecb0f297aa9788e62d92fdfe33d1cfe230aec223f0eab49aea9135dcc65643` |
| `postgres-manager-telegram-repository.ts` | `dc70cb31efb932b26562c3d984480a4d2f948d65317c49238b12644cab6640b5` |
| `public-widget-intake-service.ts` | `33924e4a0d9df4b39ba8258a3637ab149dcb4d58bd715f4ce0e1ede223e0e36a` |
| `memory-intake-repository.ts` | `7463a5a67e905d8e57ac5bebd5117b36a7398999f4271158b04ae2f85d4db4ae` |
| `postgres-widget-ai-test-harness.ts` | `cf431bcde3e083aa67e27a4e9d68372a9ef215f1384eea888e77767ebed273b2` |
| `ai-schema-migration-reconciliation.test.ts` | `38c605141ec41d24947c98121d7a8c60d15ddafbe1a708e0b9719101f8455943` |
| `widget-ai-postgres-runtime-invariants.test.ts` | `8983c084dfa03e4c44e6f393c729b1a9b232483870e88a7554c5cec3fdd6dbb5` |
| `ai-turn-context.test.ts` | `0c37413ae699c3e8c44aeddae4572bb246cfb4b34a54d7e54a291fdb3c758513` |
| `public-intake.test.ts` | `89b5c4675483cd1f5db85e4383149d1b81718f7dadd75dd4f8ed9357efcad6ec` |
| `p2-observability-postgres.test.ts` | `da983fe2b55a861f7f703039f489869cf1bcd282288effe17b899b7d6c91be78` |
| `p3-ai-run-span-retention.test.ts` | `d3bf84e92e5079e7e2cbd8f27607dac8fbf3beebd6430de1681b46a0063b24dd` |

## 10. Независимая проверка

Fresh Reviewer обязан выполнить Code Scout по callers, failure paths,
concurrency/locks, обеим migration lineages, privacy и false-green tests;
пересчитать hashes и выдать `accept | needs_fix | needs_evidence` без изменения
файлов. Результат будет добавлен после review.

Первый fresh Reviewer: `gpt-5.6-sol`, high reasoning, read-only session
`65010`; exact hashes совпали. Verdict: `needs_fix`.

Blocker: existing conversation читалась без row lock, после чего inbound сначала
менял lead и затем conversation по устаревшему AI-state. Concurrent takeover
использует обратный порядок `conversation -> lead`, поэтому допустимы и
перезапись завершённого takeover новым AI-enabled job, и PostgreSQL deadlock.
Reviewer также потребовал убрать false-green gap: добавить детерминированный
real-PostgreSQL interleaving `takeover/control <-> inbound` и реально выполнить
manager Telegram reply writer с проверкой sequence/epoch. Исправление не меняет
roadmap/ownership и не требует нового owner stop-gate.

## 11. Repair-цикл 1

Исполнитель устранил blocker внутри прежней области PR1:

- existing conversation теперь выбирается `FOR UPDATE` до вычисления
  `effectiveAgentAllowedToReply`, до lead update и до любого нового job;
  ingress, conversation control и takeover используют единый порядок
  `conversation -> lead`;
- real-PostgreSQL test удерживает lead row внешней транзакцией, запускает сначала
  takeover или conversation control, дожидается фактических lock waits и затем
  запускает concurrent inbound. В обоих вариантах операции завершаются без
  deadlock, итог остаётся `manager_active/false`, sequence/epoch равны `2/3`, а
  второго widget job нет;
- отдельный PostgreSQL scenario проходит через production
  `createManagerTelegramReplyContext -> persistManagerTelegramReply` и проверяет
  visitor/manager sequence `1,2`, generation epoch `3` и сохранённый takeover.

Evidence 2026-08-04 после repair:

- disposable PostgreSQL runtime invariants — `19/19` green;
- disposable PostgreSQL migration reconciliation — `5/5` green;
- `npm run typecheck` — green, все 55 bounded API test groups и manager;
- `npm run build` — green, повторный полный typecheck и Vite
  `2476 modules transformed`;
- M3 smoke evidence — `14/14` green;
- `git diff --check` — green.

Первый тестовый прогон repair был `18/19`: пробел из параметра
`conversation control` попал в тестовый idempotency key и был штатно отклонён
public contract до repository path. После slug-нормализации тестовых данных весь
suite прошёл; production-код из-за этого сбоя не менялся.

Новая архитектурная развилка, public contract, prompt/model/tools/privacy,
external DB apply и runtime activation не затронуты. Exact hashes в разделе 9
пересчитаны; второй fresh Reviewer должен повторить read-only Code Scout и
выдать новый verdict.

## 12. Второй fresh independent Reviewer

Reviewer: `gpt-5.6-sol`, high reasoning, read-only session
`019fcd54-9aa0-75d3-8c6b-b9bd687b1038`. Verdict: `accept`.

Reviewer подтвердил:

- ingress блокирует existing conversation до чтения AI-state и lead update;
- ingress, conversation control и takeover соблюдают единый порядок
  `conversation -> lead`, поэтому stale AI re-enable/deadlock blocker закрыт;
- PostgreSQL interleaving наблюдает реальные lock waiters и проверяет не только
  завершение, но state, epoch, sequence и отсутствие второго job;
- manager Telegram production writer реально исполняется в system test;
- commit fence и replay fail-closed contract сохранены, а PR2 work не протёк в
  PR1;
- все 15 exact hashes и общий tracked stat совпали.

Независимый evidence: typecheck green, M3 `14/14`, modular baseline `12/14`,
related memory/public baseline `55 passed / 9 failed / 11 skipped`, diff checks
green. Docker в reviewer sandbox был недоступен, поэтому Reviewer не заявил
собственный container run; он привязал карточные `5/5 + 19/19` к совпавшим
exact hashes. Build не повторялся в read-only роли. `origin/main` разошёлся с
Goal-веткой, но не затронул production-файлы PR1; merge/rebase не выполнялся и
не одобрялся.
