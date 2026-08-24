# Карточка среза AI-LAYER-SIMPLIFICATION: AILR-02 — честная validator policy

Статус: `accept`; identity-based current-window repair и исправление двух low-
неточностей передачи приняты восьмым свежим независимым Reviewer. Старый
reply/job учитывается в POST
только если связан с latest visitor id/sequence; current generation определяет
исполнимость active job. Нового owner stop-gate нет.

Goal: `AI-LAYER-SIMPLIFICATION`.

Позиция в roadmap: третий срез после принятых AILR-00 и AILR-01; до catalog
authority/retrieval AILR-03.

Ветка / base SHA / head SHA:
`agent/ai-layer-refactor` /
`4c91d162e13251883125ab5b1b32565172f570c6` /
тот же SHA до непубликованного diff Goal.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier интерфейсом
сессии не раскрыт.

Все восемь независимых Reviewer запущены как `gpt-5.6-sol`, reasoning effort
`high`.

## 1. Один результат

Live model-turn validator больше не блокирует полезный ответ по lexical/regex
догадке о тоне, повторе, числе вопросительных знаков или содержании свободного
русского текста. Он даёт один из трёх честных исходов:

1. terminal reject только для непригодной структуры, отсутствия текста после
   безопасного repair или конфликта `handoff + question`;
2. deterministic component repair без второго model call;
3. validated plan с nonterminal diagnostic для выполненного repair.

Почему это следующий срез: AILR-01 сделал terminal reason наблюдаемым, но не
доказал полезность самих gates. Owner 2026-08-24 отдельно утвердил уменьшение
hard allowlist и поручил убрать «тугие деревянные» regex из этого validator
контура.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | Принятые непубликованные AILR-00/01 и пользовательский untracked `output/`; они сохраняются |
| Base/head SHA | `4c91d162e13251883125ab5b1b32565172f570c6` |
| Accepted predecessor | AILR-01, Reviewer `accept`, session `01a0345d-bf7f-7963-ba74-147c8869b527` |
| Current production caller | `executeModelTurn()` вызывает только `validateModelTurnOutput()` |
| Baseline focused tests | validator/compatibility/M2: 3 files, 68/68 passed |
| Незавершённые пользовательские изменения | `output/`; не читать и не менять |

Источники истины по приоритету:

1. current code/tests и ADR-010/012 на base SHA;
2. active Goal, принятые AILR-00/01 и owner policy approval в текущей Goal;
3. owner architecture: model text не переписывается смысловым renderer, style
   оценивается offline, semantic regex не считается пониманием;
4. `developing-ai-agents`: objective constraints отдельно от subjective eval,
   recoverable component failure исправляется до terminal reject.

## 3. Область

Разрешено:

- сузить current model-turn terminal type до закрытого hard allowlist;
- сделать exact duplicate/known-slot/length repair до canonical hash;
- записывать выполненный repair в существующий `validationResults`;
- убрать unsafe/tone/repetition lexical gates из production model-turn path;
- удалить те же semantic regex predicates из не-production compatibility
  validator, чтобы offline path не сохранял противоречащую policy;
- сохранить восемь AILR-01 codes для чтения historical terminal evidence;
- TDD на positive и false-positive cases, orchestrator no-reply, stale/takeover
  и отсутствие public/raw leak;
- привести `docs/AI_POLICY.md` к фактическому single-call runtime и честно
  зафиксировать временную границу factual verification до AILR-03/04.

Точный current hard allowlist:

```text
invalid_shape     — output не проходит строгую schema
invalid_answer    — после разрешённого component repair не осталось текста
invalid_question  — handoffIntent одновременно содержит вопрос
```

Deterministic repair:

```text
duplicate_question    — exact suffix удаляется, один вопрос остаётся
known_slot_requested  — отдельный повторный вопрос удаляется, answer сохраняется
combined text > 900   — optional question удаляется, answer сохраняется
```

`unsafe_claim`, `tone_violation` и `repeated_reply` остаются допустимыми
historical observability values, но lexical detector больше не создаёт их в
live send path. Tone/repetition проверяются offline rubric/manual review.
Factual safety не объявляется решённой regex-заменителем: structured published
candidate/evidence validation входит в AILR-03/04 и обязательна до любого
deploy этой Goal.

Явно вне области:

- prompt, модель, второй model/verifier call, tool loop или новый runtime;
- schema/migration, новый public/history/manager DTO и browser/catalog code;
- catalog snapshot/retrieval/ID validation — AILR-03/04;
- send gate, stale fence, retry, manager takeover/handoff ownership;
- live/paid eval, secrets/runtime config, commit/push/deploy;
- пользовательский `output/` и другие репозитории.

Точный allowlist рабочего кода, тестов и policy routing:

```text
apps/api/src/modules/ai/profiles/live-v2/model-turn-contract.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-validator.ts
apps/api/src/modules/ai/profiles/live-v2/live-v2-validator.ts
apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts
apps/api/test/model-turn-validator.test.ts
apps/api/test/live-v2-validator.test.ts
apps/api/test/live-v2-synthetic-fixtures.test.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
docs/AI_POLICY.md
docs/source-of-truth.md
docs/tasks/README.md
docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md
docs/tasks/AI_REF_AILR_02_VALIDATOR_POLICY_RU.md
.agents/state/granit-dev-workflow.json
tooling/ai-architecture-contract.json
tooling/ai-architecture-guardrails.mjs
tooling/ai-architecture-guardrails.test.mjs
```

Если для корректности понадобится prompt/model/public/schema/send-gate change,
срез останавливается на новом stop-gate. Ориентир рабочего production/test diff:
до 260 добавленных/изменённых строк; существенное расширение объясняет Reviewer.

## 4. Критерии успеха

- [x] Только три current hard codes могут вернуть `ok:false`; каждый доказан
  отдельным positive и negative test.
- [x] Exact duplicate question и known-slot question ремонтируются без второго
  вызова модели; safe answer сохраняется и repair виден в `validationResults`.
- [x] Фразы с ценой, сроком, размером, шаблонным сочувствием и повтором больше
  не блокируются lexical/regex решением; это проверено false-positive tests.
- [x] В production source отсутствуют прежние semantic claim/tone regex
  predicates и их terminal callers.
- [x] Invalid shape и handoff/question conflict по-прежнему не создают outbound;
  validator failure не создаёт manager takeover.
- [x] Historical AILR-01 terminal metadata остаётся parseable/sanitized; public
  history не получает code, candidate или raw text.
- [x] Focused/integration/PostgreSQL tests, bounded typecheck/build,
  architecture guard и `git diff --check` проходят.

## 5. Стоп-гейты

- [x] AI-policy change одобрена владельцем в текущем диалоге: применить
  предложенное разделение hard/repair/quality и убрать semantic regex.
- [x] Architecture/runtime ownership не меняется: один direct model turn,
  app-owned validator/commit/send gate.
- [x] Migration/schema и public contract не меняются.
- [x] Prompt/tool/model/privacy/send gate/takeover не меняются.
- [x] Deploy/secrets/runtime config/paid call/другой repo не выполняются.

## 6. Выполнение

TDD зафиксировал прежнюю policy до изменения: после добавления новых ожиданий
focused-прогон дал 50 ожидаемых падений и 40 проходов. Падения приходились на
старые terminal `unsafe/tone/repeated/known-slot` решения и отсутствие repair
diagnostics, а не на инфраструктуру теста.

Реализовано:

- `ModelTurnValidationResult.ok:false` типизирован отдельным закрытым списком
  `invalid_shape | invalid_answer | invalid_question`;
- exact question suffix, вопрос к уже известному/только что подтверждённому
  slot и optional question при превышении 900 символов чинятся до canonical
  hash; применимые state patches не теряются;
- production validator больше не вызывает claim/tone/repetition classifiers и
  не считает количество `?` доказательством semantic invalidity;
- из compatibility validator удалены те же 114 строк semantic regex/repetition
  predicates; механическая нормализация идентификаторов/сравнений сохранена;
- два terminal случая (`invalid_shape`, `handoff + question`) интеграционно
  доказаны без outbound и без утечки exact code/raw candidate в history;
- `docs/AI_POLICY.md` приведён к фактическому single-call runtime и прямо
  запрещает считать этот срез готовым к deploy до structured published evidence
  в AILR-03/04.

После первого независимого review дополнительно реализован bounded privacy
repair:

- `history.v2` больше не передаёт repository/job reason напрямую: use-case
  строит status-aware public allowlist, внутренний `candidate_invalid`
  проецируется в существующий `unsafe_model_response`, неизвестное значение
  fail-closed превращается в generic public reason либо удаляется;
- точный `candidate_invalid` остаётся во внутреннем `widget_ai_jobs`, а exact
  `invalid_shape` / `invalid_question` — в metadata соответствующего `ai_run`;
- real PostgreSQL end-to-end test проходит production assembly, worker,
  transactional persistence и public history для обоих terminal случаев;
  outbound, handoff и takeover не создаются, conversation остаётся AI-active;
- публичный TypeScript result теперь также ограничивает `automation.reason`
  конечным public union, не меняя runtime DTO или набор уже существующих
  публичных значений.

После второго независимого review исправлена та же граница в idempotent replay:

- terminal validator job при повторном POST больше не означает автоматически
  manager takeover: его internal reason проходит тот же status-aware public
  projection, что и `history.v2`;
- `candidate_invalid` для AI-active conversation возвращает существующее
  `degraded/ai_active/unsafe_model_response`, а manager-owned blocked state
  остаётся `manager_pending`;
