# Крупные задачи по расчистке legacy AI-слоя

Статус: `planning_input`. Этот документ декомпозирует расчистку, но не является
active AI-card, ADR или разрешением выполнить весь roadmap одним diff. Каждая
задача ниже активируется отдельной командой владельца, выполняется как один
вертикальный срез и после передачи результата останавливается.

Подготовлено на ветке `agent/ai-layer-refactor`, base SHA
`e03a1789dbcfd015d3d4cc06aa553513fa0bc1fe`.

На baseline tracked diff отсутствует. Пользовательские untracked `context.md`,
`docs/presentations/` и `output/` не входят в область и не изменяются.

## 1. Зачем нужна расчистка

На одном SHA существуют три правдоподобных AI-контура:

1. `model_turn_v1` — текущий production wiring из `app-context.ts`;
2. `legacy_live_v2_candidate` — исполняемая альтернатива внутри
   `RecordedLiveV2TurnService`;
3. старый grounded-контур с отдельным prompt, catalog knowledge provider и
   semantic verifier, который используется штатными eval-командами, но не
   staging runtime.

Это создаёт системный риск: агент может изменить prompt, validator, catalog или
eval, который не участвует в реальном ходе. Само наличие legacy не ухудшает
ответ модели напрямую, потому что репозиторий не отправляется модели. Оно
мешает безопасно изменять и честно измерять текущий runtime.

Программа расчистки завершена, когда одновременно истинны утверждения:

- production assembly и `RecordedLiveV2TurnService` имеют один model-turn path;
- штатные offline/live eval используют контракт текущего model-turn, а не
  старый `PublicWidgetAiReplyGenerator`;
- grounded-контур, старый snapshot и тесты только этого контура удалены;
- активный intake не импортирует старые policy/prompt/knowledge constants;
- новые записи принимают только активные runtime/profile значения, а
  исторические значения остаются читаемыми без migration;
- крупные AI/intake persistence-модули разделены по ownership без изменения
  поведения;
- architecture guard проверяет достижимость от production roots и запрещённые
  legacy edges, а не выдаёт зелёный результат за счёт общего hash списка;
- текущая runtime spec короткая и не ведёт нового агента через заменённые
  process/Goal-документы.

Расчистка не считается доказательством причины жалобы «AI тупой». Диагностика
качества требует sanitized плохих диалогов и run evidence уже после появления
релевантного eval harness.

## 2. Подтверждённый baseline

| Область | Факт на base SHA |
|---|---|
| Production assembly | `apps/api/src/app-context.ts` передаёт `turnContract: "model_turn_v1"` |
| Альтернативный path | `RecordedLiveV2TurnServiceOptions.turnContract` optional; без него выбирается `executeLiveV2Turn` |
| Текущий model-turn | `executeModelTurn`; поддерживает bounded `search_catalog` и при необходимости второй model call |
| Штатный eval | `run-widget-ai-evals.ts` создаёт `GroundedWidgetAiService`, generator и semantic verifier |
| Live eval default | `gpt-5.5`, отдельно от runtime model configuration |
| Старый catalog | `catalog/snapshots/catalog-knowledge.v1.json`, около 2 МБ |
| Текущий catalog | `catalog/catalog-index.v1.json`; загружается через `readFile`, поэтому import-only анализ недостаточен |
| Dead tail | `validateAiReplyCandidate` в `public-widget-intake-service.ts` не имеет callers |
| Крупные файлы | Postgres intake — 5143 строки; public widget intake — 1620; recorded turn — 1156; Postgres AI run — 1071 |
| Active documents | `source-of-truth.md` ведёт через 15 authority files, включая два заменённых process-документа и исторические owner roadmaps |
| Старое task routing | active Goal всё ещё требует один model call, а исполняемый model-turn допускает два |
| Guard | `ai-architecture-contract.json` закрепляет старую active-card и hashes всего source/task surface |
| Persisted compatibility | `legacy_s05`, `grounded_v1`, `native_grounded`, `mastra_openai_api` встречаются в migrations/schema/исторических строках |

