# Карточка среза AI-рефакторинга: AI-REF-PR0B — canonical AI schema/migration reconciliation

Статус: `accept`; fresh независимый Reviewer принял exact-hash PostgreSQL
evidence и полный A2 result

Goal: `AI-LIVE-REF-ROADMAP`, thread
`019fcbf4-d51f-71b0-bd6a-0a6e51263e12`.

Позиция: `PR 0a accept -> PR 0b -> PR 0c`.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`777d7dca351176b30042fa8b6bd136be041ddc04` /
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.

Фактическая модель проектирования: текущая Codex-модель, high reasoning.

## 1. Один результат

Одна forward-only migration chain после `0016_widget_ai_jobs.sql` сводит
известные narrow и broad lineage в явный app-owned storage superset с
`recording_contract`; production-shaped grounded reply атомарно сохраняет
outbound и `ai_runs`, а degradation path — совместимый `ai_quality_events`.

Конфликтующие старые Mastra/live-v2 migrations больше не являются executable
веткой. Public contract, prompt, tools, model policy, privacy, send gate и
takeover semantics не меняются.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| HEAD | `777d7dca351176b30042fa8b6bd136be041ddc04` |
| PR 0a | независимый `accept`; два real-PostgreSQL прогона `10 passed` |
| Active test manifest | narrow chain `0001..0016`, явно исключает три competing migrations |
| Fresh all-files apply | падает: competing `0010/0011/0012` образуют две истории |
| Active DB shape | narrow `ai_runs` из `0011_ai_handoff_degradation.sql` плюс grounded columns из `0012_grounded_widget_ai.sql` |
| Drizzle shape | broad app-owned `ai_runs`, `ai_run_spans`, `ai_quality_events` contract в `packages/db/src/schema.ts` |
| Reproduced mismatch | production insert доходит до PostgreSQL `42703` на отсутствующем `ai_runs.trace_id` |
| Следующий mismatch | простого `ADD COLUMN` недостаточно: direct writer использует `replied/handoff/degraded`, broad constraints используют `persisted/handed_off/...` и требуют другую linkage/evidence семантику |
| External DB state | staging/production migration inventory не проверялся и не предполагается |
| Dirty worktree | отдельно сохраняет accepted PR 0a diff и чужие untracked docs/`output/` |

Источники истины по приоритету:

1. `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md` — app-owned
   runtime/observability; старые alternative `0010/0011` не являются main chain.
2. `docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md` — принятый executable
   baseline и точный schema mismatch.
3. canonical wiki `15-observability-contract.md` — trace/run/message/lead linkage,
   model/version, cost, fallback и retention contract.
4. `packages/db/src/schema.ts` и текущие PostgreSQL repositories — живой contract.
5. owner roadmap — PR 0b до hotfix PR 0c.

Исторические release evidence о применении alternative migrations не являются
доказательством текущей staging/production schema.

## 3. Рассмотренные стратегии

### A — предварительный forward-only app-owned superset reconciliation

- убрать три competing SQL-файла из executable root, сохранив их как archived
  provenance, а не как применяемые migrations;
- добавить `0017_ai_schema_reconciliation.sql` после активной narrow chain;
- forward-only привести `ai_runs`, `ai_run_spans`, `ai_quality_events`, indexes
  и constraints к одному app-owned storage superset;
- адаптировать direct `PostgresIntakeRepository` writes к явным status/linkage
  profiles, не выдумывая неизвестные timing/send-gate evidence;
- проверить fresh narrow chain и отдельный seeded upgrade probe на disposable
  PostgreSQL; external DB не трогать.

Плюсы: один contract, сохраняется богатая app-owned observability и future
span/eval linkage; PR0a red path становится честно green. Минусы: migration и
production persistence меняются вместе, нужен точный data backfill/constraint
порядок и отдельный deploy gate позже. Свежий аудит в разделе 9 уточняет этот
вариант до A2 и заменяет его allowlist и формулировку разрешения.

### B — сузить Drizzle до narrow active schema

Удалить broad run/span contract и перепривязать recorded runtime к narrow
таблицам. Это меньше DDL, но ломает уже существующий app-owned observability
слой, canonical observability requirements и расширяет PR0b до удаления runtime
capabilities. Не рекомендовано.

### C — добавить только отсутствующие columns или test-only DDL

Оставить два status/linkage dialect и лишь убрать первый `42703`. Это создаёт
false-green: следующий constraint/default mismatch остаётся, а schema и
migrations всё ещё не имеют одной семантики. Отклонено.

## 4. Предварительная область варианта A

Этот ранний high-risk allowlist заменён точным A2 allowlist в разделе 9:

- `packages/db/migrations/0017_ai_schema_reconciliation.sql`;
- три competing migration artifacts — только перенос из executable root в
  явно non-executable archive либо удаление после сохранения git provenance;
- `packages/db/src/schema.ts` — только если probe найдёт расхождение с выбранным
  canonical contract;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- относящийся app-owned PostgreSQL AI-run repository, только если его contract
  не проходит migration probe;
- PR0a harness/spec для нового manifest и превращения schema xfail в green;
- новый focused migration-upgrade integration test, если сценарий нельзя
  выразить в существующем spec;
- эта карточка.

Явно вне области:

