# Карточка среза AI Runtime Convergence: CONV-3A — журнал попыток AI-хода

Статус: `accept`; пятый fresh independent Reviewer принял стабильный
CONV-3A diff без findings. Срез готов к commit/push по протоколу Goal.

Goal: `AI-RUNTIME-CONVERGENCE`.

Позиция в roadmap: после принятого CONV-3 и до CONV-4.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`1fb13c6e6ca743b06495a9a1740b33b5c810dfc8` /
`1fb13c6e6ca743b06495a9a1740b33b5c810dfc8` на момент передачи.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier и reasoning
profile интерфейсом сессии не раскрыты.

Фактическая модель всех пяти независимых Reviewer: `gpt-5.6-sol`, reasoning
`high`, отдельные read-only `codex exec`; все четыре набора
`changes_requested` устранены, пятый Reviewer выдал `accept`.

## 1. Один результат

Один входящий response window имеет один логический `ai_run`, а каждая
физическая lease/model-попытка записывается отдельной строкой
`ai_run_attempts`. Только одна актуальная попытка может стать победителем и
атомарно завершить logical run, job и outbound; потерявшая lease попытка
терминально помечается `fenced` и не оставляет ложный бесконечный logical
`running`.

Почему это следующий срез Goal:

- CONV-3 уже принят и опубликован с минимальной migration `0021`, разрешающей
  несколько attempt-shaped `ai_runs` на один inbound;
- владелец выбрал более строгую долгосрочную модель вместо сохранения этого
  смешения logical turn и execution attempt;
- CONV-4/CONV-5 не должны закреплять документацию и guardrails поверх
  временной модели данных.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | tracked tree чист на передаче; `output/` — pre-existing user-owned untracked path |
| Base/head SHA | `HEAD == origin/main == 1fb13c6e6ca743b06495a9a1740b33b5c810dfc8` до этой карточки |
| Принятый runtime | CONV-3 commit `8122a8ef44568d6b97dccee54dee074c4a1c4733`; один direct runtime |
| Текущая migration | `0021_ai_run_attempts.sql` только заменяет unique inbound index обычным |
| Текущие обязательные тесты | accepted evidence CONV-3: PostgreSQL runtime+migrations `30/30`, applicable matrix `111 passed`, `1 skipped`, build passed |
| Известный риск модели | attempt-scoped idempotency живёт непосредственно в `ai_runs`; fenced attempt может оставлять attempt-shaped `running` row |

Fresh baseline Исполнителя 2026-08-05:

- после `git fetch origin main` подтверждено
  `HEAD == origin/main == 1fb13c6e6ca743b06495a9a1740b33b5c810dfc8`;
- сохранены pre-existing handoff-изменения этой Goal в карточке, Goal, task
  index и state; `output/` остаётся user-owned untracked path и не читается/
  не изменяется;
- production caller chain:
  `WidgetAiJobWorker -> PublicWidgetIntakeService ->
  RecordedPublicWidgetAiTurnExecutor -> RecordedLiveV2TurnService ->
  AiRunRepository/PostgresIntakeRepository`;
- retry identity сейчас создаётся в executor суффиксом `:attempt:N`, поэтому
  reclaimed lease создаёт второй `ai_runs`, а старая строка может остаться
  `running`;
- прямые read/FK consumers: `ai_run_spans`, `ai_quality_events` и
  `ai_review_labels` ссылаются на `ai_runs(id)`; manager quality и review reads
  читают статус/итог из `ai_runs`, поэтому logical `ai_run_id` должен остаться
  стабильным;
- migration `0021` убрала unique только с inbound-public-message index;
  unique `trace_id`, `idempotency_key`, outbound linkage и все message/FK
  constraints сохранены;
- real PostgreSQL lost-lease test прямо фиксирует временный дефект: после
  reclaim остаются старый `running ai_runs` и новый terminal `ai_runs`.

### Уточнённая migration/backfill/atomic ownership до рабочего кода

Утверждённая реализационная форма внутри выбранной owner-модели:

1. `ai_runs` получает versioned contract `logical_recorded_v2` и nullable
   `winning_attempt_id`; итоговые поля победителя остаются в `ai_runs` для
   manager/review/eval compatibility.