Значимые baseline-команды перед каждым срезом повторяются на его фактическом
base SHA. Этот документ не заменяет свежий preflight.

## 3. Общие правила выполнения

- Не объединять соседние задачи «заодно». После критериев успеха текущего среза
  остановиться.
- Для изменения поведения сначала добавить или обновить тест и увидеть
  ожидаемое падение. Для чистого удаления недостижимого кода или документации
  искусственный red-test не нужен.
- Перед удалением каждого файла повторно доказать отсутствие production,
  script и test consumers. Для JSON/assets учитывать `readFile`, dynamic import,
  URL и build scripts, а не только TypeScript imports.
- Не менять prompt, tone, model, reasoning effort, tool policy, privacy,
  send gate, manager takeover или fallback copy внутри cleanup-задач. Такое
  изменение требует отдельного точного owner task.
- Не выполнять migration/schema change. Старые persisted значения сохраняются
  на read/replay boundary до отдельного решения.
- Не выполнять commit, push, PR, merge, deploy, платные model/eval calls и
  изменения в соседних репозиториях.
- Для нетривиального diff после self-review запускать свежего read-only
  Reviewer по правилам `AGENTS.md`.
- Rollback каждого среза — откатить только exact diff этого среза. Ни одна
  задача программы не должна требовать отката данных.

### 3.1. Skill routing, включая Metarhia MetaSkills

Каждый Исполнитель до реализации выбирает минимальный набор skills по
фактическому содержанию текущего среза. Skill — это рабочая инструкция, а не
ритуальная CI-команда и не разрешение расширить scope.

В brief текущего среза добавить:

```text
Skills:
- обязательные: <skill и зачем он нужен этому срезу>
- условные: <точный trigger, после которого skill будет загружен>
- не применяются: <почему очевидный соседний skill не нужен>

Data structures:
- текущие структуры и операции: <что подтверждено кодом>
- решение: <сохранить / заменить после evidence>
- сложность и границы: <hot operations, growth, serialization, ownership>
```

Обязательная маршрутизация:

| Условие | Skill | Как применять |
|---|---|---|
| Выбранный LGC-срез нужно превратить в точный execution brief | `codex-dispatcher` | Уточнить один результат, scope, исключения, evidence и stop-gates. Не дробить один срез на параллельные изменения и не выбирать следующий срез автоматически. |
| Нужен поиск symbols, callers, consumers, imports или runtime roots | `ast-index` | Использовать первым. `rg` допустим после него только для string literals, comments, regex, JSON/assets и пустого результата индекса. |
| Меняется или проверяется AI Harness, context/tool/model boundary либо eval | `developing-ai-agents` | Для LGC-00/LGC-03/LGC-08 использовать harness-review route; для LGC-01 — build-evals route. Разделять evidence, inference и unknown; не объявлять качество улучшенным без измерения. |
| Редактируются `.ts`, `.js` или `.mjs` | `js-conventions` | Применять к новому и изменённому коду в пределах среза. Локальные conventions и `AGENTS.md` имеют приоритет; не добавлять eslint/prettier/scripts или dependency только ради skill. |
| Выбираются `Object`, `Array`, `Map`, `Set`, weak collections или typed arrays | `js-data-structures` | Зафиксировать семантику, hot operations, Big-O, порядок итерации, сериализацию, ограничение роста и observable tests. Не заменять маленький понятный массив на `Set` без реальной причины. |
| Выбирается или реализуется custom queue/deque/stack/list/heap/graph/LRU/cache/pool/CRDT либо другой non-native container | `data-structures` | Выбрать структуру по контролируемому свойству и hot operations; скрыть representation за малым API, ограничить рост и проверить observable contract. Не писать custom container, если native collection или уже установленный ADT решает задачу проще. |
| Код уже импортирует или обоснованно должен использовать ADT из `metautil` | `metautil-data-structures` | Выбрать `Queue`, `Stack`, `Deque`, `CircularBuffer`, `List`, `ConsList`, `Struct`, `Trie` или `UnrolledList` по контракту операций и проверить documented empty/error behavior. |
| Меняются module boundaries, responsibility, dependency direction или применяется GoF/GRASP/SOLID pattern | `js-gof` | Проверить composition, separation system/domain code, coupling, isolation/layer borders и простоту pattern. Паттерн вводится только для подтверждённого failure mode; название паттерна не является обоснованием. |