- public intake request/response shape;
- prompt, tools, model/provider settings, AI policy, privacy;
- send gate/takeover behavior;
- business tables вне AI observability linkage;
- staging/production apply, deploy, secrets/runtime config и другой repo;
- PR0c/PR1 fixes.

Ориентир: одна forward migration, до двух production persistence/schema files,
до двух integration files и эта карточка. Существенное расширение обязан
объяснить Reviewer.

## 5. Критерии успеха после одобрения

- [x] В executable migration root нет конкурирующих номеров; fresh chain
  `0001..0017` применяется лексикографически без ручного exclusion list.
- [x] Seeded narrow `ai_runs`/quality rows переживают upgrade; backfill выполнен
  до `NOT NULL`/constraints, row linkage не теряется.
- [x] Drizzle schema, indexes и constraints соответствуют migrated DB по
  проверяемому inventory.
- [x] PR0a production-shaped case становится active green: ровно один visitor,
  один outbound, один job и один linked `ai_runs`.
- [x] Grounded failure/degradation создаёт допустимый `ai_runs` и
  `ai_quality_events`, не теряя inbound.
- [x] Manager takeover, duplicate intake, lost finish, shadow isolation и typed
  future invariants PR0a не ослаблены.
- [x] Direct writer использует явный profile contract; known broad rows/spans
  сохраняются, а recorded/Mastra path не получает нового caller.
- [x] Targeted PostgreSQL integration, typecheck, build и `git diff --check`
  green; boundary check сохраняет известный base baseline `12/14` без новых
  failures.

## 6. Stop-gate и требуемое решение владельца

Сработали два связанных gate:

- migration/schema БД;
- архитектурная канонизация ownership/status/linkage внутри `ai_runs`.

Предварительный вариант A был уточнён свежим аудитом до A2. Действующей является
только дословная формулировка разрешения в разделе 9; она **не** разрешает
применить migration к staging или production.

До точного решения A2 из раздела 9 рабочий код, schema и migrations PR0b не
изменяются.

Полученное разрешение владельца 2026-08-04:

> Одобряю PR 0b вариант A2: migration 0017 выполняет forward-only dual-lineage
> reconciliation…

Разрешение применяется в полном ограниченном смысле A2 из раздела 9: только
repo-local allowlist и disposable PostgreSQL; external apply/deploy не разрешены.

## 7. Risks, evidence и rollback

Главные непроверенные риски:

- фактическая schema и данные любой внешней DB;
- backfill для состояния, отличного от двух repo-known веток;
- lock duration на реальном объёме;
- downgrade после применения.

Rollback до external apply: вернуть отдельный PR0b diff; PR0a harness остаётся
валидным red baseline. После будущего external apply автоматический destructive
downgrade не предлагается: нужны backup/restore либо forward corrective
migration и явный release gate.

Перед любым staging/production apply потребуется отдельный read-only schema
inventory, backup/restore evidence, lock/row-count оценка и новое разрешение.

## 8. Предварительная передача до approval A2 (историческая)

```text
Goal: AI-LIVE-REF-ROADMAP
Текущий срез: PR 0b
Статус: needs_human_decision
Base/head SHA: 777d7dca351176b30042fa8b6bd136be041ddc04
Результат: canonical AI schema/migration reconciliation
Изменённые области сейчас: только PR0a accept record и эта PR0b card
Evidence: PR0a real PostgreSQL accept + read-only schema/migration Code Scout
Непроверено: external DB state, locks, upgrade from unknown schema
Rollback: до apply — revert PR0b diff; после apply — backup/restore or forward fix
Verdict: owner decision required
Следующий срез: PR 0c только после PR0b independent accept
```

## 9. Свежий архитектурный аудит stop-gate

Аудит выполнен 2026-08-04 от HEAD `777d7dca351176b30042fa8b6bd136be041ddc04`; tests и external DB не запускались.

### Verdict и evidence

Исходный A жизнеспособен только как уточнённый **A2: forward-only dual-lineage,
profile-discriminated app-owned reconciliation**. «Drizzle contract каноничен
целиком» отклонено: это merge-гибрид narrow/broad (`packages/db/src/schema.ts:438-726`)
с Mastra coupling (`packages/db/migrations/0010_ai_run_quality_observability.sql:47-65`).

- Normal path пишет narrow status/public linkage без terminal timing/gate (`postgres-intake-repository.ts:890-914,1033-1059`), broad — другое (`schema.ts:557-723`).
- Recorded repository создаётся (`apps/api/src/index.ts:18-24`), но caller требует
  отсутствующую у `PostgresIntakeRepository` capability (`recorded-site-widget-ai-reply-repository.ts:21-28`;
  `postgres-intake-repository.ts:148-153`); этот path нельзя молча «оживить».
- Manager verification принимает narrow statuses (`postgres-intake-repository.ts:3861-3869`); DB normalization требует mapper, но не изменения response shape.
- Degradation reasons шире schema checks (`postgres-intake-repository.ts:3953-3970`; `schema.ts:1027-1046`).
- Narrow mismatch доказан PR0a (`AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md:893-914`);
  broad branch применялась (`AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md:168-179`),
  но external schema неизвестна (`AI_REF_PR0B_CANONICAL_AI_SCHEMA_MIGRATION_RU.md:159-174`).

