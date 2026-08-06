# Карточка среза AI-RUNTIME-CONVERGENCE: CONV-5 — anti-clutter guardrails

Статус: `accepted`; redesign Архитектора реализован как закрытый
machine-contract + reviewed closure/allowlist и принят свежим независимым
Reviewer без замечаний.

Goal: `AI-RUNTIME-CONVERGENCE`.

Позиция в roadmap: финальный технический срез после independently accepted и
опубликованного CONV-4, перед общим teach-back.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`d3f9cbd2213ec60bba3953c43f212aa307fd8175` /
тот же SHA до изменений CONV-5.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier интерфейсом
сессии не раскрыт.

## 1. Один результат

Одна локальная команда, включённая в обычный build path, детерминированно
останавливает возврат второго AI runtime и разрастание active AI routing при
исполнении этого entrypoint, а её негативные self-tests доказывают, что проверки
не являются false-green. Неизменяемое внешнее принуждение самого entrypoint не
заявляется результатом repo-local среза.

CONV-4 опубликован обычным fast-forward в `origin/main` commit
`d3f9cbd2213ec60bba3953c43f212aa307fd8175`; поэтому CONV-5 начинается как
отдельный diff на чистом tracked tree.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| Base/head/origin | `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175` |
| Tracked dirty | 0 файлов до создания этой карточки |
| Runtime assembly | один app-owned direct live-v2 executor, без runtime selector |
| Existing architecture tests | `apps/api/test/modular-boundaries.test.ts` уже проверяет single assembly, отсутствие Mastra import и production imports из compatibility paths |
| CI surface | отдельного workflow-каталога нет; корневой `build` — проверяемый repo-local entrypoint, а immutable CI/branch-protection enforcement находится вне среза |
| Active docs | одна опубликованная CONV-4 card должна уступить active routing этой карточке |

Источники истины:

1. `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md`, раздел CONV-5;
2. ADR-010, ADR-012 и `docs/source-of-truth.md`;
3. current `package.json`, production assembly и modular-boundary tests на base;
4. ADR-009 для уже принятой compatibility-export policy.

## 3. Область и исключения

Разрешено:

- добавить deterministic repo-local architecture guard и его негативные tests;
- добавить versioned machine-readable architecture contract с точными
  production/document/compatibility baselines;
- добавить явную npm-команду и включить её в обычный `build`;
- проверять active AI-card statuses и active-doc authority;
- проверять package/production assembly на Mastra dependency/import и второй
  runtime selector;
- заморозить точный baseline 20 direct compatibility exports и их targets;
- сохранять обязательные migration/concurrency/send-gate evidence tests через
  точные содержательные sentinels, а не только имя файла;
- переключить active routing/state с опубликованной CONV-4 на CONV-5, удалить
  завершённую CONV-4 card после записи её commit/review provenance в archive.

Ориентир области:

```text
tooling/ai-architecture-guardrails.mjs
tooling/ai-architecture-guardrails.test.mjs
tooling/ai-architecture-contract.json
package.json
.agents/state/granit-dev-workflow.json
docs/source-of-truth.md
docs/tasks/README.md
docs/tasks/ARCHIVE_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md
docs/tasks/AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md
docs/tasks/AI_REF_CONV_4_ACTIVE_DOCUMENTATION_RU.md (retire/delete)
```

Machine-contract — единственный добавленный к исходному ориентиру файл. Это
объяснённое Архитектором расширение необходимо для закрытого reviewed baseline
и обязательно проверяется Reviewer.

Явно вне области:

- production behavior, prompt/model/tools/policy/privacy/send gate/takeover;
- schema/migrations/public contract;
- удаление или переписывание существующих evidence tests;
- CI provider/deploy config, secrets, внешние repo/links/calls;
- изменение исторических storage compatibility values;
- `output/`.

## 4. Критерии успеха

- [x] Не более одной `AI_REF_*` card имеет status `implementing` или
  `independent_review`.
- [x] Active AI docs не ссылаются на retired external planning authorities.
- [x] Package manifests/lock и production imports не возвращают
  `@mastra/core`.
- [x] Production assembly/config не получает альтернативный runtime selector
  без существующего accepted ADR.
- [x] Exact baseline содержит только текущие 20 direct compatibility exports и
  их targets; новый shim, alias-hop, hollow consumer и blanket ADR-009 не
  расширяют baseline без явного reviewed rebaseline.