На baseline локально доступны `js-conventions`, `js-data-structures` и
`metautil-data-structures`. Upstream Metarhia MetaSkills также содержит
`data-structures` и `js-gof`, но они не загружены среди skills этой сессии.
Исполнитель не устанавливает и не обновляет MetaSkills автоматически. Если
`data-structures` или `js-gof` доступны в его среде, он обязан прочитать и
применить их полностью. Если недоступны, он фиксирует это в brief и выполняет
встроенные gates ниже как обязательный эквивалент, а не пропускает проверку.

#### Архитектурный gate `js-gof`

Для LGC-02—LGC-08 до реализации составить таблицу затронутых units:

```text
Unit/file/symbol:
Responsibility:
Public or internal contract:
Depends on:
Consumed by:
State/transaction owner:
Current coupling problem:
Chosen boundary/pattern or reason to keep current structure:
Evidence and test:
```

Проверить и исправить в пределах текущего среза:

- предпочитается structural composition, а не новая inheritance hierarchy;
- system/infrastructure code не смешивается с domain/business policy;
- у каждого выделенного модуля одна ясная responsibility и малый явный
  interface;
- dependency direction явен, cycles и скрытая mutable global state
  отсутствуют;
- coupling между модулями уменьшается или как минимум не растёт; применение
  GRASP/SOLID оценивается по конкретной границе, а не механически по списку;
- isolation и layer borders обеспечены простейшим средством. IoC/DI вводятся
  только когда они реально разрывают зависимость или делают boundary
  проверяемой;
- Facade, Strategy, Adapter, Factory и другие patterns используются только при
  подтверждённой необходимости; не вводить абстракцию ради имени pattern;
- callers зависят от контракта, а не от private representation, чтобы
  внутреннюю реализацию можно было заменить без каскадного изменения consumers;
- related code и данные находятся рядом с владельцем; перенос не создаёт
  дублирующий путь или новую compatibility shim;
- выделенный unit можно понять и проверить через его contract без чтения всех
  внутренних helpers.

После реализации повторить gate по фактическому diff. Подтверждённое нарушение,
созданное текущим diff или прямо входящее в scope, исправляется до финальных
проверок. Соседнее нарушение вне scope только фиксируется как кандидат
следующей задачи. Reviewer получает заполненную таблицу и отдельно проверяет
coupling, dependency direction, responsibility и pattern overengineering.

#### Gate структур данных

Перед созданием или заменой collection/container зафиксировать:

```text
Required semantics:
Expected size and growth bound:
Hot operations and required complexity:
Ordering and duplicate semantics:
Mutation/aliasing ownership:
Serialization/I/O boundary:
Empty/error behavior:
Native / metautil / custom alternatives considered:
Why the selected structure is the smallest sufficient option:
```

Проверить и исправить:

- структура выбирается по нужному свойству и операциям, а не только по
  предполагаемой скорости;
- representation скрыта за малым API, если callers не должны зависеть от неё;
- очередь, cache, pool, registry и visited/frontier state имеют явный предел
  роста или доказанно bounded lifecycle;
- hot queue не реализована через `Array.shift()` без измерения; custom ring или
  ADT не вводится для малого редкого обхода;
- iteration order, uniqueness, duplicate handling и snapshot/live semantics
  определены контрактом;
- `Map`, `Set`, weak collections и custom structures не протекают напрямую в
  JSON/DB/public DTO; преобразование выполняется явно на boundary;
- тесты проверяют contents, order, size, empty/error cases, growth bound и
  заменяемость representation, а не private nodes/buffers;
- если существующая структура уже минимальна и достаточна, результат проверки
  — оставить её без изменения.

Правила для data-structure skills:

- baseline этого документа: пакет `metautil` не установлен. Не добавлять его и
  не менять lockfile только ради применения skill; новая dependency требует
  отдельного доказательства необходимости и разрешения в текущем scope;
- для LGC-08 dependency graph обычно достаточно `Map<string, Set<string>>`,
  очереди обхода и множества visited из стандартной библиотеки. Перед custom
  queue доказать, что `Array.shift()` находится на значимом hot path;
- transaction state, DTO и JSON boundaries должны оставаться сериализуемыми;
  `Map`/`Set` преобразуются явно на границе;
- не внедрять новую структуру ради теоретической Big-O, если объём мал,
  операция не горячая и текущий код понятнее;
- если структура меняется, тестировать наблюдаемое содержимое, стабильный
  порядок, duplicate handling, empty behavior и bounded growth, а не private
  representation.

Связь skills с задачами:

| Задача | Обязательные skills | Условные skills |
|---|---|---|
| LGC-00 | `codex-dispatcher`, `ast-index`, `developing-ai-agents` | — |
| LGC-01 | `codex-dispatcher`, `ast-index`, `developing-ai-agents`, `js-conventions` | `js-data-structures`/`data-structures` при изменении corpus/index representation |
| LGC-02—LGC-05 | `codex-dispatcher`, `ast-index`, `js-conventions`, `js-gof` gate | `developing-ai-agents` при изменении Harness semantics; data-structure skills только по их trigger |
| LGC-06—LGC-07 | `codex-dispatcher`, `ast-index`, `js-conventions`, `js-gof` gate | `js-data-structures`, `data-structures` или `metautil-data-structures` при доказанном выборе/замене collection |
| LGC-08 | `codex-dispatcher`, `ast-index`, `developing-ai-agents`, `js-conventions`, `js-gof` gate, `js-data-structures` | `data-structures` для custom graph/queue; `metautil-data-structures` только при уже разрешённой зависимости и доказанном преимуществе ADT |
| Финальная проверка | `ast-index`, `developing-ai-agents`, `js-gof` gate | data-structure skills для review каждого фактически изменённого collection contract |

Если skill отсутствует или его инструкция недоступна, Исполнитель фиксирует это
в brief и продолжает по repo rules с ближайшим безопасным подходом. В финальной
передаче он перечисляет фактически применённые skills и только материальное
влияние каждого на решение.

Все начальные команды ниже включают этот раздел по умолчанию: Исполнитель
обязан применить skill routing для выбранного среза, даже если команда не
повторяет названия skills.

## 4. Порядок задач

```text
LGC-00 current authority
  -> LGC-01 current-runtime eval harness
  -> LGC-02 delete grounded runtime/eval/catalog
  -> LGC-03 one executable model-turn path
  -> LGC-04 remove dead intake validation tail
  -> LGC-05 active-write / historical-read types
  -> LGC-06 split active coordinators
  -> LGC-07 split persistence modules
  -> LGC-08 reachability architecture guard
```

`LGC-06` и `LGC-07` намеренно идут после удаления legacy: сначала уменьшается
объём и число контрактов, затем оставшийся production-код делится по ownership.

## 5. LGC-00 — короткий current authority route

### Один результат

Новый агент получает короткое непротиворечивое описание текущего AI runtime и
не обязан читать заменённые process/Goal-документы как active authority.

### Область

- создать компактную current-runtime spec, основанную на production assembly,
  контрактах, migrations и executable tests текущего SHA;
- обновить `docs/source-of-truth.md` и `docs/tasks/README.md`: закрытая AILR-03
  больше не active-card, этот planning-файл не становится active автоматически;
- убрать из active authority route как минимум документы, которые сами
  помечены как заменённые `AGENTS.md`/`AGENT_WORKFLOW.md`;
- исторические owner reviews, Goal и cards сохранить как provenance в archive
  или historical section, не переписывая прошлое;
- привести document section `tooling/ai-architecture-contract.json` к новому
  маршруту без изменения runtime guard semantics в этом срезе.

### Вне области

- код runtime, eval и catalog;
- новый продуктовый roadmap после расчистки;
- изменение принятых архитектурных решений.