Вариант B теряет broad rows/spans и trace linkage (`15-observability-contract.md:50-64,126-149`);
C даёт false-green после `42703`. A2 сохраняет storage superset, но делит checks
через `recording_contract`: native grounded, native recorded, legacy narrow;
неизвестные evidence/timing не выдумываются. Spans создаются/сохраняются, quality
получает actual parity; ADR-010 ownership не меняется (`ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md:25-64`).

### Точный allowlist и не-область

Allowlist: `packages/db/migrations/0017_ai_schema_reconciliation.sql`;
`packages/db/src/schema.ts`; перенос трёх competing SQL в
`packages/db/migration-archive/mastra-live-v2/`; `postgres-intake-repository.ts`;
`conversation-message-repository.ts`; `public-widget-intake-service.ts`;
`postgres-ai-run-repository.ts` только для parity выбранного contract; PR0a
helper/spec; новый `apps/api/test/ai-schema-migration-reconciliation.test.ts`;
эта карточка. Другие production/test/package/deploy файлы запрещены.

Не область: добавление recorded capability; изменение `app-context.ts`,
`index.ts`, config/Mastra/live-v2; prompt/tools/model/privacy/send gate/takeover;
public/manager response shape; PR0c/PR1; external apply, deploy, secrets и другой repo.

### Migration, backfill и verification order

1. В `0017` сначала fail-closed определить ровно narrow либо known broad lineage;
   unknown/hybrid shape остановить без DDL.
2. Добавить nullable superset columns и отсутствующий `ai_run_spans`; сверить
   существующий `ai_quality_events`, не пересоздавая/не теряя строки.
3. Narrow rows связать с inbound/outbound internal message IDs строгим join по
   public ID + lead/conversation/direction; missing/ambiguous linkage — rollback.
4. Нормализовать statuses/action/reasons, поставить `recording_contract`; gate
   выводить только из atomic outbound transaction, неизвестные timing/model/version
   оставить явно legacy-unknown, а не подделывать `0 ms`/фиктивную модель.
5. Затем добавить/заменить CHECK/FK/UNIQUE/indexes и `VALIDATE`; только после
   row-count, orphan, duplicate и constraint canaries зафиксировать commit DDL.
6. Проверить fresh narrow `0001..0017`, seeded narrow upgrade и seeded archived
   broad `0010+0011 -> 0017`; затем PR0a production-shaped/degradation probes,
   schema inventory, typecheck/build/boundary check и `git diff --check`.
7. До external apply rollback — убрать изолированный PR0b diff. После будущего
   apply down-migration запрещена: backup/restore либо forward corrective migration.

Требуемое дословное решение владельца:

> Одобряю PR 0b вариант A2: migration `0017` выполняет forward-only dual-lineage
> reconciliation narrow и known broad app-owned AI schema с явным
> `recording_contract`, без выдумывания неизвестного historical evidence;
> competing `0010/0011/0012` переносятся в non-executable archive; direct writer,
> manager mapper, `ai_run_spans` и `ai_quality_events` приводятся к этому contract
> только в указанном allowlist. Recorded/Mastra path не включается и не получает
> нового caller. Разрешены лишь disposable PostgreSQL проверки; external DB apply,
> deploy, secrets/runtime config и другие репозитории не разрешены.

## 10. Последовательная реализация A2

Выполнена 2026-08-04 от base/head
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался. Фактическая
модель: текущая Codex-модель, high reasoning. Новая архитектурная развилка не
потребовалась, allowlist не расширялся.

Реализовано:

- executable root теперь содержит одну lexicographic цепочку `0001..0017`;
  три competing migration сохранены с original-path provenance в
  `packages/db/migration-archive/mastra-live-v2/`;
- `0017_ai_schema_reconciliation.sql` до persistent DDL различает только known
  narrow и known broad lineage, отклоняет unknown/hybrid, связывает public и
  internal message IDs, сохраняет rows/spans/quality и валидирует canaries,
  FK/CHECK/index inventory;
- `recording_contract` разделяет `native_grounded`, `native_recorded` и
  `legacy_narrow`; historical narrow timing, trace и configured-model evidence
  остаются `NULL`, если исходная строка их не доказывает; существующий
  `model_name` сохраняется отдельно без переквалификации в configured evidence;
- direct grounded success/degradation пишет canonical statuses, linkage,
  actual send-gate evidence и quality reasons; manager mapper сохраняет прежний
  public response shape; recorded repository только маркирует собственные
  записи и не получает caller;
- PR0a manifest больше не содержит exclusion list, typed `42703` xfail заменён
  active canonical linkage assertion;
- focused migration suite содержит fresh narrow, seeded narrow, seeded archived
  broad и hybrid-rejection scenarios с row-count/orphan/constraint assertions.

Полный список PR0b-файлов:

- `packages/db/migrations/0017_ai_schema_reconciliation.sql`;
- `packages/db/migration-archive/mastra-live-v2/0010_ai_run_quality_observability.sql`;
- `packages/db/migration-archive/mastra-live-v2/0011_live_v2_controlled_no_reply.sql`;
- `packages/db/migration-archive/mastra-live-v2/0012_manager_ai_runtime_controls.sql`;
- прежние три executable paths удалены переносом;
- `packages/db/src/schema.ts`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- `apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts`;
- `apps/api/test/helpers/postgres-widget-ai-test-harness.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
- `apps/api/test/ai-schema-migration-reconciliation.test.ts`;
- эта карточка.

Raw allowlist worktree stat относительно HEAD после repair-цикла 1: `2663 insertions / 631
deletions`. В него входят сохранённый accepted PR0a delta в helper/spec,
untracked карточка целиком и механический archive move (`566` добавленных строк
архива против `557` удалённых executable строк; `+9` provenance). Production
расширение выше раннего ориентира объясняется profile-discriminated DDL,
двойным seeded upgrade harness и fail-closed canaries; это не новый scope и
требует отдельной проверки Reviewer после PostgreSQL evidence.

Impact:

- прямое влияние: repo-local migration history, AI observability storage,
  grounded/recorded PostgreSQL persistence и manager status mapping;
- косвенное влияние: PR0a worker integration получает canonical `ai_runs`, а
  future recorded persistence обязана давать public/internal message linkage;
- не изменены public contract, prompt/tools/model policy, privacy, send gate,
  takeover, runtime assembly, config, deploy и другие репозитории.

Evidence до repair-цикла 1:

- `npm run typecheck` — API source/packages и все 55 test groups прошли;
  manager `tsc --noEmit` прошёл отдельно;
- `npm -w @granit/manager run build` — green, Vite `2476 modules transformed`;
- `git diff --check` — green;
- `npx vitest run apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `12 passed / 2 failed`; оба failure доказаны как pre-existing HEAD baseline:
  HEAD уже содержит disallowed-by-test `live-v2` sources и
  `SENSITIVE_VALUE`, тогда как test ожидает `SENSITIVE_STRING`; исправление вне
  A2 allowlist;
- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  --maxWorkers=1` — не дошёл до SQL: `Could not find a working container runtime
  strategy`, 4 scenarios skipped;
- `npm run test:widget-ai:postgres` — тот же environment blocker до migrations,
  10 scenarios skipped;
- `docker info` — sandbox возвращает permission denied на
  `/var/run/docker.sock`; Podman и локальные `postgres/initdb` отсутствуют.

## 11. Repair-цикл 1: pooled migration transaction и nullable evidence

Подтверждённые замечания владельца:

1. Focused migration suite отправлял SQL-файлы с `BEGIN..COMMIT` через pooled
   postgres-js client `max=5` и на Docker-capable прогоне дал `4/4 fail` с
   `UNSAFE_TRANSACTION` до проверки migration semantics.
2. `0017` фабриковала legacy trace/configured-model evidence через
   `trace_id=id`, `none` и `legacy-unknown`; current degradation фабриковала
   `none/runtime-unknown`.

Repair внутри прежнего A2 allowlist:

- `applyMigrations` в focused test резервирует одно postgres-js connection на
  SQL-файл, выполняет весь `BEGIN..COMMIT` на нём и при ошибке делает `ROLLBACK`
  на том же connection до release;
- storage superset и Drizzle schema делают `trace_id`,
  `configured_model_provider`, `configured_model_name` nullable и не задают
  fabricated defaults/backfill;
- `ai_runs_contract_evidence_check` требует trace и оба configured-model поля
  для `native_recorded`, но разрешает неизвестное evidence для
  `native_grounded`/`legacy_narrow`; duplicate canary игнорирует `NULL` trace так
  же, как nullable unique index;
- `PostgresAiRunRepository` fail-closed отклоняет `native_recorded` row без
  trace до сборки typed `RunningAiRunRecord`;
- grounded persistence сохраняет известные provider/model values, но оставляет
  неизвестные values `NULL`; seeded narrow assertions проверяют `NULL` для
  trace/configured evidence и сохранение реального legacy `model_name`.

Evidence repair-цикла 1 от неизменного HEAD
`777d7dca351176b30042fa8b6bd136be041ddc04`:

- `git diff --check` — green;
- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  --maxWorkers=1` — Testcontainers environment blocker до `beforeAll`: `Could
  not find a working container runtime strategy`, четыре scenario skipped;
- `npm run typecheck` — red в API source/packages: только
  `apps/api/src/scripts/run-m3-mastra-smoke-once.ts:193-194` передаёт теперь
  nullable `configuredModelProvider/configuredModelName` в non-null smoke
  predicate. Этот historical Mastra smoke-script не входит в точный A2
  allowlist и поэтому в repair не изменён;
- focused `npx tsc --noEmit ...` для migration test, обоих изменённых
  PostgreSQL repositories и `packages/db/src/schema.ts` — green;
- `npm -w @granit/manager run typecheck` — green;
- sentinel scan по A2 production/migration/test files не находит
  `trace_id=id`, `legacy-unknown`, `runtime-unknown` либо возврата `NOT NULL` для
  трёх nullable evidence columns.

Статус `needs_fix`, а не `technical_done`: обязательный typecheck красный, а
focused PostgreSQL probes не выполнены. Для завершения нужен отдельный owner
маршрут для out-of-allowlist smoke consumer либо иное решение в разрешённых
границах; после этого Docker-capable main повторяет focused migration suite и
`npm run test:widget-ai:postgres`.

Непроверено после repair: reserved-connection execution и SQL semantics `0017`
на PostgreSQL, fresh/seeded row-count/orphan/constraint assertions, external DB
inventory, реальные row counts и lock duration. External DB не читалась и не
изменялась.

Rollback до external apply: удалить изолированный PR0b diff и вернуть три SQL в
executable root; accepted PR0a baseline остаётся отдельно. После будущего apply
down-migration запрещена: только backup/restore либо новая forward corrective
migration после отдельного release gate.

