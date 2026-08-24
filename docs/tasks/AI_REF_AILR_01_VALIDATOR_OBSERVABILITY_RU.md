# Карточка среза AI-LAYER-SIMPLIFICATION: AILR-01 — точная причина validator reject

Статус: `accept` — принят свежим независимым Reviewer.

Goal: `AI-LAYER-SIMPLIFICATION`.

Позиция в roadmap: второй срез после принятого AILR-00; до изменения validator
policy и catalog retrieval.

Ветка / base SHA / head SHA:
`agent/ai-layer-refactor` /
`4c91d162e13251883125ab5b1b32565172f570c6` /
тот же SHA до непубликованного diff Goal.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier интерфейсом
сессии не раскрыт.

Фактическая модель независимого Reviewer: `gpt-5.6-sol`, reasoning
effort `high`; session `01a0345d-bf7f-7963-ba74-147c8869b527`.

## 1. Один результат

После terminal model-turn validator reject точный конечный код сохраняется во
внутреннем app-owned logical `ai_runs.metadata.validator_failure_code`, а
клиент по-прежнему получает только существующее generic no-reply состояние без
внутренней причины.

Почему это следующий срез: AILR-00 принят на reviewed fingerprint
`5ab09846f682dfe618dbd973b29a4e8b0b3736e7319233c8b37c60f9a8974cbb` и
доказал, что `executeModelTurn()` сохраняет exact code до `terminalStateFor()`,
где восемь причин схлопываются в `candidate_invalid`.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | Непубликованный принятый AILR-00 поверх base SHA и пользовательский untracked `output/` |
| Base/head SHA | `4c91d162e13251883125ab5b1b32565172f570c6` |
| Accepted predecessor | AILR-00, fifth Reviewer `accept`, session `01a03437-a21a-73b3-8279-5376fb307fc6` |
| Existing storage | `ai_runs.metadata` JSONB уже существует; logical recorded-v2 begin оставляет `{}` |
| Existing exact reason | `ModelTurnApplyPlan.validationCode` до terminal mapping |
| Existing tests | model-turn validator/apply-plan, M2 direct runtime, sanitizer, memory/PostgreSQL run repositories, PostgreSQL worker invariants |
| Незавершённые пользовательские изменения | `output/`; не читать и не менять |

Источники истины по приоритету:

1. current code и schema на base SHA;
2. ADR-010/012, active Goal и принятая карта AILR-00;
3. `developing-ai-agents` Harness/eval/privacy правила и эта карточка.

## 3. Область

Разрешено:

- закрытый app-owned enum восьми terminal validator codes;
- typed terminal completion и centralized sanitizer;
- запись enum в существующий logical `ai_runs.metadata` без migration;
- восстановление значения из terminal run и связь с physical attempt через
  существующий `ai_run_id`;
- TDD на propagation, sanitization, durable PostgreSQL evidence и отсутствие
  public leak.

Точные terminal codes:

```text
invalid_shape
invalid_answer
duplicate_question
invalid_question
unsafe_claim
tone_violation
repeated_reply
known_slot_requested
```

Явно вне области:

- изменение того, какие коды terminal, и любая правка validator policy;
- schema/migration или новая колонка attempt/run;
- manager/public DTO, history schema, prompt/tool/model/runtime config;
- raw model output, customer text, provider error или PII в observability;
- retry, stale, send gate, takeover, widget/landing/catalog и deploy.

Точный allowlist рабочего кода и тестов:

```text
apps/api/src/modules/ai/observability/ai-validator-failure-code.ts
apps/api/src/modules/ai/observability/ai-observability-sanitizer.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-contract.ts
apps/api/src/modules/ai/repositories/ai-run-repository.ts
apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/p3-observability-sanitizer.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
```

Hard limit: не более 220 добавленных/изменённых строк production/test кода;
docs/state/routing evidence считаются отдельно. Расширение требует объяснения в
этой карточке и проверки Reviewer.

Контрактное расширение после первого architecture-прогона: два уже действующих
governance-файла `tooling/ai-architecture-contract.json` и
`tooling/ai-architecture-guardrails.mjs` меняют только ожидаемые source/evidence
fingerprints. Это не runtime-логика и не самостоятельное принятие evidence:
текущий fingerprint обязан проверить свежий Reviewer.