- [x] Обязательные migration/concurrency/send-gate evidence tests существуют и
  содержат проверяемые sentinels; их удаление/опустошение делает guard красным.
- [x] Негативные self-tests отдельно делают красной каждую категорию guardrail.
- [x] Guard запускается отдельной npm-командой и из обычного `npm run build`;
  simultaneous removal самого invocation boundary остаётся внешней review/CI
  границей, а не самозащищающимся свойством repo-local кода.
- [x] Применимые architecture tests, typecheck/build и `git diff --check`
  проходят.
- [x] Свежий независимый Reviewer выполняет Code Scout и выдаёт `accept`.

## 5. Риски, evidence и rollback

Риски: слишком широкий string scan заблокирует historical compatibility;
слишком узкий scan пропустит второй assembly; ADR exception станет пустой
лазейкой; self-test проверит собственную реализацию не тем входом, который
использует CLI. Поэтому guard использует один общий evaluator для CLI/tests,
явный active-doc manifest, проверяет accepted status ADR и имеет негативный
fixture для каждой ветки.

Обязательные проверки:

- guard positive run и негативный self-test suite;
- существующий modular-boundaries test;
- typecheck и build;
- проверка scope/changed files и `git diff --check`;
- свежий независимый Reviewer с callers, failure paths, compatibility consumers,
  selector escape paths, privacy и false-green tests.

Непроверено до реализации: поведение guard в стороннем CI runner и immutable
enforcement самого npm entrypoint. Это потребовало бы отдельного изменения
внешней CI/branch-protection конфигурации, явно исключённого из среза. Network,
runtime/PostgreSQL/model calls не требуются и не выполняются.

Rollback до/после публикации — удалить/revert только CONV-5 guard/docs diff;
runtime/schema rollback не нужен. Guard обязан fail-closed при unreadable или
отсутствующем обязательном файле.

## 6. Первая независимая проверка и repair

Fresh independent Reviewer: session
`019fd53b-f7ee-7571-9750-94514e511f3b`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`7b128823c27453d2dceaf896c65aa275350d2e7d64c40ac756c87d8704b0118c`.
Verdict: `changes_requested`.

Reviewer воспроизвёл девять классов проблем: второй active plan вне
`AI_REF_*`; generic selector и `src/build` escape; ADR-010 как ложное
разрешение; hollow/`it.each` evidence; no-op build wiring; template-literal
Mastra import; AST/extension/ADR ошибки compatibility shim; direct-input
symlink и незакрытый fence; неполный CONV-4 review provenance в archive.

Repair остался внутри CONV-5: все девять пунктов закрыты строгим task-route
manifest, общим AST selector/import/consumer scan, явной machine-readable ADR
approval, reviewed SHA-256 evidence, точным npm wiring, fail-closed input/fence
validation и archive provenance. Production/schema/migrations/public contracts
и сами evidence tests не менялись.

## 7. Technical done Исполнителя после первого repair

Итог на неизменившейся опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `59827549cb563097cc876a47ac6a6a87cdb521fb47ca316c5720d6030692f047`;
- полный diff: `11 files changed, 1159 insertions(+), 366 deletions(-)` — два guard-файла, `package.json`,
  active routing/state, новый CONV-5 record, CONV-4 archive provenance и
  удаление опубликованной CONV-4 card;
- guard имеет `582` строки, negative self-tests — `305` строк;
- production/schema/migration/public-contract/test evidence files не изменены.

Проверки после repair:

- `npm run check:architecture` — positive repo scan green: одна AI-card,
  140 production sources, 20 compatibility exports; negative self-tests `14/14`;
- self-tests отдельно воспроизводят все технические false-green замечания, включая generic
  `AI_ENGINE`, запрещающий ADR-010, hollow/parameterized evidence, no-op scripts,
  template import, comment/MJS consumer, direct symlink и unclosed fence;