## 12. Repair-цикл 2: порядок замены narrow status constraint

Docker-capable main после reserved-connection repair выполнил focused
PostgreSQL suite с результатом `3/4 green`. Единственный красный сценарий —
seeded narrow upgrade: `0017` пыталась нормализовать `replied`/`degraded` в
`persisted`/`fallback_unavailable`, пока прежний narrow
`ai_runs_status_check` ещё оставался активным.

Минимальный repair внутри прежнего A2 allowlist:

- после fail-closed lineage detection и до status normalization migration
  снимает прежний `ai_runs_status_check` внутри той же transaction;
- поздний `DROP CONSTRAINT IF EXISTS ai_runs_status_check` оставлен как
  идемпотентная часть общего блока замены constraints;
- архитектура, status mapping и другие semantics не менялись; out-of-allowlist
  smoke-script не изменялся.

Evidence repair-цикла 2 от неизменного HEAD
`777d7dca351176b30042fa8b6bd136be041ddc04`:

- Docker-capable main focused PostgreSQL — `3/4 green` до этого repair;
- seeded narrow upgrade — red в `0017` на прежнем `ai_runs_status_check` до
  этого repair;
- `git diff --check` — green после repair;
- повторный Docker-capable focused PostgreSQL suite — awaiting rerun.

На момент repair-цикла 2 статус оставался `needs_evidence`: seeded narrow
upgrade и полный focused PostgreSQL `4/4` ещё не были подтверждены повторным
Docker-capable прогоном.

## 13. Repair-цикл 3: reserved connection в PR0a migration helper

Docker-capable main после repair-цикла 2 повторил focused PostgreSQL
reconciliation: `4/4 green`. Следующий `npm run test:widget-ai:postgres` упал в
`beforeAll` с `UNSAFE_TRANSACTION`: PR0a helper исполнял transactional `0017`
через pooled `database.client` с `max: 5`, поэтому `BEGIN..COMMIT` не был
закреплён за одним PostgreSQL connection.

Минимальный repair только в разрешённом PR0a helper:

- `applyActiveMigrations` резервирует отдельный postgres-js connection для
  каждого migration-файла и исполняет весь файл на нём;
- при ошибке helper делает best-effort `ROLLBACK` на том же reserved connection,
  повторно выбрасывает исходную ошибку и всегда вызывает `release` в `finally`;
- production code, migration, schema и другие tests не менялись; A2 allowlist
  не расширялся.

Evidence repair-цикла 3 от неизменного HEAD
`777d7dca351176b30042fa8b6bd136be041ddc04`:

- Docker-capable focused PostgreSQL reconciliation после repair-цикла 2 —
  `4/4 green`;
- `npm run test:widget-ai:postgres` до этого repair — red в `beforeAll` с
  `UNSAFE_TRANSACTION` при применении transactional `0017` через pooled client;
- PR0a PostgreSQL suite после reserved-connection repair — `10/10 green`;
- `git diff --check` — green; отдельный check untracked карточки не выдал
  whitespace-диагностик;
- полный `npm run typecheck` остаётся red только на out-of-allowlist
  `apps/api/src/scripts/run-m3-mastra-smoke-once.ts:193-194`, где nullable
  configured-model evidence передаётся в non-null smoke predicate; consumer не
  изменялся.

Статус сохраняется `needs_fix`, а не `technical_done`: обязательный полный
typecheck красный на out-of-allowlist consumer. PR0a real-PostgreSQL scenarios
после repair подтверждены `10/10 green`; непроверены external DB inventory,
реальные row counts и lock duration. External DB не читалась и не изменялась.

Rollback этого repair: вернуть только reserved-connection block в PR0a helper;
production rollback не требуется. Общий rollback PR0b до external apply остаётся
прежним; после apply допустимы только backup/restore либо новая forward
corrective migration через отдельный release gate.

## 14. Точный remaining stop-gate после PostgreSQL evidence

Docker-capable evidence полностью зелёный:

- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  --maxWorkers=1` — `4/4 green`;
- `npm run test:widget-ai:postgres` — `10/10 green`;
- disposable containers с labels PR0a/PR0b после прогонов отсутствуют;
- `git diff --check` — green;
- modular boundaries — прежний baseline `12/14`: оба red вне A2 diff
  (`Mastra-like observability` и ожидаемое имя sanitizer sentinel).

Единственный обязательный blocker — `npm run typecheck`: строки 193-194
`apps/api/src/scripts/run-m3-mastra-smoke-once.ts` передают nullable
`configuredModelProvider/configuredModelName` в non-null smoke evidence input.
Это ожидаемое следствие честной nullable storage schema, но файл не входит в
утверждённый high-risk allowlist.

Предлагаемый минимальный owner-approved repair: добавить только этот файл в
allowlist и передавать оба значения как fail-closed `value ?? ""`. При `NULL`
существующий smoke predicate остаётся false; public contract, model policy,
privacy, send gate, takeover и runtime activation не меняются. После approval
Исполнитель выполняет этот двухстрочный repair, полный typecheck/build и затем
передаёт PR0b свежему независимому Reviewer.

Разрешение владельца получено 2026-08-04: «одобряю». Оно относится только к
описанному выше двухстрочному repair в
`apps/api/src/scripts/run-m3-mastra-smoke-once.ts`; остальные границы A2 и запрет
на commit/push/deploy/external DB apply сохраняются.

## 15. Repair-цикл 4: fail-closed historical M3 smoke consumer

После точечного owner approval в A2 allowlist добавлен только
`apps/api/src/scripts/run-m3-mastra-smoke-once.ts`. Оба nullable storage-поля
передаются в существующий `isSuccessfulM3Smoke` как `value ?? ""`; неизвестное
configured-model evidence поэтому не становится успешным smoke и не
фабрикуется. Runtime activation, provider/model choice, public contract,
privacy, send gate и takeover не менялись.

Evidence от HEAD `777d7dca351176b30042fa8b6bd136be041ddc04`:

- `npm run typecheck` — green: API source/packages, все 55 test groups и manager
  TypeScript;
- `npm run build` — green: повторный полный typecheck и manager Vite build,
  `2476 modules transformed`;
- `npx vitest run apps/api/test/m3-smoke-evidence.test.ts --maxWorkers=1` —
  `14/14 green`;
- `git diff --check` — green;
- PostgreSQL evidence текущего A2 DB/runtime diff до этого изолированного
  consumer repair остаётся: focused reconciliation `4/4 green`, PR0a runtime
  invariants `10/10 green`; повторный container-прогон не выполнялся, потому что
  repair не меняет DDL, persistence или harness.

Полный PR0b allowlist теперь дополнительно включает только historical M3 smoke
consumer выше. Untracked owner architecture docs, control-plane docs,
`docs/human-knowledge/` и `output/` не являются частью PR0b и не изменялись.

Непроверено: external DB inventory, реальные row counts и lock duration;
staging/production apply и deploy не выполнялись. Rollback остаётся прежним:
до external apply удалить изолированный PR0b diff; после будущего apply — только
backup/restore либо новая forward corrective migration через отдельный gate.

Срез передан свежему независимому Reviewer со статусом `technical_done`.

## 16. Свежая независимая проверка после repair-цикла 4

Reviewer: отдельный fresh read-only запуск Codex `gpt-5.6-sol`, high reasoning;
код и документы Reviewer не изменял.

Подтверждённые блокирующие находки:

1. `0017` и `packages/db/src/schema.ts` не задают один и тот же итоговый
   contract: расходятся defaults `decision_profile`/`status`, допустимые
   outcome/quality reasons, cost-rate validation и сочетание
   `persisted/no_reply`. Текущий inventory проверяет имена и `convalidated`, но
   не определения constraints/defaults/indexes, поэтому возможен false-green.
2. PostgreSQL runtime suite исполняет grounded success, но не degradation writer
   с `ai_quality_events`; изменённый `PostgresAiRunRepository` не проходит
   begin/replay/completion на schema после `0017`. Direct SQL fixtures migration
   suite эти writer contracts не доказывают.

Отброшенные гипотезы:

- archived SQL не изменён кроме provenance comments;
- recorded/Mastra capability не активирована и нового caller нет;
- send gate/takeover sequencing не обойдён;
- nullable legacy evidence не фабрикуется;
- reserved-connection helpers статически удерживают transaction на одном
  connection;
- новых PII/secrets/public-contract изменений не найдено.

Проверки Reviewer:

- root и manager `tsc --noEmit` — green;
- scoped tracked/untracked `git diff --check` — green;
- PostgreSQL/Vitest rerun в read-only reviewer environment не выполнен:
  read-only `/tmp` блокировал Vitest collection, Docker daemon недоступен;
  это не заменяет ранее полученные Docker-capable `4/4` и `10/10`, но новые
  coverage-сценарии после repair потребуют повторного PostgreSQL прогона.

Verdict: `needs_fix`.

Repair остаётся в прежнем A2 allowlist: синхронизировать SQL и Drizzle contract,
усилить exact inventory и добавить focused disposable-PostgreSQL проверки двух
writer paths. Новая архитектура, public contract, policy/privacy/send gate или
external apply не требуются.

## 17. Repair-цикл 5: exact contract и исполняемые writer paths

Исполнитель исправил обе блокирующие находки Reviewer внутри прежнего A2
allowlist, без новой архитектурной развилки:

- `0017` и Drizzle schema теперь совпадают по defaults `decision_profile` и
  `status`, nullable/default semantics `reasoning_effort` и `started_at`, полным
  outcome/quality reason enum, safe cost-rate validation и запрету
  `persisted/no_reply`;
- migration inventory проверяет не только имена и `convalidated`, но точные
  defaults/nullability, literals ключевых CHECK, cost regex/length, terminal
  action semantics, validated `NO ACTION` message FK и определения canonical
  indexes для fresh narrow, seeded narrow и seeded broad lineage;
- real-PostgreSQL runtime suite исполняет grounded degradation writer и
  проверяет связанный `native_grounded` run плюс manager-visible
  `ai_quality_events`;
- тот же suite исполняет `PostgresAiRunRepository` begin, running replay,
  invalid inbound linkage rejection, DB fail-closed nullable configured-model
  evidence, controlled no-reply completion, span/quality persistence и terminal
  replay на schema после `0017`.

Evidence от неизменного HEAD/base
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался:

- `npm run typecheck` — green: API source/packages, все 55 test groups и manager
  TypeScript;
- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  apps/api/test/widget-ai-postgres-runtime-invariants.test.ts --maxWorkers=1` —
  `2 files / 16 tests green` на disposable PostgreSQL: migration `4/4`, runtime
  `12/12`;