- оба PostgreSQL reject-кейса повторяют исходный POST и проверяют одинаковые
  public IDs, AI-active state и отсутствие internal reason/code/raw candidate.

После третьего независимого review закрыт общий false-manager fallback для
неизвестного internal blocked reason:

- AI-active `blocked/execution_context_mismatch` теперь проецируется в уже
  существующее `worker_failed`, а не в `agent_reply_blocked`;
- только фактический `needs_manager/manager_active` ownership разрешает replay
  вернуть `manager_pending`; terminal reason больше не подменяет ownership;
- сообщение AI-active degraded replay больше не обещает manager review, который
  не был создан;
- real PostgreSQL test сначала фиксирует AI-active history/replay, затем
  выполняет настоящий manager takeover и доказывает смену только публичного
  ownership state при тех же IDs, без outbound, handoff и raw internal reason.

После двух обязательных Architect redesign устранён сам класс
повторявшегося дефекта, а не добавлена ещё одна status-ветка:

- current-action projector для POST replay и intrinsic-evidence projector для
  `history.v2` живут в одном pure module и используют одну finite
  reason policy; history-функция контрактно принимает только job, поэтому
  не может подменить его evidence текущим ownership/runtime;
- replay одним PostgreSQL statement получает актуальные `aiState`, effective
  agent gate, runtime control, job исходного inbound и latest job разговора;
  старый `superseded` inbound поэтому показывает текущее AI response window;
- history одним PostgreSQL statement получает ownership, runtime gate,
  последние сообщения и связанные jobs, поэтому polling и публичные reasons
  строятся из согласованного снимка;
- manager takeover доминирует над будущими actions и polling, но history
  сохраняет intrinsic `pending/processing/retrying/degraded/failed/blocked/
  replied/superseded` evidence; обычный `replied` и `superseded` не получают
  reason, а `replied/handoff` сохраняет `handoff`;
- runtime stop прекращает polling и даёт честный POST replay
  `degraded/worker_failed`, но не мутирует historical job status/reason;
- real PostgreSQL matrix покрывает все шесть прежних takeover statuses,
  normal replied, replied/handoff и superseded до/после takeover,
  runtime-disabled replay, стабильные public IDs/counts, history >100,
  отсутствие новых outbound/handoff и утечки raw internal reason.

Точный AILR-02 file set:

```text
.agents/state/granit-dev-workflow.json
apps/api/src/modules/ai/profiles/live-v2/live-v2-validator.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-contract.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-validator.ts
apps/api/src/modules/conversations/repositories/conversation-message-repository.ts
apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts
apps/api/src/modules/conversations/repositories/public-intake-repository.ts
apps/api/src/modules/intake/use-cases/public-widget-ai-projection.ts
apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts
apps/api/test/helpers/memory-intake-repository.ts
apps/api/test/live-v2-synthetic-fixtures.test.ts
apps/api/test/live-v2-validator.test.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/manager-ai-control.test.ts
apps/api/test/model-turn-validator.test.ts
apps/api/test/public-intake.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
docs/AI_POLICY.md
docs/source-of-truth.md
docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md
docs/tasks/AI_REF_AILR_02_VALIDATOR_POLICY_RU.md
docs/tasks/README.md
tooling/ai-architecture-contract.json
tooling/ai-architecture-guardrails.mjs
tooling/ai-architecture-guardrails.test.mjs
```

Последний test-fixture файл добавлен в scope после того, как production guard
правильно потребовал новый active authority `docs/AI_POLICY.md`, а filesystem
fixture его не материализовал. Сначала воспроизведён `ENOENT`, затем fixture
синхронизирован; production evaluator не ослаблялся.

Два файла privacy repair добавлены в scope по подтверждённой находке Reviewer:
public history use-case и его real PostgreSQL evidence test. Это расширяет
первоначальный ориентир diff, но не вводит migration, новый public DTO, prompt,
model/tool policy, send gate или takeover semantics.

Соседние находки не выполнялись: durable repair diagnostics, structured catalog
facts/recommendations и browser navigation относятся к AILR-03—05; три
унаследованных context-test failure и Vitest/`node:test` discovery mismatch —
отдельные кандидаты, не связанные с validator policy.

## 7. Evidence

Baseline:

```text
npx vitest run \
  apps/api/test/model-turn-validator.test.ts \
  apps/api/test/live-v2-validator.test.ts \
  apps/api/test/m2-live-v2-runtime-integration.test.ts \
  --maxWorkers=1
```

Результат до изменений: 3 files, 68/68 passed.

Проверки окончательного payload:

- red phase новой policy: 50 failed, 40 passed до реализации;
- focused validator/compatibility/M2: 4 files, 91/91 passed;
- после review related history/manager suite: 8 files, 129 passed, 1 skipped;
- red PostgreSQL privacy test до repair: 2/2 failed именно на публичном
  `candidate_invalid`; после projection те же 2/2 passed;