- CONV-4 review provenance отдельно сверено по session/verdict/fingerprint в
  archive;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` — `14/14`;
- `npm run build` — guard `14/14`, API source/packages и 43 API test typecheck,
  manager typecheck и Vite build green (`2476` modules);
- `git diff --check` green; exact stable fingerprint и scope пересчитаны.

Прямое влияние: local/build architecture validation и active AI routing.
Косвенное влияние: второй runtime/selector, новый active plan, необоснованный
compatibility shim или изменение reviewed PostgreSQL evidence остановит build с
точным reason code.

Непроверено: сторонний CI runner, внешние links/repo и полный runtime/PostgreSQL
suite; production/runtime/schema не менялись, поэтому model/DB calls и deploy не
выполнялись. `output/` не читался, не перечислялся и не затрагивался.

Rollback: revert только этот CONV-5 diff; runtime/schema/data rollback не нужен.
Вердикт Исполнителя: `technical_done`; author не принимает собственную работу.

## 8. Вторая независимая проверка и repair

Новый fresh independent Reviewer: session
`019fd54d-6289-7530-a4ec-84511b432b27`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`59827549cb563097cc876a47ac6a6a87cdb521fb47ca316c5720d6030692f047`.
Verdict: `changes_requested`.

Reviewer воспроизвёл ещё пять false-green классов: generic `AI_PROVIDER`
selector и новый entrypoint из `src/build`; форматированный status и обычную
Markdown-ссылку на второй active plan; сокращение build до одного guard;
вычисляемый Mastra import и `.mts` compatibility shim; четырёхсимвольный
opening fence с трёхсимвольным closing fence.

Второй repair остался в том же срезе и scope. Guard теперь проверяет hash
reviewed runtime assembly, точную полную build-chain, все применимые
TS/JS-модульные расширения, статически вычислимые import specifiers, любой
Markdown `.md` reference в active route, форматированные statuses и
Markdown-совместимую длину closing fence. Каждый воспроизведённый обход получил
отдельный негативный self-test; production и evidence tests не менялись.

## 9. Technical done Исполнителя после второго repair

Итог на неизменившейся опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `9334626a6de14a8e1f07af3a259bbb58a3cd730426cf3c0f91643bd234b3b2c8`;
- полный diff: `11 files changed, 1359 insertions(+), 366 deletions(-)`; два
  guard-файла, `package.json`, active
  routing/state, новый CONV-5 record, CONV-4 archive provenance и удаление
  опубликованной CONV-4 card;
- guard имеет `638` строк, negative self-tests — `380` строк;
- production/schema/migration/public-contract/evidence-test files не изменены.

Финальные проверки после второго repair:

- `npm run check:architecture` — repo scan green: одна AI-card,
  140 production sources, 20 compatibility exports; negative self-tests
  `15/15`;
- self-tests воспроизводят все пять замечаний второго Reviewer в дополнение к
  девяти прежним классам;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `14/14`;
- точный `npm run build` — guard `15/15`, bounded API source/packages и 43 API
  test typecheck, manager typecheck и Vite build green (`2476` modules);
- `git diff --check` и parse state JSON green; exact stable fingerprint и scope
  пересчитаны.

Прямое и косвенное влияние, непроверенные области и rollback не изменились
относительно раздела 7. `output/` не читался, не перечислялся и не
затрагивался. Вердикт Исполнителя: `technical_done`; author не принимает
собственную работу.

## 10. Третья независимая проверка и repair

Третий fresh independent Reviewer: session
`019fd55c-67f4-7dc1-b909-42d07da3482b`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`9334626a6de14a8e1f07af3a259bbb58a3cd730426cf3c0f91643bd234b3b2c8`.
Verdict: `changes_requested`.

Reviewer подтвердил все прежние классы и нашёл три оставшихся проблемы:

1. aliased `process.env.AI_CHOICE` и два `*Client` в транзитивно импортируемом
   adapter обходили selector guard без изменения пяти assembly-файлов;
2. допустимое сочетание долгоживущей Goal `implementing` и active card
   `independent_review` ложно давало `AI_CARD_LIMIT`, а synthetic fixture не
   повторял реальный loader;
3. `updated_at` machine state регрессировал относительно опубликованной базы.

Третий repair добавил AST-связь runtime-choice source/alias с разными
runtime/client targets, ограничил status accounting AI-планами с явным
исключением долгоживущей Goal, приблизил passing fixture к реальному loader и
сделал state timestamp монотонным. Отдельные negative/positive regression tests
покрывают aliased `AI_CHOICE`, `settings.aiProvider`, lifecycle
Goal/card и не-AI operations task.

## 11. Technical done Исполнителя после третьего repair

Итог на той же опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `6a87b2b10dd229b146dbf1ceb761335469d79a9995d8bb4cdd3cdaccefc5e013`;
- полный diff: `11 files changed, 1527 insertions(+), 366 deletions(-)`;
- guard имеет `701` строку, negative/positive self-tests — `417` строк;
- scope остаётся теми же 11 файлами; production/schema/migration/public
  contract/evidence tests не изменены.

Проверки после третьего repair:

- `npm run check:architecture` — одна AI-card, 140 production sources,
  20 compatibility exports, self-tests `16/16`;
- реальный guard принимает `Goal: implementing + card: technical_done`, а
  fixture отдельно принимает `Goal: implementing + card: independent_review`
  и отвергает второй AI-plan;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `14/14`;
- точный `npm run build` — guard `16/16`, bounded API source/packages и 43 API
  test typecheck, manager typecheck и Vite build green (`2476` modules);
- `git diff --check` и state JSON parse green.

Прямое/косвенное влияние, непроверенные области и rollback остаются как в
разделе 7. `output/` не читался, не перечислялся и не затрагивался. Вердикт
Исполнителя: `technical_done`; author не принимает собственную работу.

## 12. Четвёртая независимая проверка и repair

Четвёртый fresh independent Reviewer: session
`019fd568-c5e2-7321-989c-a5b9f186b390`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`6a87b2b10dd229b146dbf1ceb761335469d79a9995d8bb4cdd3cdaccefc5e013`.
Verdict: `changes_requested`.

Reviewer независимо подтвердил прежнюю матрицу и нашёл три эквивалентных
escape path:

1. destructuring и multi-hop aliases runtime choice, а также нейтральные имена
   targets обходили detector;
2. второй семантический AI-plan с heading `AI model runtime plan`, но без
   отдельного `AI` token в filename, не участвовал в status accounting;
3. active source map мог объявить новый authority document, содержимое которого
   не входило в active external-authority scan.

Четвёртый repair замыкает runtime-choice aliases до fixpoint, распознаёт
destructured env/settings keys и считает сам факт conditional/switch по такому
choice selector-ом независимо от имён targets. AI-task classification теперь
учитывает semantic heading/model-runtime-plan filename и требует, чтобы каждый
active status принадлежал единственной indexed card. Loader читает Markdown
дерево, а active scan рекурсивно следует только по строкам, явно объявляющим
current/active/authority source; historical ссылки не становятся active
автоматически.

## 13. Финальный technical done Исполнителя

Итог на той же опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `4ffbb9a56e5ce855078fc57475fa4940f74d0caeb0b08133e56781616c10b822`;
- полный diff: `11 files changed, 1753 insertions(+), 366 deletions(-)`;
- guard имеет `808` строк, self-tests — `465` строк;
- scope остаётся теми же 11 файлами; production/schema/migration/public
  contract/evidence tests не изменены.

Проверки после четвёртого repair:

- `npm run check:architecture` — одна AI-card, 140 production sources,
  20 compatibility exports, self-tests `16/16`;
- отдельная real-loader mutation matrix даёт `RUNTIME_SELECTOR` для neutral,
  destructured env/settings и multi-hop aliases, `AI_CARD_LIMIT` для semantic
  plan и `ACTIVE_EXTERNAL_AUTHORITY` для authority indirection;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `14/14`;
- точный `npm run build` — guard `16/16`, bounded API source/packages и 43 API
  test typecheck, manager typecheck и Vite build green (`2476` modules);
- `git diff --check` и state JSON parse green.

Прямое/косвенное влияние, непроверенные области и rollback остаются как в
разделе 7. `output/` не читался, не перечислялся и не затрагивался. Вердикт
Исполнителя: `technical_done`; author не принимает собственную работу.

## 14. Пятая независимая проверка и repair

Пятый fresh independent Reviewer: session
`019fd57a-6b14-75c0-9bf4-4ea0aef7899b`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`4ffbb9a56e5ce855078fc57475fa4940f74d0caeb0b08133e56781616c10b822`.
Verdict: `changes_requested`: три high, три medium и один low, blocker нет.

Reviewer воспроизвёл selector через indexed lookup и alias контейнера,
proposed ADR с ложным accepted/approval внутри fence, computed Mastra imports
через const/template, natural-language canonical-source indirection и две
дополнительные формы compatibility forwarding. Также он обнаружил, что
evidence ошибочно называла synthetic evaluator mutations real-loader matrix.

Repair добавляет transitive container taint и indexed selector usage,
fail-closed unresolved dynamic import плюс const/template resolution, единый
top-level ADR metadata parser вне fences/blockquote, ESM import+re-export и CJS
forwarding detection, а также точный machine-readable active-document manifest.
Self-tests теперь содержат настоящий filesystem fixture, проходящий через
`loadRepositorySnapshot` до evaluator. Граница самозащиты npm entrypoint
зафиксирована честно: repo-local код проверяет wiring при запуске, но не может
запретить одновременное удаление собственного вызова без внешнего immutable CI.

## 15. Technical done Исполнителя после пятого repair

Итог на той же опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `01deee5a5e3ef1751300e6d95b1d969d25e8091690b11223444a1555d028422c`;
- полный diff: `11 files changed, 2194 insertions(+), 369 deletions(-)`;
- guard имеет `1014` строк, self-tests — `601` строку;
- scope остаётся теми же 11 файлами; production/schema/migration/public
  contract/evidence tests не изменены.

Проверки после пятого repair:

- `npm run check:architecture` — одна AI-card, 140 production sources,
  20 compatibility exports, self-tests `17/17`, включая filesystem loader;
- все exact reproductions пятого Reviewer теперь красные: indexed/container
  selectors, proposed fenced ADR, const/template и unresolved dynamic imports,
  undeclared canonical authority, ESM/CJS compatibility forwarding;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `14/14`;
- точный `npm run build` — guard `17/17`, bounded API source/packages и 43 API
  test typecheck, manager typecheck и Vite build green (`2476` modules);
- `git diff --check` и state JSON parse green.

Непроверенными остаются сторонний CI runner и immutable external enforcement
npm entrypoint; это честно вынесенная внешняя граница, а не false-green claim.
Прямое/косвенное влияние и rollback остаются как в разделе 7. `output/` не
читался, не перечислялся и не затрагивался. Вердикт Исполнителя:
`technical_done`; author не принимает собственную работу.

## 16. Шестая независимая проверка и repair

Шестой fresh independent Reviewer: session
`019fd58b-e064-7ea2-bede-5c7d67184266`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`01deee5a5e3ef1751300e6d95b1d969d25e8091690b11223444a1555d028422c`.
Verdict: `changes_requested`: два high и два medium, blocker/low нет.

Reviewer подтвердил неизменную базу и scope, все прежние exact reproductions,
positive filesystem scan, evidence hashes, wiring и документированную внешнюю
trust boundary. Новые воспроизводимые замечания:

1. property/element reads из alias `process.env`, включая `.get(choice)`, не
   протягивали runtime-choice taint;
2. lazy-continuation blockquote и HTML comment могли подделать accepted ADR
   metadata;
3. эквивалентные natural-language authority declarations не сверялись с
   machine manifest;
4. двухшаговые ESM/CJS forwarding bindings не классифицировались как
   compatibility exports.

Шестой repair системно расширил AST/dataflow-анализаторы. Runtime detector
протягивает точные container/choice aliases через property и element reads и
проверяет indexed/`.get()`/selector-factory consumption, не tainting обычные
`this.options` expressions. ADR metadata теперь исключает fenced и indented
code, blockquote с lazy continuation и HTML comments. Source-map guard сверяет
все ссылки структурного `## Authority` и директивные authority-строки с
machine manifest. Compatibility detector следует за ESM imports и CJS
`require()` bindings до exported declarations/assignments. Все восемь exact
reproductions Reviewer добавлены в существующие self-tests, в том числе четыре
варианта в реально транзитивном adapter path.