- `npm run build` — green: повторный полный typecheck и manager Vite build,
  `2476 modules transformed`;
- `npx vitest run apps/api/test/m3-smoke-evidence.test.ts --maxWorkers=1` —
  `14/14 green`;
- `git diff --check` — green.

Прямое влияние repair-цикла ограничено canonical DDL/schema contract и двумя
integration specs. Public/manager response shape, runtime activation,
prompt/tools/model policy, privacy, send gate, takeover и external DB не
изменялись. Непроверенными остаются только external DB inventory, реальные row
counts и lock duration; staging/production apply и deploy не выполнялись.

Статус перед fresh независимым Reviewer: `technical_done`.

## 18. Свежая независимая проверка после repair-цикла 5

Reviewer: новый отдельный запуск Codex `gpt-5.6-sol`, high reasoning; Reviewer
работал без изменения файлов и проверил предыдущие замечания вместе с callers,
failure paths, concurrency, migrations, privacy и false-green tests.

Предыдущие блокеры по defaults/enum/cost/linkage, degradation writer и
`PostgresAiRunRepository` begin/replay/no-reply path подтверждены как закрытые.
Найдены две оставшиеся блокирующие границы evidence:

1. `0017` содержит `ai_runs_verifier_verdict_check` и
   `ai_runs_catalog_content_hash_check`, но Drizzle schema их не выражает;
   inventory сравнивает только выбранные constraints и поэтому не гарантирует
   полный exact CHECK contract.
2. Изменённый reply-bearing transaction path
   `completeAiRunInTransaction` не исполняется PostgreSQL suite: controlled
   no-reply доказывает terminal replay без outbound, но не атомарную запись и
   replay с внутренним и публичным outbound linkage.

Reviewer дополнительно подтвердил отсутствие нового recorded/Mastra caller,
runtime activation, изменения prompt/tools/model policy, privacy, public
contract, send gate или takeover. Исторические baseline failures modular
boundaries и несвязанных public-intake/turn-context specs воспроизводятся от
base и не относятся к A2 diff. Docker daemon в reviewer environment был
недоступен, поэтому его статический аудит не заменяет Docker-capable evidence
Исполнителя.

Verdict: `needs_fix`.

## 19. Repair-цикл 6: полный CHECK parity и reply-bearing linkage

Исполнитель исправил ровно две находки Reviewer внутри прежнего A2 allowlist:

- Drizzle schema добавляет `ai_runs_verifier_verdict_check` и
  `ai_runs_catalog_content_hash_check` с теми же literals/length semantics, что
  canonical `0017`;
- migration inventory извлекает все именованные CHECK из Drizzle для
  `ai_runs`, `ai_run_spans` и `ai_quality_events`, читает все CHECK этих таблиц
  из disposable PostgreSQL и требует точного равенства множеств имён; отдельно
  проверяет definitions двух найденных constraints;
- runtime integration spec выполняет reply-bearing
  `completeAiRunInTransaction` внутри настоящей Drizzle transaction, сохраняет
  outbound message, проверяет terminal replay, internal/public outbound IDs,
  `send_gate_result = allowed` и связанный span.

Evidence от неизменного HEAD/base
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался:

- `npm run typecheck` — green: API source/packages, все 55 test groups и manager
  TypeScript;
- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  apps/api/test/widget-ai-postgres-runtime-invariants.test.ts --maxWorkers=1` —
  `2 files / 17 tests green` на disposable PostgreSQL: migration `4/4`, runtime
  `13/13`;
- `npm run build` — green: повторный полный typecheck и manager Vite build,
  `2476 modules transformed`;
- `npx vitest run apps/api/test/m3-smoke-evidence.test.ts --maxWorkers=1` —
  `14/14 green`;
- `git diff --check` — green.

Прямое влияние repair-цикла ограничено двумя CHECK declarations и двумя
integration specs. Косвенно проверяются canonical schema/migration parity и
reply-bearing recorded persistence; новый runtime caller не добавлен. Public
contract, prompt/tools/model policy, privacy, send gate/takeover semantics и
external DB не менялись.

Непроверены external DB inventory, реальные row counts, lock duration и
staging/production apply. До external apply rollback — удалить отделимый PR0b
diff; после будущего apply — только backup/restore либо новая forward corrective
migration через отдельный release gate.

Статус перед очередным fresh независимым Reviewer: `technical_done`.

## 20. Свежая независимая проверка после repair-цикла 6

Reviewer: новый отдельный запуск Codex `gpt-5.6-sol`, high reasoning; файлы не
изменял. Он выполнил полный Code Scout и подтвердил как nonissues весь
технический результат repair-цикла 6:

- SQL и Drizzle статически имеют `47/47` уникальных CHECK без расхождений;
- defaults, nullability, canonical indexes, FK и определения новых verifier/hash
  constraints совпадают;
- full-set CHECK inventory, четыре migration lineage scenarios, degradation
  writer, recorded begin/replay/no-reply и reply-bearing transaction path
  действительно исполняют production classes;
- нового recorded/Mastra caller или runtime activation, а также изменений public
  contract, prompt/tools/model policy, privacy, takeover и send-gate sequencing
  нет;
- архивные migrations после трёх provenance-комментариев байт-в-байт совпадают
  с прежними executable файлами.

Reviewer самостоятельно получил green `npm run typecheck`, M3 `14/14` и
`git diff --check`; modular boundaries воспроизвёл прежний baseline `12/14`.
Его isolated environment не имел container runtime, поэтому PostgreSQL suites
завершились до тестов с `Could not find a working container runtime strategy`.

Единственный blocker: записанный Исполнителем Docker-capable `17/17` был
привязан только к неизменному HEAD, а не к exact hashes незакоммиченных source
files. Поэтому Reviewer не мог доказать, что PostgreSQL исполнял текущие bytes.

Verdict: `needs_evidence`.

## 21. Evidence-цикл 7: exact-hash PostgreSQL replay

Рабочий код после `needs_evidence` не менялся. Исполнитель вычислил SHA-256 до
Docker-capable прогона, повторил обе PostgreSQL suites, затем вычислил SHA-256
тех же файлов повторно. До и после совпали:

| Файл | SHA-256 |
|---|---|
| `apps/api/test/ai-schema-migration-reconciliation.test.ts` | `d2224c6d981b2c4d52b5ef4a71c4826cd4aa0be175ed8d175026e4effee6ebed` |
| `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts` | `31ebcbc2d78d8d05d80c808a460de52c012b9af681a3412df4e464bfdd1af41c` |
| `apps/api/test/helpers/postgres-widget-ai-test-harness.ts` | `2cf5cc19523d44ae337876a3041feac01207e456fa89ea00da6bcab3fe1ff3f9` |
| `packages/db/migrations/0017_ai_schema_reconciliation.sql` | `535c7a37384a2103d56a00b08c7e79622f31931aa79179a7ed568431dba129ea` |
| `packages/db/src/schema.ts` | `77e5633a8bcdf3b34a2477453aac3283f0077fa7f27d19d4ba9de2b7e43f87f9` |
| `apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts` | `ef4a916d99ecdac39972364b4155a1fc4551e447d4266e7955d5ea42e3782fd2` |
| `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` | `cb660eef136261db0469521f1da3c571538852df98cc96eb7183b585d2f30b47` |
| `apps/api/src/scripts/run-m3-mastra-smoke-once.ts` | `baab848dd2872dd7fd1ccc26fc08e50802d0936bac84a34c354f1416f0c9f35c` |

Между двумя одинаковыми hash manifests выполнено:

- `npx vitest run apps/api/test/ai-schema-migration-reconciliation.test.ts
  apps/api/test/widget-ai-postgres-runtime-invariants.test.ts --maxWorkers=1` —
  `2 files / 17 tests green` на disposable PostgreSQL: migration `4/4`, runtime
  `13/13`;
- `git diff --check` — green.

Таким образом Docker-capable PostgreSQL evidence теперь относится к точным
bytes текущего незакоммиченного A2 diff, а не только к base/head. Остальные
evidence и непроверенные external DB области из раздела 19 не менялись.

Статус перед fresh независимым evidence re-review: `technical_done`.

## 22. Финальная независимая проверка и accept

Reviewer: новый отдельный read-only запуск Codex `gpt-5.6-sol`, high reasoning.
Он независимо пересчитал все восемь SHA-256 из раздела 21 и получил полное
совпадение. Дополнительно подтверждены `47/47` CHECK parity, реальный вызов
`completeAiRunInTransaction` с internal/public outbound linkage и terminal
replay, а также отсутствие нового recorded/Mastra runtime caller.

Собственные проверки Reviewer:

- `npm run typecheck` — green;
- M3 smoke evidence — `14/14 green`;
- `git diff --check`, включая untracked slice artifacts, — green;
- modular boundaries — прежний base baseline `12/14`, без нового PR0b failure;
- archived migration bodies — byte-identical исходным после исключения трёх
  provenance comments;
- Docker daemon в reviewer sandbox недоступен; exact-hash evidence раздела 21
  признано достаточной привязкой Docker-capable `4/4 + 13/13` к текущим bytes.

Blocking findings: отсутствуют. Verdict: `accept`.

Финальная фиксация технической роли от base/head
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался:

- tracked `git diff --stat`: `10 files changed, 949 insertions(+), 645
  deletions(-)`; команда не включает новые untracked migration/spec/card/archive
  files;
- полный отделимый PR0b file set: `packages/db/migrations/0017_ai_schema_reconciliation.sql`;
  три archived SQL и удаление их прежних executable paths;
  `packages/db/src/schema.ts`;
  `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
  `apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts`;
  `apps/api/src/scripts/run-m3-mastra-smoke-once.ts`;
  `apps/api/test/helpers/postgres-widget-ai-test-harness.ts`;
  `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
  `apps/api/test/ai-schema-migration-reconciliation.test.ts`;
  `docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md` и эта карточка;
- прямое влияние: canonical AI DDL/Drizzle contract, grounded and recorded
  persistence parity, migration/runtime integration evidence;
- косвенное влияние: будущий recorded reply обязан сохранять canonical
  public/internal linkage, но capability и caller этим срезом не включены;
- непроверено: external DB inventory, реальные row counts и lock duration,
  staging/production apply и deploy;
- rollback до external apply — удалить отделимый PR0b diff; после будущего
  apply — backup/restore либо новая forward corrective migration через отдельный
  release gate.

Следующий заранее утверждённый срез Goal: `PR 0c — bounded hotfixes`; он
начинается автоматически после этого `accept`, без commit/push/deploy.