- red PostgreSQL replay test после второго review: 2/2 failed ровно на ложном
  `manager_pending/agent_reply_blocked`; после status-aware projection те же
  2/2 passed как `degraded/ai_active/unsafe_model_response`;
- red PostgreSQL unknown-blocked test после третьего review упал ровно на
  `history.v2 reason=agent_reply_blocked`; после ownership-aware projection он
  прошёл как `degraded/ai_active/worker_failed`, а последующий настоящий
  takeover — как `manager_pending`;
- Architect-red phase: семь takeover/superseded cases упали на прежнем mapper;
  после исправления fixture восьмой runtime-disabled case также упал ровно на
  ложном `processing/ai_active` вместо `degraded/worker_failed`;
- second-Architect red phase: 8 tests failed и 36 passed; все восемь падений
  точно воспроизвели ретроспективный `agent_reply_blocked` для шести
  status cases, normal replied и superseded;
- real PostgreSQL runtime invariants: 44/44 passed, включая обе архитектурные
  матрицы, normal replied, atomic replied/handoff, runtime stop,
  оба validator reject, takeover, newer inbound, lost lease, stale attempt и
  transactional rollback;
- связанный non-PostgreSQL набор: 7 files, 132/132 passed;
- `npm run build`: architecture guard 21/21, 142 production sources, 20
  compatibility exports, bounded API/manager typecheck и Vite build passed;
- `git diff --check`: passed;
- production search: удалённые claim/tone predicates и callers отсутствуют;
  `unsafe_claim`, `tone_violation`, `repeated_reply` остались только в
  historical finite observability enum.

Unfiltered `npm test -- --maxWorkers=1` честно остаётся красным на том же
baseline: 37 files passed, 383 tests passed, 2 skipped; два stale assertion в
`ai-turn-context.test.ts`, один invalid fixture в `live-v2-context.test.ts` и
попытка Vitest собрать отдельный `node:test` guard-file. AILR-02 не меняет эти
два production context source и три test oracle; отдельный правильный
`node --test` guard прошёл 21/21.

Base/head: `4c91d162e13251883125ab5b1b32565172f570c6`; commit не создавался. Общий
dirty worktree содержит принятые непубликованные AILR-00/01 и AILR-02:
`git diff --stat` перед финальной self-recording card/state update — 36 tracked
files, 1625 insertions, 559 deletions, плюс
untracked Goal/cards/enum и пользовательский `output/`. Поэтому Reviewer
получает exact fingerprint всего связанного predecessor payload, а отдельность
AILR-02 задаётся приведённым выше file set и карточкой, не фиктивной статистикой
от общего base.

Прямое влияние: решение model-turn validator, canonical text/hash, component
diagnostics, ownership-first projection внутреннего job evidence на public
history/idempotent POST replay и согласованность PostgreSQL read snapshots.
Косвенное: atomic persist/send получает больше валидных ответов, которые раньше
молча блокировались. Queue, stale fence, retry, manager takeover, public DTO,
schema/migrations, prompt/model/tool и runtime assembly не изменены.

Непроверенные области: paid provider, реальные customer traces, browser UX,
production data, factual truth свободного prose и deploy. Зелёные тесты не
заменяют ручную проверку владельца и не разрешают deploy. До AILR-03/04 текущая
Goal намеренно недеплойна: regex удалён, а structured factual evidence ещё не
подключён.

Rollback: откатить весь отдельный AILR-02 diff поверх принятого AILR-01.
Schema/data rollback не нужен.

## 8. Независимая проверка

Первый свежий read-only Reviewer:

- session `01a034ba-fd73-71a2-8cc8-edcf282f0d71`;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- воспроизведён fingerprint
  `80732ce00c992658e14f98629e34cd641fcfcd639426248e96294b00f40f53d1`
  на 33 записях;
- verdict `changes_requested`: critical 0, high 0, medium 1, low 0.

Находка: production PostgreSQL сохраняет внутренний `candidate_invalid` в
`widget_ai_jobs.terminal_reason`, а `history.v2` передаёт его клиенту без
public projection. Memory helper заранее заменяет это значение на
`unsafe_model_response`, поэтому M2 memory-тест был false green. Exact
validator code, raw candidate и PII не раскрывались, но app-owned terminal
reason пересекал public boundary.

Согласованный минимальный repair внутри прежнего результата: сохранить точный
внутренний job/run evidence, проецировать reason на существующий публичный
allowlist при сборке history и добавить real PostgreSQL end-to-end assertions
для `invalid_shape` и `handoff + question`. Новый DTO, migration или manager
takeover для этого не нужны. После repair требуется новый frozen fingerprint и
свежий независимый Reviewer; первый Reviewer собственную находку не принимает.