## 4. Критерии успеха

- [x] Каждый из восьми finite codes проходит centralized completion sanitizer;
  неизвестная строка и raw canary отклоняются.
- [x] Invalid model turn завершает run с generic
  `candidate_invalid/invalid_candidate/rejected` и exact
  `validatorFailureCode`, не создавая outbound message.
- [x] PostgreSQL сохраняет только
  `{ "validator_failure_code": "<finite-code>" }` в существующем
  `ai_runs.metadata`; terminal replay восстанавливает тот же typed code.
- [x] Public `history.v2` не содержит `validator_failure_code`, exact code или
  raw candidate; public contract/schema не меняются.
- [x] Успешные, provider-failure, stale и takeover paths не получают ложный
  validator code и сохраняют прежнее поведение.
- [x] Targeted tests, typecheck, architecture guard, применимый build и
  `git diff --check` проходят.

## 5. Стоп-гейты

- [x] Нового архитектурного решения нет: exact internal evidence заранее
  одобрена Goal и AILR-00.
- [x] Migration/schema и public contract не меняются: существующий JSONB path
  подтверждён кодом; при его недостаточности срез остановится.
- [x] Prompt/tool/model-policy/privacy/send gate/takeover не меняются; privacy
  ограничена finite enum и negative raw-canary tests.
- [x] Deploy/secrets/runtime config/paid call/другой repo не выполняются.

## 6. Выполнение

TDD сначала зафиксировал три ожидаемых разрыва:

- sanitizer и memory runtime теряли `validatorFailureCode`: два новых теста
  упали именно на отсутствующем поле;
- PostgreSQL terminal completion оставлял `ai_runs.metadata={}` вместо exact
  code;
- public history уже не создавал assistant message, то есть новый тест не
  подменял observability изменением клиентского поведения.

Реализовано:

- один закрытый enum из восьми terminal codes; три diagnostic codes остались
  nonterminal и не могут попасть в terminal completion;
- centralized sanitizer принимает поле только для точного состояния
  `blocked/no_reply/candidate_invalid/invalid_candidate/rejected` и отклоняет
  unknown/raw значения;
- `RecordedLiveV2TurnService` передаёт код только из явно выбранного
  `model_turn_v1`, не из legacy validator;
- PostgreSQL атомарно merge-ит один snake_case ключ в существующий JSONB,
  terminal replay восстанавливает тип и fail-closed проверяет согласованность
  кода с terminal state;
- public history проверен на отсутствие exact code, raw candidate и outbound;
  успешный path проверен на отсутствие ложного поля.

Production/test diff: девять файлов, 216 insertions и 34 deletions, включая
новый 19-строчный enum-файл. Лимит 220 соблюдён.

Соседние находки не выполняются: terminal allowlist policy — AILR-02;
catalog authority/retrieval/navigation — AILR-03—06; противоречивый
`generator_failed` physical attempt — отдельный будущий кандидат.

## 7. Evidence

Base/head: `4c91d162e13251883125ab5b1b32565172f570c6`; branch
`agent/ai-layer-refactor`; локальный `origin/main`:
`2122ce143129492797514bb73bdf4a1069e273a2`.

Полный AILR-01 code/test/route/evidence set:

```text
.agents/state/granit-dev-workflow.json
apps/api/src/modules/ai/observability/ai-validator-failure-code.ts
apps/api/src/modules/ai/observability/ai-observability-sanitizer.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-contract.ts
apps/api/src/modules/ai/repositories/ai-run-repository.ts
apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/p3-observability-sanitizer.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
docs/source-of-truth.md
docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md
docs/tasks/AI_REF_AILR_00_RUNTIME_HARNESS_MAP_RU.md
docs/tasks/AI_REF_AILR_01_VALIDATOR_OBSERVABILITY_RU.md
docs/tasks/README.md
tooling/ai-architecture-contract.json
tooling/ai-architecture-guardrails.mjs
```