### Критерии успеха

- active route не содержит документ со статусом «заменён»;
- current-runtime spec явно называет `executeModelTurn`, model-owned
  `search_catalog`, допустимые два model call и app-owned validation/send gate;
- историческая карточка не описана как текущая реализация;
- `npm run check:architecture` и `git diff --check` проходят;
- Reviewer не находит второго active roadmap или потерянного accepted ADR.

### Начальная команда агенту

```text
Выполни только LGC-00 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Сведи active AI authority к короткому current-runtime route. Код runtime не
меняй. После проверок и self-review остановись.
```

## 6. LGC-01 — eval harness текущего `model_turn_v1`

### Один результат

`eval:widget-ai:offline`, `eval:widget-ai:dry-run` и разрешённый отдельно live
runner собирают тот же model-turn request/validation path, что production.

### Область

- зафиксировать contract fixture для `AiTurnInput`, текущих facts, текущего
  `catalog-index.v1.json`, gate и `executeModelTurn`;
- переписать offline corpus/evaluator вокруг `ModelTurnOutcome` и
  `ValidatedTurnPlan`;
- dry-run должен показывать версии текущих prompt/model profile/catalog и число
  cases без provider call;
- live runner, если он сохраняется, использует текущий generator boundary и
  runtime model configuration; paid execution остаётся закрыт явным env gate;
- заменить false-green тест, который проверяет только самосогласованность
  старого корпуса.

### Обязательные сценарии

- обычный ответ без catalog search;
- один bounded catalog search и второй model call;
- invalid tool arguments;
- unknown/duplicate recommendation IDs;
- empty/invalid catalog;
- gate closed и gate changed before persistence;
- safe fallback и terminal no-reply различаются;
- model call count соответствует trace и сценарию.

### Критерии успеха

- целевой тест сначала доказывает, что прежняя eval-команда не вызывает
  `executeModelTurn`;
- после реализации все штатные eval entrypoints импортируют current harness;
- offline eval детерминирован, не требует сети, секретов или платного вызова;
- targeted model-turn/catalog tests, `npm run eval:widget-ai:offline`, dry-run,
  `npm run typecheck:api` и `git diff --check` проходят;
- плохой current-runtime fixture делает eval красным.

### Стоп-гейт

Изменение eval rubric допустимо только для привязки к текущему контракту.
Изменение prompt/model/tool policy остановить как `needs_human_decision`.

### Начальная команда агенту

```text
Выполни только LGC-01 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Замени false-green eval на deterministic harness текущего model_turn_v1.
Не меняй runtime prompt/model и не запускай paid live eval.
```

## 7. LGC-02 — удалить grounded-контур и старый catalog snapshot

### Один результат

В репозитории нет второго старого AI-сервиса и его 2-МБ catalog snapshot;
штатные команды продолжают работать через созданный в LGC-01 harness.

### Кандидаты на удаление

- `openai-widget-assistant-provider.ts`;
- `openai-widget-semantic-verifier.ts`;
- `grounded-widget-ai-service.ts`;
- старые `policy/`, `prompts/widget-ai-prompt.ts`,
  `rendering/widget-ai-reply-renderer.ts` в части без current consumers;
- старые catalog knowledge port/providers/build script;
- semantic verifier и verification validator;
- старые eval runner/corpus, если LGC-01 уже заменил их;
- `catalog/snapshots/catalog-knowledge.v1.json`;
- тесты, которые защищают только удалённый контур;
- package scripts, exports и constants, ставшие недостижимыми.

Список является candidate inventory, не разрешением удалить файл без свежего
графа consumers. Общие типы сначала переносятся в ближайший активный модуль.

### Нельзя удалять

- `apps/api/src/modules/ai/catalog/catalog-index.v1.json`;
- `pinned-catalog-index.ts`, current catalog search и model-turn tests;
- migrations или исторические DB enum/check values;
- типы/ports, которые ещё нужны worker tests или current execution boundary.

### Критерии успеха

- поиск symbols/imports/string asset references не находит consumers
  удаляемых файлов до удаления;