Repair evidence: red 2/2 PostgreSQL cases воспроизвели exact leak, green 2/2
подтвердили projection; полный PostgreSQL suite 34/34, related suite 129 passed
и 1 skipped, build/typecheck/architecture 21/21 и `git diff --check` прошли.
Точный internal reason/code сохранился, public history содержит только
`unsafe_model_response`, conversation остаётся AI-active без outbound/handoff.

Второй свежий read-only Reviewer:

- session `01a034d3-fec8-7660-8b88-b0402bca772a`;
- model `gpt-5.6-sol`, reasoning effort `high`;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- воспроизведён fingerprint
  `0b53bac2ab3036e3ab9132b88df4a90b228902a9346867ce506a302cef760929`
  на 34 записях;
- verdict `changes_requested`: critical 0, high 0, medium 1, low 0.

Находка: после terminal `candidate_invalid` повторный public POST с тем же
idempotency key правильно восстанавливает PostgreSQL job и AI-active
conversation, но общий `job.status=blocked` проецируется в
`manager_pending/agent_reply_blocked`. Клиенту ложно сообщается, что диалог
увидит менеджер, хотя handoff/takeover не создан, а `history.v2` уже показывает
`ai_active/unsafe_model_response`. Первые PostgreSQL assertions проверяли
только initial accept и history, поэтому replay-path оставался false green.

Согласованный минимальный repair: status-aware projection blocked replay в уже
существующее публичное `degraded/ai_active/unsafe_model_response` для
validator/no-safe-answer причин и параметризованные PostgreSQL replay
assertions для `invalid_shape` и `invalid_question`. Manager-owned blocked
reason по-прежнему остаётся `manager_pending`; новый DTO, migration, send gate
или takeover не нужны. После repair требуется новый fingerprint и третий
свежий Reviewer.

Second repair evidence: red 2/2 точно воспроизвёл ложный manager state, green
2/2 подтвердил согласованный public replay; полный PostgreSQL suite 34/34,
related suite 129 passed и 1 skipped, build/typecheck/architecture 21/21 и
`git diff --check` прошли. Unfiltered suite сохранил только прежние три context
failure и Vitest/`node:test` discovery mismatch: 37 files passed, 373 tests
passed, 2 skipped.

Третий свежий read-only Reviewer:

- session `01a034e8-4c63-7411-94ef-adaa6a81a1ca`;
- launch model `gpt-5.6-sol`, reasoning effort `high`; reviewer отметил, что
  интерфейс внутри read-only сессии не раскрывает точный runtime identifier;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- дважды воспроизведён fingerprint
  `b8e9be10e9a6e4937633ae67fd5e26f0902c5e000b1afdef32728feb3e2b7384`
  на 34 записях;
- verdict `changes_requested`: critical 0, high 0, medium 1, low 0.

Находка: production `execution_context_mismatch` оставляет разговор AI-active
и атомарно завершает job как `blocked`, но неизвестный blocked reason в public
projection превращался в `agent_reply_blocked`. History противоречил своему
`conversation_state=ai_active`, а replay ложно обещал manager review без
handoff/takeover. Два предыдущих PostgreSQL oracle покрывали только
`candidate_invalid`, поэтому unknown-reason fallback оставался false green.

Согласованный минимальный repair: manager-owned response определяется только
фактическим conversation ownership; неизвестный AI-active blocked reason
fail-closed проецируется в finite `worker_failed`. Добавлен реальный PostgreSQL
oracle до и после настоящего takeover с теми же public IDs и проверками
отсутствия outbound, handoff и raw reason. DTO, migration, prompt, model, tool,
send gate и takeover implementation не менялись.

Third repair evidence: red 1/1 воспроизвёл exact ложный history reason; green
1/1 подтвердил AI-active degraded state и последующий manager-owned replay.
Полный PostgreSQL suite 35/35, related suite 129 passed и 1 skipped,
build/typecheck/architecture 21/21 и `git diff --check` прошли. Unfiltered suite
сохранил прежние три context failure: 37 files passed, 374 tests passed,
2 skipped.

Четвёртый свежий read-only Reviewer:

- session `01a034fb-4ff8-70d0-bd66-fec5962f3d51`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- дважды воспроизведён fingerprint
  `d7bdb5facda04fd020a18fd1e3dea7d7a61ed59e87dbc3b8b4289a39be842192`
  на 34 записях;
- verdict `changes_requested`: critical 0, high 0, medium 1, low 0.

Находка: replay mapper проверяет status старой job раньше фактического
conversation ownership. Поэтому настоящий takeover при
`pending/processing/retrying/degraded/failed` публично выглядит как
`ai_active`, а старый `superseded` inbound в ещё AI-active разговоре — как
`manager_pending` с ложным обещанием manager review. Repository уже возвращает
актуальные `aiState` и `agentAllowedToReply`, но часть ветвей mapper их
игнорирует. Существующий PostgreSQL oracle покрывал только `blocked`, поэтому
остальные status-ветви остались false green.