Общий dirty worktree поверх base содержит принятый predecessor AILR-00 и этот
срез: `git diff --stat` показывает 23 tracked files, 464 insertions и 108
deletions; дополнительно есть четыре untracked Goal/card/code файла. Review
fingerprint охватывает все 26 status entries кроме самозаписывающегося machine
state и пользовательского `output/`, поэтому Reviewer увидит не только
AILR-01, но и неизменённый accepted predecessor payload.

Проверки на окончательном коде:

- red phase: 2/2 новых non-PostgreSQL теста и 1/1 PostgreSQL persistence test
  ожидаемо падали до реализации;
- exact sanitizer/runtime: 7/7;
- соседние validator/orchestrator/memory/provider paths: 39/39;
- real PostgreSQL runtime: 32/32, включая takeover без ответа, stale lease,
  newer inbound, lost lease и transactional rollback;
- применимый suite без трёх известных baseline-файлов: 37/37 files,
  359 passed, 2 skipped;
- `npm run build`: architecture guard 21/21, 141 production source, 20
  compatibility exports, полный API/manager typecheck и Vite build прошли;
- `git diff --check`: passed; production/test additions 216/220.

Unfiltered `npm test -- --maxWorkers=1` оставлен честно красным: 367 passed,
3 failed, 2 skipped. Три унаследованных сбоя находятся вне AILR-01: два stale
assertion в `ai-turn-context.test.ts`, один invalid fixture в
`live-v2-context.test.ts`; кроме того, Vitest пытается собрать отдельный
`node:test` guard-файл как suite. `git diff` для обоих тестов и их production
sources пуст, а правильный `node --test` запуск guard прошёл 21/21. Эти
соседние проблемы не исправлялись из-за правила одного среза.

Прямое влияние: внутренний terminal run evidence и его memory/PostgreSQL
replay. Косвенное: manager quality по-прежнему видит только существующий generic
`candidate_invalid`; public history и клиент не получают новое поле. Schema,
migration, prompt, tool, model, policy, privacy surface, send gate, takeover,
widget, catalog и runtime config не менялись.

Не проверено: paid provider, browser/manual UX, production data и deploy. Они не
нужны для внутреннего enum path и не считаются доказанными зелёными тестами.

Rollback: удалить только AILR-01 code/test/card/routing diff поверх принятой
границы AILR-00. Schema/data rollback не нужен. Зелёные тесты не разрешают
deploy; deploy возможен только после отдельного явного ручного согласия
владельца.

## 8. Независимая проверка

Fresh read-only Reviewer независимо воспроизвёл 26-entry fingerprint
`d72aa14603fb500b7a6cac4848863880bf71f2b75a7783e97cdd8a18cd47624e` и
выдал `ACCEPT` без critical/high/medium/low findings. Code Scout проверил
production assembly, восемь terminal и три nonterminal code, model-turn-only
propagation, sanitizer/replay fail-closed, JSONB merge, memory/PostgreSQL paths,
concurrency/stale/takeover, public/manager privacy, scope, лимит 216/220,
false-green риски и rollback.

Независимо прошли `tsc --noEmit`, architecture guard и
`git diff --check`. Vitest и real PostgreSQL Reviewer не перезапускал:
read-only sandbox запретил temporary `mkdir`, а мутация локальной
БД была вне поручения. Он проверил их oracle, транзакционные paths и
exact-fingerprint evidence; исполнитель ранее получил 359 passed,
2 skipped и 32/32 PostgreSQL invariants.

После review изменены только эта запись приёмки, status среза в Goal
и исключённый из fingerprint machine state; accepted payload — именно
указанный выше hash.

## 9. Передача Goal

Почему изменение понадобилось: общий `candidate_invalid` не позволяет понять,
какой из восьми механических validator gates остановил ход.

Доказательство принятия: fresh Reviewer независимо получает exact finite code
из durable run evidence и доказывает отсутствие public/raw leak на неизменном
review fingerprint.

Оставшийся риск: код причины объясняет место блокировки, но не доказывает, что
сам validator policy полезен; это отдельный AILR-02.

Следующий срез после `accept`: AILR-02, только после отдельного policy stop-gate.