- production assembly, current eval и package scripts не импортируют
  `GroundedWidgetAiService` или старые OpenAI adapters;
- старый snapshot и его builder отсутствуют, current catalog load проходит;
- current model-turn/catalog tests, public-intake integration tests,
  `npm run eval:widget-ai:offline`, `npm run typecheck:api`, architecture check
  и `git diff --check` проходят;
- `git diff --stat` показывает ожидаемое существенное уменьшение, а не замену
  legacy новой параллельной реализацией.

### Начальная команда агенту

```text
Выполни только LGC-02 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
После свежего consumer analysis удали grounded-контур и старый catalog
knowledge snapshot. Текущий catalog-index и model_turn_v1 не трогай.
```

## 8. LGC-03 — один исполняемый model-turn path

### Один результат

`RecordedLiveV2TurnService` без selector и default branch всегда вызывает
`executeModelTurn`; legacy candidate orchestrator больше не исполняем.

### Область

- тестом зафиксировать current execution без передачи selector;
- удалить `turnContract` из options и production assembly;
- удалить union `RecordedPipelineOutcome` и ветвления terminal/evidence
  projection, нужные только legacy outcome;
- после свежего references analysis удалить `live-v2-orchestrator.ts`,
  `live-v2-validator.ts`, старый `assets/prompt.v1.ts`, apply-plan helpers и
  legacy tests, если они больше не имеют current consumers;
- сохранить общие facts, gate, observation, run recording и типы, которые
  реально используются `model_turn_v1`.

Не путать internal selector `turnContract` с persisted/public metadata
`turn_contract: "granit_model_turn.v2"`: второй удаляется только при отдельном
доказательстве и не входит в автоматическую замену по имени.

### Критерии успеха

- `RecordedLiveV2TurnServiceOptions` не содержит selector;
- в production source нет `legacy_live_v2_candidate` и вызова
  `executeLiveV2Turn`;
- service tests покрывают reply, search/tool failure, safe fallback, no-reply,
  gate block, persistence failure и replay;
- current model-turn, recorded-turn, runtime integration, PostgreSQL invariant,
  typecheck и architecture checks проходят;
- Reviewer подтверждает, что run/evidence semantics не потеряли ветку current
  model-turn и false-green legacy tests удалены.

### Начальная команда агенту

```text
Выполни только LGC-03 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Удали internal turnContract и legacy candidate execution. Сохрани persisted
compatibility и поведение model_turn_v1 без prompt/model изменений.
```

## 9. LGC-04 — удалить мёртвый validation tail из intake

### Один результат

`PublicWidgetIntakeService` больше не содержит недостижимый старый candidate
validator и не импортирует legacy policy/prompt/knowledge только ради него.

### Область

- удалить `validateAiReplyCandidate` и весь транзитивно мёртвый набор helpers,
  constants и imports ниже active use cases;
- удалить ставшие недостижимыми `PublicWidgetAiReplyGenerator` compatibility
  fixtures только после проверки PostgreSQL/runtime tests;
- не менять active history, acceptance, job processing, manager-review или
  recorded-turn mapping.

### Критерии успеха

- у удаляемых symbols нет callers до изменения;
- файл не импортирует `APPROVED_WIDGET_KNOWLEDGE_VERSION`,
  `WIDGET_AI_POLICY_VERSION` и `WIDGET_AI_PROMPT_VERSION`;
- public intake, history v2, worker и PostgreSQL invariant tests проходят;
- response bodies, fallback reasons и manager-review transitions не меняются;
- typecheck, modular-boundary test и `git diff --check` проходят.

### Начальная команда агенту

```text
Выполни только LGC-04 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Удали доказанно мёртвый validateAiReplyCandidate tail и удерживаемые им
legacy imports. Active intake behavior не рефактори в этом срезе.
```

## 10. LGC-05 — active-write и historical-read типы

### Один результат

Компилятор не позволяет создать новую AI run с удалённым runtime/profile, но
репозиторий продолжает читать и replay-ить исторические строки без migration.

### Целевое разделение