Reviewer потребовал единый ownership-first projection и real PostgreSQL matrix:
manager takeover при nonterminal/degraded/failed job statuses, replay старого
superseded inbound при AI-active conversation, стабильные public IDs,
согласованность с history и отсутствие outbound, handoff и raw internal reason.
Architecture guard, root TypeScript и `git diff --check` у Reviewer прошли;
PostgreSQL/Vitest/build он не запускал из read-only среды.

Это четвёртая находка на одной public ownership/replay boundary и как минимум
второй повтор категории после repair. По
`AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md` и playbook срез переведён в
`needs_redesign`: отдельный Архитектор должен сравнить 2–3 внутренних варианта
и рекомендовать один до следующего рабочего кода. Public contract, migration,
prompt/model/tool policy, privacy, send gate, takeover implementation и roadmap
при этом не разрешено менять.

Отдельный read-only Архитектор:

- session `01a03509-0df3-7823-a818-0abc03c909f0`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- анализ выполнен на HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- рабочий код, документы, state, тесты и внешнее состояние не изменялись.

Сравнены три варианта:

1. переставить status-ветви в `v2AcceptedSuccess()` — малый diff, но сохраняет
   две независимые projection policy и mixed-snapshot race;
2. единый ownership-first domain projector плюс coherent PostgreSQL snapshot —
   закрывает весь класс дефекта для POST replay и history;
3. собирать public DTO внутри repository — связывает storage с public policy и
   меняет module ownership.

Выбран вариант 2. Его инвариант: current conversation ownership определяет
публичного владельца, job status описывает только исход конкретного AI-хода и
никогда сам не передаёт ownership менеджеру. Один pure decision должен сначала
классифицировать `ai_collecting_info/watching` против
`needs_manager/manager_active`, затем job outcome; POST и history используют
одну reason policy и отдельные DTO renderers. Repository возвращает coherent
snapshot current ownership, inbound job и latest conversation job. Memory
repository остаётся только contract double, а acceptance oracle — real
PostgreSQL matrix.

Обязательная matrix: takeover при
`pending/processing/retrying/degraded/failed/blocked`, AI-active replay старого
`superseded` inbound с проекцией актуального latest job, согласованность
history/replay, стабильные public IDs, отсутствие новых outbound/handoff и raw
internal reason, а также честный `message_to_user`. `closed` не расширяется:
его POST-представление относится к будущему public-contract срезу AILR-05.

Архитектор подтвердил отсутствие нового owner stop-gate: schema и публичный
набор значений, migration, prompt/model/tool/AI-policy/privacy, send gate,
takeover implementation, runtime assembly, module ownership и roadmap не
меняются.

Решение Архитектора реализовано. Восемь TDD-oracle сначала воспроизвели старые
ошибки projection, затем полный PostgreSQL suite прошёл 43/43. Связанный набор
прошёл 134 tests и 1 skip; build прошёл architecture 21/21, bounded
typecheck/manager build и Vite. Unfiltered suite сохранил только прежний
baseline: 382 passed, 2 skipped и те же context/runner failures. Migration,
public value union, prompt/model/tool, send gate, takeover implementation,
runtime assembly и deploy не менялись.

Пятый свежий read-only Reviewer:

- session `01a0352a-7da3-76b2-9aab-794cfc4e233d`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- дважды воспроизведён fingerprint
  `0b93b88d173b044b47ae6a746f7b4c6c5cc2c1e5f58444c1cfd9abcac6d28cb3`
  на 41 записи;
- verdict `needs_redesign`: critical 0, high 0, medium 1, low 0.

Находка: history projector в manager-owned conversation задним числом
подменяет evidence уже завершённого хода. После успешного AI-ответа и
более позднего takeover клиент получает и сохранённый assistant message, и
противоречащий ему `status=replied, reason=agent_reply_blocked`. Та же
ретроспективная подмена достижима для старого `superseded` job.

Текущее ownership должно определять владельца conversation, но status/reason
конкретного job должны оставаться историческим evidence. PostgreSQL matrix
проверяла takeover для `pending/processing/retrying/degraded/failed/blocked`,
но не для `replied/superseded`, поэтому оставалась false green.

Reviewer также подтвердил `git diff --check`, architecture guard,
хэш PostgreSQL-теста и документов; независимый Vitest/build в
read-only среде не запускался. Старый каталог не возвращён.

Final verdict: `needs_redesign`. До repair отдельный свежий Архитектор
сравнивает 2–3 способа развести current ownership и immutable per-job evidence
без изменения public value union, schema/migration, prompt/model/tool, privacy,
send gate, takeover implementation, roadmap и module ownership.

Второй свежий read-only Архитектор:

- session `01a03536-7745-7323-8b41-757e764bd2ca`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- verdict `recommended`; рабочие файлы и внешнее состояние не менялись.