## 17. Technical done Исполнителя после шестого repair

Итог на той же опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `7dfc2d48f4b36261577f59739d0643c4d4dea95116dbaebc91a05668e6c7c0fe`;
- полный diff: `11 files changed, 2512 insertions(+), 369 deletions(-)`;
- guard имеет `1180` строк, self-tests — `674` строки;
- scope остаётся теми же 11 файлами; production/schema/migration/public
  contract/evidence tests не изменены.

Проверки после шестого repair:

- `npm run check:architecture` — одна AI-card, 140 production sources,
  20 compatibility exports, self-tests `17/17`, включая filesystem loader;
- все exact reproductions шестого Reviewer дают соответствующий guard failure,
  а действующий `public-widget-intake-service.ts` остаётся без false-positive;
- `npm test -- apps/api/test/modular-boundaries.test.ts --maxWorkers=1` —
  `14/14`;
- точный `npm run build` — guard `17/17`, bounded API source/packages и 43 API
  test typecheck, manager typecheck и Vite build green (`2476` modules);
- `git diff --check` и state JSON parse green.

Reviewer в read-only sandbox независимо выполнил positive scan и mutation
matrix, но его filesystem fixture и Vitest не могли писать в `/tmp` (`EROFS`);
исполнитель повторил их в рабочей среде. Непроверенными остаются сторонний CI
runner и immutable external enforcement npm entrypoint. Прямое/косвенное
влияние и rollback остаются как в разделе 7. `output/` не читался, не
перечислялся и не затрагивался. Вердикт Исполнителя: `technical_done`; author
не принимает собственную работу.