```ts
type ActiveRuntimeMode = "direct_openai";
type HistoricalRuntimeMode = "direct_openai" | "mastra_openai_api";

type ActiveDecisionProfile = "live_v2";
type HistoricalDecisionProfile = "legacy_s05" | "live_v2";
```

Названия уточняются по локальным conventions. Смысл обязателен: write input
узкий, persisted read model широкий. Значения `grounded_v1` и
`native_grounded`, если они живут в других historical колонках/contracts,
получают такое же разделение только в своей boundary.

### Область

- write DTO для `beginOrReplay` и новых записей;
- repository row/read/replay mapping;
- sanitizer и observability types, если они читают historical records;
- compile-time и repository tests на запрет новых legacy значений и чтение
  старых.

### Вне области

- migration, constraint cleanup и переписывание данных;
- удаление старых литералов из migration history;
- изменение public API.

### Критерии успеха

- production write sites компилируются только с active values;
- fixture с историческим runtime/profile читается и terminal replay не падает;
- migration reconciliation остаётся зелёным;
- typecheck, AI run repository tests и DB integration checks проходят;
- Reviewer подтверждает отсутствие небезопасного cast, который снова расширяет
  write boundary.

### Начальная команда агенту

```text
Выполни только LGC-05 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Раздели active-write и historical-read AI runtime/profile types без migration
и без удаления исторических DB значений.
```

## 11. LGC-06 — разделить активные coordinators

Это два последовательных среза. Их не выполнять одним diff.

### LGC-06A — `PublicWidgetIntakeService`

Один результат: public history, message acceptance и AI job processing имеют
явных владельцев в соседних модулях, а исходный god-class остаётся тонким
facade/composition boundary либо исчезает.

Рекомендуемые ownership seams:

- history v1/v2 projection и polling decision;
- public message acceptance/idempotency response;
- claimed AI job processing и recorded-turn response mapping;
- manager-review transition.

Characterization tests фиксируют public bodies и transitions до переноса.
Новая самостоятельная функциональность не добавляется. Цель — каждый новый
исходный файл до 500 строк, жёсткий предел 800 строк.

### LGC-06B — `RecordedLiveV2TurnService`

Один результат: orchestration AI run отделена от чистых completion/evidence
projections и persistence fencing.

Рекомендуемые ownership seams:

- coordinator model-turn execution;
- pure outcome-to-terminal-state/evidence projection;
- model observation/usage aggregation;
- completion/fence adapter.

Тесты должны сравнивать terminal status, normalized action, failure/validator
codes, spans, quality events, usage и persisted reply для тех же fixtures до и
после переноса.

### Общие критерии успеха

- public/runtime behavior не меняется;
- зависимости направлены от coordinator к pure helpers/ports, без mutable
  global state и циклов;
- новые файлы укладываются в лимиты;
- targeted characterization, integration, typecheck, modular-boundary и
  architecture checks проходят;
- для каждого под-среза выполнен отдельный self-review и read-only Reviewer.

### Начальная команда агенту

```text
Выполни только LGC-06A (или только LGC-06B) из
docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md. Сначала добавь characterization
evidence, затем раздели один указанный coordinator без изменения поведения.
```

## 12. LGC-07 — разделить transaction-scoped persistence

Это два независимых высокорисковых среза; порядок между ними определяется
свежим blast-radius preflight. Не выполнять их параллельно или одним diff.

### LGC-07A — Postgres intake repository

Один результат: 5143-строчный repository разделён на transaction-scoped
helpers по существующему domain ownership, сохраняя единый transaction owner
для атомарных операций.

Возможные seams после свежего call graph:

- public intake/session/history reads;
- widget message sequence/window/job queue;
- AI reply commit fence и slot/requirement projection;
- manager takeover/control;
- row mapping и shared SQL invariants.

Нельзя дробить одну атомарную транзакцию между независимо коммитящими
repositories. Helpers получают явный transaction/client параметр.

### LGC-07B — Postgres AI run repository

Один результат: begin/replay, attempt fence/finalization, evidence writes и row
mapping имеют отдельные transaction-scoped модули при прежнем публичном port.