Сравнены: status-исключения в manager branch, две независимые оси
в одном pure projector и durable ownership snapshot/timeline reconstruction.
Выбран второй вариант: top-level conversation state, future AI eligibility и
polling берутся только из current ownership/runtime, а history automation
status/reason — только из intrinsic evidence этого job. POST replay остаётся
current-action projection: при manager ownership он возвращает manager review, но
history не переписывает прошлое. `replied + handoff` сохраняет `handoff`;
обычный `replied` и `superseded` не имеют public reason. Unknown terminal reason
по-прежнему fail-closed проецируется как `worker_failed` без raw leak.

Минимальная production scope: `public-widget-ai-projection.ts`; acceptance oracle:
real PostgreSQL `widget-ai-postgres-runtime-invariants.test.ts`. Repository, memory double,
DTO/schema, takeover/send gate и catalog не меняются. Обязательны red/green cases:
normal replied, replied/handoff и superseded до/после takeover; все terminal/active
statuses, runtime disabled, old inbound/latest job, history >100, stable IDs/counts и
отсутствие raw reason и новых side effects.

Решение второго Архитектора реализовано. History projector больше не
принимает conversation ownership/runtime и строит только intrinsic
job evidence; caller передаёт ему только job status/reason. Top-level
conversation state и polling по-прежнему строятся отдельно из coherent
snapshot; POST replay по-прежнему описывает current action. Изменение caller
в `public-widget-intake-service.ts` — удаление запрещённого архитектурой
аргумента, а не новая policy.

Repair evidence: 8 exact red / 36 pass до production patch; 44/44 PostgreSQL и
132/132 related green после него. `npm run build` прошёл architecture
21/21, 142-source closure, bounded API/manager typecheck и Vite. Production
content hash `7428eb1c1823972159f26d0e0a7bb1ea5010675c25b6a45314bac7d563116459`;
PostgreSQL evidence hash
`647f026d66184eafb3e2a0ba40093264717a805d7694ef2944756395a6df38a2`.
Unfiltered suite сохранил только baseline failures: 383 passed, 2 skipped,
три прежних context assertions и Vitest/`node:test` discovery mismatch.
Public value union/DTO, schema/migration, prompt/model/tool/policy/privacy, repository
snapshot, takeover/send gate, runtime assembly, catalog и deploy не менялись.

Шестой свежий read-only Reviewer:

- session `01a03549-68b3-7592-ad1d-f47cafd4e9d6`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- reviewed HEAD `4c91d162e13251883125ab5b1b32565172f570c6`;
- дважды воспроизведён fingerprint
  `43b5f809302b5716ae811740494aa8cb1c545c63c4907110b9fdaf5cb797e5ac`
  на 41 записи;
- verdict `needs_redesign`: critical 0, high 0, medium 1, low 0.

Находка: `selectCurrentJob()` выбирает latest conversation job только когда job
повторяемого inbound уже `superseded`. Поэтому старый `replied` inbound при
более новом `pending` возвращает `replied/history_available`, а старый inbound
без job при более новом `pending` — `degraded/ai_persistence_unconfirmed`.
Актуальный response window в обоих случаях скрывается; только покрытый тестом
вариант `superseded + pending` честно возвращает `processing/poll_history`.

Reviewer воспроизвёл все три ветви прямым read-only выполнением pure projector.
PostgreSQL уже передаёт inbound и latest jobs из одного snapshot, поэтому
дефект находится в current-action selection, а не в repository. Существующий
real PostgreSQL oracle покрывает old `superseded`, но не old `replied` и
accepted-without-job. Tracked/untracked whitespace, production architecture
evaluator и прямой TypeScript check прошли; Vitest/build не запускались в
read-only sandbox из-за запрета временной записи.

Final verdict: `needs_redesign`. Это повтор public ownership/replay category,
поэтому до очередного repair отдельный свежий read-only Архитектор сравнивает
2–3 варианта current-window projection. Простая новая status-ветка запрещена;
public value union, schema/migration, prompt/model/tool/privacy, send gate,
takeover implementation, runtime assembly, catalog и roadmap менять нельзя.

Третий свежий read-only Архитектор:

- session `01a03555-b4d7-7533-9832-7d234924cfe6`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- verdict `recommended`; рабочие файлы и внешнее состояние не менялись.

Сравнены три варианта: всегда брать latest job; передавать explicit current
window identity в pure projector; классифицировать current public action в SQL
repository. Первый вариант не различает `current no-job + old job` и
`old no-job + newer job`; третий переносит public policy в storage и дублирует
её в memory double. Выбран второй вариант.

Инвариант: POST automation описывает только latest visitor response window из
одного coherent snapshot. Окно задаётся latest visitor public id и message
sequence; active job дополнительно должна совпадать с current generation epoch.
Reply повторяемого inbound относится к current action только если этот inbound
и есть latest visitor. Manager ownership, runtime stop и effective agent gate
доминируют над действием. History automation остаётся intrinsic per-job
evidence и не получает window/ownership/runtime.