## 18. Седьмая независимая проверка: needs_redesign

Седьмой fresh independent Reviewer: session
`019fd59d-d7ab-7a62-94c4-c18495d48b58`, модель `gpt-5.6-sol`, reasoning
`high`, fingerprint
`7dfc2d48f4b36261577f59739d0643c4d4dea95116dbaebc91a05668e6c7c0fe`.
Verdict: `changes_requested`: два high и три medium, blocker/low нет.

Reviewer подтвердил SHA/scope/stat/fingerprint, positive scan, assembly и
evidence hashes, отсутствие production/schema/contract diff и текущих
false-positive. В read-only sandbox `16/17` self-tests прошли, единственное
падение — ожидаемый `EROFS` filesystem fixture.

Новые exact reproductions:

1. runtime selector через computed env key и межфайловый choice в реально
   транзитивном adapter path;
2. второй authority через естественную фразу `AI roadmap lives in ...` и второй
   AI-plan со status в HTML `<code>`;
3. unresolved computed CJS `require()`;
4. ESM/CJS forwarding после дополнительного alias hop;
5. skipped/dead-code test import как hollow consumer и новый unconsumed shim в
   blanket scope ADR-009.

Категории selector/dataflow и authority indirection повторились более двух
repair-циклов. Согласно разделам 2 и 6 playbook это `needs_redesign`, а не ещё
одна regex-поправка. До рекомендации Архитектора рабочий код не меняется.