2. `ai_run_attempts` хранит `ai_run_id`, `attempt_number`, job/lease identity,
   attempt idempotency/trace/input fingerprint, configured/observed model,
   usage/cost, timing, outcome/failure и статус
   `running | succeeded | failed | fenced`.
3. Unique `(ai_run_id, attempt_number)`, attempt idempotency и trace; winning
   FK обязан указывать на attempt того же logical run. Partial unique winner
   не допускает две `succeeded` attempts одного run.
4. `ai_run_spans` и `ai_quality_events` получают nullable attempt FK. Старые
   review labels остаются logical-run scoped.
5. Migration сначала fail closed проверяет ambiguous duplicates среди
   `native_recorded` по canonical idempotency/response-window identity. Только
   однозначные строки backfill-ятся один-к-одному: создаётся child attempt,
   spans/quality получают provenance, attempt suffix снимается с logical
   idempotency, contract становится `logical_recorded_v2`; durable строки не
   объединяются и не удаляются.
6. Begin/replay сначала находит или создаёт один logical run, затем создаёт
   отдельную текущую attempt; новая attempt атомарно fence-ит более ранние
   `running` attempts. Terminal replay всегда возвращает logical result.
7. Reply commit одной PostgreSQL transaction проверяет conversation/send gate
   и актуальную job lease, сохраняет outbound, помечает attempt `succeeded`,
   связывает `winning_attempt_id`, копирует совместимый terminal summary в
   logical run и завершает job.
8. Lost lease/abort завершает только attempt как `fenced`. Retryable execution
   failure завершает attempt как `failed`, но оставляет logical run `running`;
   исчерпание max attempts терминально завершает logical run и job без ложного
   winner. Memory implementation обязана повторять эти переходы, но не заменяет
   real PostgreSQL evidence.

Источники истины по приоритету:

1. `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md` и эта owner-approved карточка;
2. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`
   (`ai-run-attempts.ts`, leases/retries и app-owned ownership);
3. ADR-012, owner spec, minimal Goal governance и AI refactor playbook;
4. current code/schema/migrations на фактическом base SHA.

Новая сессия обязана заново подтвердить SHA, dirty tree, callers, FK/read-side
consumers и baseline до рабочего кода. Исторические отчёты не заменяют эту
сверку.

## 3. Утверждённая модель владения

`ai_runs` для нового versioned recording contract владеет логическим ходом:

- canonical inbound/response-window identity;
- итоговым статусом и normalized action;
- winning attempt linkage;
- outbound linkage и итоговым send-gate решением;
- стабильным `ai_run_id` для review/eval/manager read models.

`ai_run_attempts` владеет каждой физической попыткой:

- `ai_run_id`, номер попытки, `job_id` и job attempt identity;
- attempt idempotency/trace/runtime identifiers;
- exact input fingerprint и configured/observed model evidence;
- timestamps, latency, usage/cost, outcome/failure;
- статусом как минимум `running | succeeded | failed | fenced`.

Инварианты:

- unique `(ai_run_id, attempt_number)` и attempt idempotency identity;
- не более одной `succeeded`/winning attempt на logical run;
- stale/fenced attempt не меняет outbound, logical winner или job новой lease;
- успешный commit атомарно связывает attempt, logical run, outbound и job;
- failure с доступным retry завершает attempt, но не выдаёт logical success;
- terminal replay возвращает logical result, а не случайную старую попытку;
- spans и quality evidence имеют однозначную logical и attempt provenance.

Исторические `native_recorded` строки и существующие FK не объединяются и не
удаляются вслепую. Новый contract/version и backfill должны сохранять read-side
compatibility. Если текущая БД содержит неоднозначные duplicate logical runs,
migration обязана fail closed или потребовать отдельный reconciliation plan,
а не выбирать победителя эвристикой.

## 4. Область

Разрешено:

- новая additive/versioned migration после `0021` и соответствующая Drizzle
  schema для attempt ledger и winning linkage;
- repository/port contracts для раздельного begin/replay logical run и attempt;
- PostgreSQL и memory implementations;
- recorded direct executor/service и атомарный site-widget commit;
- attempt-aware spans/quality linkage в минимальном объёме, необходимом для
  однозначной provenance;
- manager/review/eval read compatibility без изменения публичного HTTP
  контракта;
- migration reconciliation, real PostgreSQL retry/stale lease/takeover/replay,
  sanitizer, typecheck/build и architecture tests.

Высокорисковый initial allowlist:

```text
packages/db/migrations/0022_ai_run_attempt_ledger.sql
packages/db/src/schema.ts
apps/api/src/modules/ai/ports/recorded-ai-turn.ts
apps/api/src/modules/ai/observability/ai-observability-sanitizer.ts
apps/api/src/modules/ai/repositories/ai-run-repository.ts
apps/api/src/modules/ai/repositories/memory-ai-run-repository.ts
apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts
apps/api/src/modules/ai/repositories/recorded-site-widget-ai-reply-repository.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/src/modules/ai/services/recorded-public-widget-ai-turn-executor.ts
apps/api/src/modules/intake/ports/public-widget-ai-turn-executor.ts
apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts
apps/api/src/modules/conversations/repositories/conversation-message-repository.ts
apps/api/src/modules/conversations/repositories/public-intake-repository.ts
apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts
apps/api/test/helpers/memory-intake-repository.ts
apps/api/test/helpers/postgres-widget-ai-test-harness.ts
apps/api/test/ai-schema-migration-reconciliation.test.ts
apps/api/test/ai-observability-sanitizer.test.ts
apps/api/test/m2-ai-run-runtime-evidence.test.ts
apps/api/test/p2-memory-ai-run-repository.test.ts
apps/api/test/p3-observability-sanitizer.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
```

Дополнительные внутренние contract/caller-файлы и узкие sanitizer/repository
тесты добавлены после fresh caller и false-green audit. Они передают обязательный
job `maxAttempts`, разделяют logical/attempt identity и проверяют тот же контракт
в memory/PostgreSQL adapters, не меняя публичный HTTP contract. Worker policy,
prompt, model, send gate и takeover semantics не меняются. Новые application
записи остаются `direct_openai/live_v2`; migration сохраняет историческую
runtime/profile пару при однозначном one-to-one backfill, не переписывая
историческую evidence.

Дополнительный файл допускается только после caller evidence и объяснения в
этой карточке; расширение на public contract, prompt/model/policy или CONV-4
docs запрещено.

Явно вне области:

- deploy или применение migration во внешней/staging/production БД;
- secrets, runtime activation и платные provider calls;
- prompt, model, reasoning, tools, privacy, business/send-gate/takeover policy;
- публичный HTTP contract;
- cleanup активной документации CONV-4 и guardrails CONV-5;
- удаление исторических runtime enum/rows/FK ради косметической чистоты.

Ориентир размера: один schema/concurrency slice. Существенное расширение
allowlist — stop для повторной проверки scope, а не автоматическое продолжение.

## 5. Критерии успеха

- [x] Один logical run переживает reclaimed lease, а attempts `1..N` имеют
  отдельные terminal records.
- [x] Stale/takeover/newer-inbound races дают ноль stale/duplicate outbound и
  не позволяют старой attempt завершить logical run.
- [x] Не более одной winning attempt; её body/hash/outbound/run/job linkage
  фиксируются одной PostgreSQL transaction.
- [x] Retryable failure не оставляет необъяснимый бесконечный logical
  `running`; terminal/max-attempt semantics проверены явно.
- [x] Terminal/running replay и idempotency корректны одновременно на уровне
  logical run и attempt.
- [x] Старые `ai_runs`, review/eval FK и manager quality reads остаются
  читаемыми; migration не делает эвристическое destructive merge.
- [x] Fresh migration chain и upgrade-path reconciliation проходят.
- [x] Real PostgreSQL queue/lease/takeover/send-gate tests, применимые unit и
  integration tests, typecheck, build, architecture checks и
  `git diff --check` проходят.
- [x] Свежий независимый Reviewer выполняет Code Scout и выдаёт `accept`.

## 6. Стоп-гейты

Уже явно одобрено владельцем 2026-08-05:

- вставить CONV-3A перед CONV-4;
- создать versioned `ai_run_attempts` child ledger;
- сделать `ai_runs` logical-run owner для нового contract;
- выполнить необходимые repo-local migration/schema/repository/test changes;
- после independent `accept` сделать понятный русский commit и обычный push.

Не одобрено и требует новой остановки:

- lossy merge/delete существующих durable rows;
- изменение публичного contract или AI/send/takeover/privacy policy;
- deploy/внешняя migration, secrets, runtime config или платный вызов;
- изменение другого репозитория;
- перенос CONV-4/CONV-5 работы в этот diff.

## 7. Риски, evidence и rollback

Главные риски: circular winner FK, расхождение job attempt и AI attempt,
terminal replay старой попытки, orphan logical runs, ложнозелёный memory test,
сломанные review/eval/manager reads и необратимый backfill.

Обязательный Code Scout: callers, failure paths, concurrent lease reclaim,
newer inbound, takeover, migration upgrade/fresh chain, privacy/sanitization,
send gate, review/eval FK и false-green tests.

Непроверено до реализации: фактическая форма migration, backfill на duplicate
данных, полный file list и стабильный test fingerprint.

Rollback до принятого commit — удалить только CONV-3A diff. После публикации —
отдельный `git revert`; если migration когда-либо применена внешне, rollback
требует отдельного forward-safe плана и не разрешён этой Goal автоматически.

## 8. Technical done Исполнителя

Второй свежий Reviewer (`019fd498-d842-7aa1-b6af-6464975b1f75`,
`gpt-5.6-sol`, reasoning `high`, read-only) подтвердил три предыдущих repair,
но выдал `changes_requested` для fingerprint `3244ad04…` по двум новым
terminal-ordering окнам:

1. terminal `superseded` job после newer inbound/takeover могла сохранить
   fenced/failed attempt и logical run в `running` без будущей retry;
2. последняя lease могла истечь до `beginOrReplay`: sweep завершал job без
   attempt, после чего поздний worker создавал новый running run/attempt.

Текущий repair ограничен этими findings: PostgreSQL begin обязан участвовать в
job lock/fence до создания ledger, а каждый путь терминального `superseded`
обязан в той же transaction закрыть связанную attempt/logical run. Обязательное
новое evidence: final-lease-before-begin, newer-inbound/takeover и retrying-job
supersede без orphan logical `running`. Публикация и CONV-4 остаются запрещены
до нового `technical_done` и свежего `accept`.

Итогово зафиксировано 2026-08-06 после четвёртого repair на неизменившейся
опубликованной базе:

- base SHA = head SHA = `1fb13c6e6ca743b06495a9a1740b33b5c810dfc8`;
- после повторного `git fetch origin main` подтверждено
  `HEAD == origin/main`; рабочий результат ещё не закоммичен;
- fingerprint code/migration diff без self-referential task/state docs:
  `a2f0bc2a2420aad7b5813c1aa9e313adc82960952f5d91e8a0473977cd82304c`;
- tracked `git diff --shortstat` до итоговой evidence-doc правки:
  26 files, 3973 insertions, 1148 deletions;
  отдельно untracked migration — 438 строк, эта task card — отдельный
  owner-approved handoff/task artifact; `output/` не читался и не менялся.

Полный список затронутых файлов среза:

```text
.agents/state/granit-dev-workflow.json
packages/db/migrations/0022_ai_run_attempt_ledger.sql
packages/db/src/schema.ts
apps/api/src/modules/ai/observability/ai-observability-sanitizer.ts
apps/api/src/modules/ai/ports/recorded-ai-turn.ts
apps/api/src/modules/ai/repositories/ai-run-repository.ts
apps/api/src/modules/ai/repositories/memory-ai-run-repository.ts
apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts
apps/api/src/modules/ai/repositories/recorded-site-widget-ai-reply-repository.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/src/modules/ai/services/recorded-public-widget-ai-turn-executor.ts
apps/api/src/modules/conversations/repositories/conversation-message-repository.ts
apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts
apps/api/src/modules/conversations/repositories/public-intake-repository.ts
apps/api/src/modules/intake/ports/public-widget-ai-turn-executor.ts
apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts
apps/api/test/ai-observability-sanitizer.test.ts
apps/api/test/ai-schema-migration-reconciliation.test.ts
apps/api/test/helpers/memory-intake-repository.ts
apps/api/test/helpers/postgres-widget-ai-test-harness.ts
apps/api/test/m2-ai-run-runtime-evidence.test.ts
apps/api/test/p2-memory-ai-run-repository.test.ts
apps/api/test/p3-observability-sanitizer.test.ts
apps/api/test/public-intake.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_3A_ATTEMPT_LEDGER_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md
docs/tasks/README.md
```

Прямое влияние: versioned logical/attempt schema, begin/replay, attempt
failure/fence, atomic reply/no-reply completion и queue max-attempt identity.
Косвенное влияние: manager/review/eval продолжают читать stable logical
`ai_run_id`; spans/quality получают attempt provenance; public HTTP, prompt,
model, tools, privacy, send-gate и takeover policy не изменены.

Первый свежий независимый Reviewer (`019fd47d-eb13-7232-a3c8-4c3a3e3244bc`)
выдал `changes_requested` для прежнего fingerprint и нашёл три дефекта:

1. production caller создавал новый `traceId`, а replay running attempt требовал
   совпадения trace, поэтому настоящий same-attempt retry конфликтовал;
2. abort сразу после begin и исчерпание последней lease могли оставить attempt
   и logical run в `running` при уже failed job;
3. независимые FK spans/quality допускали пару logical run A + attempt B, а
   cascade delete мог уничтожить attempt evidence.

Repair остаётся внутри CONV-3A: trace исключён из replay identity при сохранении
stored trace; post-begin abort явно fence-ит attempt; final failed/expired job
атомарно терминализирует attempt и logical run; provenance защищена составными
FK `(ai_run_attempt_id, ai_run_id)` с `ON DELETE RESTRICT`. Для всех трёх
случаев добавлено реальное PostgreSQL evidence, включая false-green test с новым
trace и negative FK/delete assertions.

Второй repair устранил два terminal-ordering дефекта:

- `beginOrReplay` до создания logical run/attempt блокирует связанный
  job и fail closed проверяет его lease, attempt/max-attempt и runtime identity;
  поздний worker после терминального sweep больше не может создать
  running ledger;
- takeover, newer inbound, retrying-job replacement, stale invalidated sweep и
  terminal `finishSiteWidgetAiJob(...superseded)` в той же transaction
  закрывают связанные running attempt как `fenced` и logical run как
  `failed` без winner; уже terminal failed/fenced attempt сохраняется.

Третий свежий независимый Reviewer
(`019fd4b0-efe2-7fa1-a11d-c4ec94dc0433`, `gpt-5.6-sol`, reasoning `high`,
read-only) подтвердил пять предыдущих исправлений, но выдал
`changes_requested` для fingerprint `1528f6bc…`:

1. pre-begin retry могла увеличить `widget_ai_jobs.attempt_count`, не создав
   ledger row; последующая production-reachable попытка с разрывом нумерации
   отклонялась, а последний pre-begin failure искал только отсутствующую
   текущую attempt и мог оставить logical run в `running`;
2. test-only memory intake helper не валидировал job/lease при begin и не
   терминализировал logical run на terminal `failed`/`superseded`, создавая
   false-green parity evidence.

Третий repair сохраняет job attempt identity и допускает монотонные разрывы в
ledger (`1 -> 3`), но отвергает stale/повторную несовместимую нумерацию.
Terminal finalizer сначала ищет точную текущую attempt, а при её отсутствии —
последнюю attempt того же job под тем же lock-order и закрывает только связанный
logical run. Memory helper теперь проверяет processing job, attempt budget,
runtime identity и живую lease, а terminal failed/superseded/newer-inbound пути
повторяют production terminalization. Оба сценария покрыты PostgreSQL и memory
тестами, включая запрет late begin после terminal job.

Четвёртый свежий независимый Reviewer
(`019fd4cf-7f30-70e2-91f3-b6e512854e9f`, `gpt-5.6-sol`, reasoning `high`,
read-only) подтвердил предыдущие race/FK/privacy repairs, но выдал
`changes_requested` для fingerprint `59a75faf…`:

1. `completeWithoutReply` всегда делал attempt `succeeded` и назначал winner,
   поэтому logical `failed` нарушал DB constraint и откатывал production
   `persistenceUnconfirmed`/`gate_unavailable` completion;
2. same-number replay не сравнивал immutable attempt versions/model evidence;
3. memory intake helper не требовал `attemptNumber == jobAttemptCount` и
   корректный suffix, а failure-path доверял caller-provided `maxAttempts`.

Четвёртый repair разделяет committed controlled outcome и `failed` terminal:
физическая attempt и logical run получают `failed`, winner остаётся `NULL`, а
evidence сохраняется атомарно. Same-attempt replay теперь сравнивает все
version/model/reasoning поля ledger, продолжая игнорировать только новый trace.
Memory helper валидирует numbering/suffix и сверяет failure max budget с
фактическим job перед terminalization; forged identity fence-ится без ложного
завершения job/run.

Актуальное evidence Исполнителя после четырёх repair:

- migration fresh/upgrade/ambiguous rollback и provenance: 8/8 passed;
- real PostgreSQL runtime, lease/reclaim/takeover/replay/max budget: 32/32
  passed;
- focused changed memory/sanitizer/evidence matrix: 23/23 passed;
- public-intake memory parity: 32/32 passed;
- `npm run typecheck:api`: passed;
- `npm run build`: bounded API typecheck, manager typecheck и Vite build passed;
- `git diff --check`: passed;
- repository-wide `npm test`: 365 passed, 2 skipped, 3 failed. Все три failure
  уже присутствуют в base SHA и лежат вне CONV-3A: два в
  `ai-turn-context.test.ts` (base source уже не содержит ожидаемый
  `nextConversationMessageTimestamp`, а base fixture уже включает internal ID
  в turn idempotency/public message) и один в `live-v2-context.test.ts`
  (base test/source неизменны и fixture даёт undefined current inbound).
  Эти три файла и live-v2 context source не изменялись срезом; соседний repair
  записывается кандидатом следующей работы и не смешивается с CONV-3A.

Непроверено и не разрешено этим срезом: применение migration во внешней БД,
deploy/runtime activation, реальные provider calls и поведение на неизвестных
production duplicate данных за пределами fail-closed preflight. Безопасный
отказ до публикации — удалить только отделимый CONV-3A diff; после публикации —
обычный `git revert` и отдельный forward-safe DB plan, если migration была
применена внешне.

Пятый свежий независимый Reviewer
(`019fd4e7-f628-7821-8a43-0ae1dbee6a92`, `gpt-5.6-sol`, reasoning `high`,
read-only) выполнил полный Code Scout стабильного CONV-3A diff и выдал
`accept` без blocker/high/medium/low findings. Он повторно подтвердил failed
terminal без winner, controlled non-failed winner, same-attempt immutable
replay, job numbering/max identity, lock order, takeover/newer-inbound/final
lease paths, composite FK provenance, privacy boundaries и чувствительность
negative tests. `git diff --check` прошёл; тесты/typecheck в read-only сессии
не стартовали из-за `ENOENT`/`EROFS` во временном каталоге, поэтому Reviewer
не засчитал их как independently reproduced и сверил evidence Исполнителя
статически. `output/` не читался и не изменялся.

Итоговый независимый вердикт: `accept`. Следующий шаг — публикация CONV-3A
обычным fast-forward commit/push после повторной сверки `origin/main`, затем
автоматический переход к CONV-4.

## 9. Передача в новую сессию

Новая сессия начинает только CONV-3A и сначала работает как Архитектор/Исполнитель:

1. прочитать обязательные repo/AI документы из `AGENTS.md`;
2. сверить `HEAD == origin/main`, dirty tree и эту карточку;
3. выполнить fresh caller/FK/query audit, особенно review/eval/manager reads;
4. уточнить schema/backfill/atomic transition внутри утверждённой модели;
5. обновить карточку до `implementing` до рабочего кода;
6. реализовать один срез и остановиться на `technical_done`;
7. свежая отдельная сессия Reviewer проверяет стабильный fingerprint;
8. только после `accept` — русский commit и push по протоколу Goal;
9. затем автоматически перейти к CONV-4.

```text
Goal: AI-RUNTIME-CONVERGENCE
Текущий срез: CONV-3A logical run + attempt ledger
Статус: accept; пятый fresh independent Reviewer не нашёл findings
Base/head SHA: 1fb13c6e6ca743b06495a9a1740b33b5c810dfc8
Результат: один logical ai_run, отдельные fenced/retried/winning ai_run_attempts
Изменённые области: schema/migration, repository/runtime, queue finalization, tests, Goal/card/state/index
Evidence: PostgreSQL runtime 32/32, migration 8/8, focused 23/23, public-intake 32/32, typecheck/build passed; full 365 passed, 2 skipped, 3 baseline failed
Непроверено: external DB/deploy/provider calls и реальные production duplicates
Rollback: до публикации удалить отделимый diff; после публикации — отдельный revert
Verdict: accept независимого Reviewer; готово к commit/push
Следующий срез после accept: CONV-4
```