Минимальная production scope: pure projector, передача internal identity через
intake use-case/repository result types, добавление current generation и latest
visitor id/sequence в уже существующий единый PostgreSQL replay statement и
parity memory double. Schema/migration, public DTO/value union, prompt/model/
tool/policy/privacy, send gate, takeover/runtime implementation, module
ownership, roadmap и catalog не меняются.

Обязательный red/green oracle: old replied/no-job/superseded с newer pending;
current no-job с only old job; old replied с newer no-job; latest active и
terminal statuses; same-window reply/failure; manager takeover, runtime stop и
stale epoch; immutable history, finite public reasons, stable IDs/counts и
отсутствие новых outbound/handoff. Rollback — удалить только этот внутренний
repair поверх текущего AILR-02 diff; data rollback не нужен.

Identity-window repair реализован в pure projector и внутренних repository
results. PostgreSQL replay и history получают latest visitor id/sequence и
current generation из одного SQL statement; memory repository сохраняет тот же
контракт. Публичный DTO, schema/migration и набор public reason не менялись.

TDD evidence: четыре exact PostgreSQL сценария сначала падали как old
`replied`, old no-job, old reply при current no-job и stale active epoch; после
production repair они прошли 4/4. Полный real PostgreSQL suite прошёл 48/48,
связанный non-PostgreSQL набор — 132/132. `npm run build` прошёл architecture
21/21, 142-source closure, bounded API/manager typecheck и Vite production
build. Production content hash:
`a1f8640a53d57d226a7e1749b8a3081b4525737e446e648ad9e6cc9ff85bc60c`;
PostgreSQL evidence hash:
`7140640b82acca3d2e4fd20cac64fdcd2da179aa9943d8641402dd67d228f1f7`.
`git diff --check` прошёл.

Unfiltered suite сохранил прежний baseline: 387 passed, 2 skipped, три context
failures в `ai-turn-context.test.ts`/`live-v2-context.test.ts` и отдельный
Vitest/`node:test` discovery mismatch для architecture guard self-test; четыре
новых PostgreSQL теста увеличили число passed относительно прошлого прогона.
Не проверялись paid provider, реальные customer traces, browser UX, production
data и deploy. Catalog и старый catalog UI не изменялись. Rollback — удалить
identity-window repair и четыре его PostgreSQL oracle; data rollback не нужен.

Седьмой свежий read-only Reviewer:

- session `01a0356f-f385-7803-afe8-c732692e363f`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- дважды воспроизвёл 41-entry fingerprint
  `070c9bbda61d02b7fa0e083284483a900c6653243a508b4d90264c77cdd2319c`;
- verdict `needs_fix`: critical 0, high 0, medium 0, low 2;
- production/dataflow, concurrency, privacy, public reasons, send gate,
  takeover и false-green tests проверены без production-находок; pure projector
  matrix прошла 16/16, exact PostgreSQL evidence hash совпал.

Обе low-находки относятся только к handoff evidence: устаревший `next_action`
в state и пропущенный Vitest/`node:test` discovery mismatch в последнем абзаце
карточки. Они исправлены без изменения production/test/catalog/browser/deploy
файлов. Нужен свежий независимый review нового exact fingerprint.

Восьмой свежий read-only Reviewer:

- orchestration session `01a0357d-6426-7fe1-8f3f-fcabe19aa4e3`;
- launch model `gpt-5.6-sol`, reasoning effort `high`;
- дважды воспроизвёл 41-entry fingerprint
  `98e9d6ec4997ee57a4d9022acd53f8fa2fb0211c234ffa25d13c3ced7321f742`;
- verdict `accept`: critical 0, high 0, medium 0, low 0;
- подтвердил обе evidence-поправки, неизменный production closure/hash,
  PostgreSQL evidence hash, отсутствие catalog/browser/deploy/schema/contract
  изменений и pure projector matrix 16/16.

Reviewer не перезапускал Vitest/PostgreSQL/build/typecheck/Vite в read-only
среде; для принятого payload используются записанные Исполнителем прогоны
48/48, 132/132, typecheck/build и architecture 21/21. Paid provider, customer
traces, browser UX, production data, внешние репозитории и deploy не
проверялись. `output/` не читался.

## 9. Передача Goal

Почему изменение понадобилось: lexical regex угадывал смысл свободного текста
и превращал обычные ответы в молчаливый terminal reject.

Какое доказательство делает его принятым: свежий Reviewer воспроизводит hard
allowlist, repairs, false-positive suite и отсутствие regressions на exact
fingerprint.

Какой риск остался: без semantic regex нет честной independent factual проверки
свободной фразы; до deploy её должен закрыть structured published evidence path
AILR-03/04 и финальная ручная приёмка.

Следующий срез после `accept`: AILR-03 — versioned catalog authority и offline
retrieval baseline.