## 19. Архитектурный redesign

Свежий read-only Архитектор: session
`019fd5a7-0756-79d1-8350-673a803ba927`, модель `gpt-5.6-sol`, reasoning
`high`. Architecture verdict: `needs_redesign` подтверждён; рекомендован один
совместимый гибрид A+C — versioned machine-readable architecture contract плюс
reviewed closure/allowlist, без собственного межфайлового dataflow-анализатора.

Сравнённые варианты:

- A, machine-contract без closure: прост, но не замечает второй runtime внутри
  уже разрешённого файла;
- B, полный TypeScript Program/CFG/dataflow: остаётся открытым к higher-order и
  dynamic JS, требует отдельного большого анализатора и не решает Markdown;
- C, reviewed closure/allowlist: закрывает код/shims, но требует отдельного
  документационного machine-contract.

Принятая реализационная рекомендация A+C:

1. versioned contract фиксирует точные production roots и reviewed production
   source closure/digest; изменение файла, edge или path требует явного
   rebaseline, а не угадывания selector semantics;
2. source-map/task route задаются точными machine sets и routing-surface hashes;
   Markdown prose не расширяет authority/lifecycle;
3. ADR-009 покрывает только frozen baseline существующих 20 direct ESM shims и
   exact targets, но не новые файлы;
4. unresolved `import()` и CJS `require()` остаются fail-closed;
5. evidence hashes, exact build wiring и честная внешняя граница mutable npm
   invoker сохраняются.

Acceptance matrix: current contract и `Goal implementing + одна card
independent_review` проходят; computed/cross-file selector, новый entrypoint,
unresolved CJS, natural/HTML second plan, второй active card, undeclared
authority, новый/alias-hop shim, hollow consumer, blanket ADR-009, evidence
drift и wiring drift падают с детерминированным reason code. Любой invalid
contract, unknown field, duplicate, unreadable input или symlink fail-closed.

Stop-gate assessment Архитектора: нового owner stop-gate нет. Рекомендация не
меняет roadmap, ownership, production behavior, schema/migrations, public
contract, prompt/model/tools/policy/privacy/send gate/takeover или внешний CI.