Обязательные invariants:

- begin-or-replay identity;
- один terminal completion;
- stale/exhausted/superseded attempt fencing;
- атомарность run/job/reply completion;
- evidence относится к правильному attempt/run;
- replay исторических runtime/profile значений.

### Общие критерии успеха

- сначала зафиксированы существующие PostgreSQL concurrency/fault cases;
- SQL semantics, lock order и transaction boundaries доказанно не изменены;
- targeted real-Postgres tests запускаются последовательно и проходят;
- typecheck, migration reconciliation, public-intake smoke и architecture
  checks проходят;
- Reviewer отдельно фокусируется на concurrency, idempotency, stale state,
  partial failure и false-green memory tests.

### Начальная команда агенту

```text
Выполни только LGC-07A (или только LGC-07B) из
docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md. Сохрани transaction ownership и
SQL semantics; докажи реальными PostgreSQL tests, что behavior не изменился.
```

## 13. LGC-08 — reachability-based architecture guard

### Один результат

Зелёный architecture check доказывает, что production roots достигают только
текущего AI runtime, а запрещённый legacy path нельзя незаметно вернуть.

### Область

- строить проверяемый dependency graph от production roots и assembly paths;
- учитывать static imports/exports, workspace entrypoints и явно объявленные
  runtime asset reads;
- завести минимальный explicit allowlist для compatibility re-export roots и
  historical persisted literals;
- запретить edges к удалённым legacy orchestrator/provider/verifier/eval
  namespaces из production graph;
- отдельно проверять eval roots: они должны достигать current model-turn;
- document guard должен проверять один active route и допустимые statuses, а не
  превращать hashes всех task-файлов в authority;
- сохранить точечные policy checks, которые реально защищают принятые ADR.

Сначала проверить возможности установленного Node/TypeScript stack. Новая
dependency или обновление lockfile допустимы только при доказанной
необходимости и отдельном обосновании в текущем task.

### Обязательные mutation tests guard-а

- production import legacy orchestrator делает check красным;
- eval import старого grounded service делает check красным;
- удалённый, но недостижимый source не считается production runtime;
- current `catalog-index.v1.json`, загружаемый через `readFile`, учтён как asset;
- compatibility re-export вне allowlist делает check красным;
- historical migration literal не считается executable legacy path;
- вторая active-card или replaced document в active route делает check красным.

### Критерии успеха

- старые blanket `source_count/source_contents_sha256/task_count` hashes
  удалены либо перестали быть основанием утверждения о runtime reachability;
- все mutation tests сначала красные на соответствующей поломке и зелёные
  после исправления guard;
- `npm run check:architecture`, guard unit tests, typecheck и `git diff --check`
  проходят;
- Reviewer подтверждает отсутствие ложного исключения current runtime asset и
  ложного зелёного результата при возврате legacy edge.

### Начальная команда агенту

```text
Выполни только LGC-08 из docs/AI_LEGACY_CLEANUP_REFACTOR_TASKS_RU.md.
Замени blanket hash guard доказательством reachability и forbidden legacy
edges. Добавь mutation tests, включая readFile catalog asset.
```

## 14. Финальная проверка программы

Она выполняется отдельной owner-командой после принятия LGC-00—08 и ничего не
рефакторит.

Проверить:

1. свежий production graph от roots до provider, catalog и persistence;
2. свежий eval graph до того же `executeModelTurn`;
3. отсутствие удалённых symbols, files, scripts и package entrypoints;
4. сохранность historical DB read/replay boundary;
5. targeted current model-turn/catalog/intake/recorded-run/PostgreSQL tests;
6. `npm run check:architecture`, `npm run typecheck`, релевантный smoke и
   offline eval;
7. полный self-review accumulated diff range по отдельным принятым срезам;
8. независимый read-only review на false-green, persistence и legacy edges.

После этой проверки можно ставить отдельную задачу на качество AI: собрать
плохие диалоги и run evidence, проверить verbosity/fallback/prompt/model и
менять поведение только с новым baseline eval. Такая задача не является частью
legacy cleanup.