## 20. Передача

Исполнитель реализует зафиксированный redesign в том же срезе. Только новый
`technical_done` передаётся fresh Reviewer. Commit и push запрещены до
`accept`.

## 21. Technical done после архитектурного redesign

Redesign A+C реализован на прежней опубликованной базе:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`;
- stable fingerprint без self-referential card/state:
  `7d9da2f34627e1e8ea26bcc6146d452743624bdc5f865bb1e1b65b2da9eb4ee8`;
- до этой фиксации полный diff: `12 files changed, 3086 insertions(+), 369
  deletions(-)`; новый двенадцатый файл — объяснённый Архитектором
  `tooling/ai-architecture-contract.json`;
- guard — `1430` строк, self-tests — `837`, contract — `75`;
- production/schema/migrations/public contracts/prompts/model/tools/policy,
  privacy/send gate/takeover и существующие evidence tests не изменены.

Machine-contract версии 1 фиксирует 140 production sources с exact path/content
digests, два routing-surface hash, точный набор 21 task document, одну Goal,
одну active card, authority/provenance sets и 20 direct compatibility shims с
exact targets. Semantic checks остаются вторичной диагностикой; закрытый
baseline ловит изменение внутри разрешённого файла и межфайловый обход без
попытки построить собственный TypeScript CFG/dataflow engine.

Выполненные проверки:

- точный `npm run check:architecture` — real scan `1 / 140 / 20`, self-tests
  `19/19`, включая filesystem loader;
- regression matrix воспроизводит computed env key, cross-file selector,
  unresolved computed CJS `require()`, natural roadmap authority,
  `<code>implementing</code>`, alias-hop shim, dead-code consumer и blanket
  ADR-009; все падают с детерминированными reason codes;
- `npx vitest run apps/api/test/modular-boundaries.test.ts` — `14/14`;
- точный `npm run build` — guard `19/19`, bounded API source/packages и 43 API
  test batches, manager typecheck и Vite build green (`2476` modules);
- `git diff --check`, contract/state JSON parse — green.

Прямое влияние ограничено repo-local build/check tooling и active routing docs.
Косвенно любая будущая production/task/compatibility-правка потребует явного
contract rebaseline в том же reviewed diff. Не проверены внешний CI runner и
immutable enforcement npm entrypoint; это остаётся явно указанной внешней trust
boundary. Rollback до публикации — отбросить отделимый CONV-5 diff; после
публикации — обычный revert его commit. `output/` не читался, не перечислялся и
не затрагивался.

Вердикт Исполнителя: `technical_done`. Следующий шаг — только свежий
независимый Reviewer с Code Scout; автор не принимает собственную работу.

## 22. Независимый accept

Свежий независимый Reviewer: session
`019fd5bc-b462-7433-85b4-f34e5cda61bf`, модель `gpt-5.6-sol`, reasoning
`high`, read-only sandbox. Verdict: `accept`; findings уровней
blocker/high/medium/low нет.

Reviewer независимо подтвердил:

- `HEAD == origin/main == d3f9cbd2213ec60bba3953c43f212aa307fd8175`,
  12-файловый scope и fingerprint
  `7d9da2f34627e1e8ea26bcc6146d452743624bdc5f865bb1e1b65b2da9eb4ee8`;
- отсутствие diff в production/schema/migrations/public contracts и двух
  evidence tests;
- real loader baseline: 140 production sources с обоими hashes, 21 task
  document, 20/20 exact compatibility shims;
- полный acceptance matrix через in-memory mutations реального
  `loadRepositorySnapshot()` и production evaluator;
- callers/build wiring, fail-closed failure paths, отсутствие влияния на
  concurrency/FK/migrations/privacy/send gate/manager takeover и совпадение
  evidence hashes.

В read-only sandbox positive scan прошёл, 18 из 19 self-tests прошли напрямую;
filesystem fixture, Vitest и bounded typecheck не смогли создать `/tmp`
(`EROFS`/`ENOENT`) и не дошли до product assertions. Reviewer отделил это от
product failure и принял совпавший fingerprint с independently verified hashes
и зафиксированной Исполнителем полной green build evidence.

CONV-5 принят. Разрешены порученные владельцем понятный русский commit и
обычный push; после публикации Goal автоматически переходит к общему teach-back.
