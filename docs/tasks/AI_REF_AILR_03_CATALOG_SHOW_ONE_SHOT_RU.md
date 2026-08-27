# Карточка среза AI-LAYER-SIMPLIFICATION: AILR-03 — OneShot «покажи каталог»

Статус: `completed`. Карточка закрыта и сохранена как implementation
provenance; она не является active-card и не активирует следующий срез.

Goal: `AI-LAYER-SIMPLIFICATION`.

Позиция в roadmap: четвёртый срез после принятых AILR-00, AILR-01 и AILR-02.
По решению владельца от 2026-08-24 он объединяет ранее запланированные
AILR-03—AILR-06 в один OneShot до состояния, которое после independent
`accept`, отдельного commit/push и отдельного разрешения на deploy можно
проверить на staging.

Координатор / base SHA:
`granit-operations`, ветка `agent/ai-layer-refactor`,
`7bbf68eff23afa88ca756c2bc1ac280c8463fb7e`.

Соседние исходные checkout:

- `landing-granit-static`, ветка `codex/catalog-clean-slate`,
  `9d1710867b53323cbd9b99d6642541c7ddd4ec77`;
- `business-ai-web-widget`, ветка `codex/fix-slow-scroll-jitter`,
  `c44f99637e097a47b3c53099c95d7e8e01701ad8`.

Фактические модели Исполнителя и независимого Reviewer заполняются при
выполнении. Multi-agent, субагенты, Terra и Ultra запрещены.

## 1. Один результат

На зафиксированном ниже реальном сценарии посетитель может написать «покажи»,
получить в ответ одну или несколько кликабельных кнопок с существующими
опубликованными примерами из актуального каталога, нажать кнопку и попасть в
нужную текущую группу каталога с фокусом/подсветкой выбранного объекта. После
навигации в той же вкладке виджет остаётся доступен и восстанавливает тот же
разговор.

При этом:

- ответ не теряется из-за необязательного observability-поля;
- модель не выдумывает объект или URL и выбирает только ID из серверного
  candidate set;
- известное «вертикальный памятник» остаётся в durable model context, даже
  когда ранняя реплика выпала из короткого transcript window;
- «не знаю» расширяет показ вариантов, а не запускает цикл подтверждений;
- stale turn и manager takeover по-прежнему не отправляют ответ;
- public copy не выдаёт обычный автоответ или технический сбой за состоявшийся
  manager takeover.

Почему это следующий срез: AILR-00—02 упростили один runtime и его validator,
но текущий runtime всё ещё получает статический набор из 15 knowledge facts из
старого snapshot, не обращается к актуальному каталогу и требует пустой
`recommendationIds`. Реальный staging-диалог доказал, что именно запрос
«покажи» завершился без ответа, а позднее агент забыл уже известный тип
памятника.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| Operations base/head | `7bbf68eff23afa88ca756c2bc1ac280c8463fb7e` до нового diff |
| Фактический staging code SHA | `b7542d3e0b59b746332f69f81b08a60f30be9599`; `7bbf68e` содержит только deploy evidence/docs |
| Staging URL | `https://preview.granitkr.ru/` |
| Operations worktree | пользовательские untracked `context.md` и `output/`; не читать, не менять |
| Landing worktree | пользовательские untracked `catalog-ux-concept/` и `docs/cms-lite-plan/`; не читать, не менять |
| Widget worktree | на baseline чистый |
| Текущий catalog source | `landing-granit-static/assets/catalog/manifest.md` плюс taxonomy/layout в `catalog.js`; `catalog.html` грузит `catalog.js` |
| Текущий catalog URL state | понимает только `?category=<slug>`; item/group focus отсутствует |
| Текущий widget | уже строго читает и рисует `history.v2.catalog_references`, открывает `_self` и восстанавливает session/history |
| Текущий public action contract | `kind: "catalog_item"`, `entity_id: ent_<hex>`, URL `/catalog.html?section=<slug>&entity=ent_<hex>#block-<slug>` |
| Текущий model context | repository читает 12 сообщений, model view оставляет 7 предыдущих; durable business slot values в model-safe projection не попадают |
| Красный production incident | visitor «покажи»: job `failed`, 3 попытки, `worker_failed`; run `generator_failed/runtime_failure`, `AI observability evidence did not match the storage allowlist` |

Подтверждённые baseline-наблюдения из присланного диалога:

- 10 visitor turns, 9 AI replies, 1 потерянный ответ;
- 7 из 9 ответов снова задают вопрос;
- backend manager handoff/takeover не происходил, хотя public copy обещал
  проверку/ответ менеджера;
- durable state сохранил `monumentType = вертикальный памятник`,
  `size = 100×50`, `desiredTiming = до 15 мая`, `city = москва`;
- model-safe `buildKnownSlots()` передаёт только contact flags,
  `preferredContact` и `city`, поэтому тип памятника оказался забыт;
- точное необязательное observability-поле, отвергнутое sanitizer, не записано.
  По коду вероятный кандидат — provider runtime/response identifier с длинной
  цифровой последовательностью, но это гипотеза, а не установленный факт.

Источники истины по приоритету:

1. текущий код, public contracts, migrations и executable tests трёх exact
   baseline checkout;
2. ADR-010, ADR-011, ADR-012, active Goal и эта карточка;
3. текущий опубликованный catalog index, который будет создан в
   `landing-granit-static`, и его content hash;
4. реальный sanitized transcript fixture и app-owned run/job/attempt evidence;
5. `developing-ai-agents`: bounded context, narrow typed tools, server-owned
   factual validation, deterministic evals и отдельная subjective rubric.

Старый `granit-site-cms`, старый каталог и исторические prompts не являются
источником актуальных catalog facts.

## 3. Точный контракт OneShot

### 3.1. Машиночитаемый каталог

`landing-granit-static` получает отслеживаемый канонический
`assets/catalog/catalog-index.v1.json`. Он становится единственным
машиночитаемым индексом опубликованных карточек и содержит как минимум:

```text
schema_version = "catalog-index.v1"
catalog_version
items[]:
  id = "ent_" + 16 lowercase hex
  title
  category_slug
  group_slug
  asset_path
  asset_revision = 12 lowercase hex из SHA-256 содержимого изображения
  published = true
search_terms[] / material[] только из опубликованного source
```

`catalog_version` детерминированно вычисляется из отсортированных published
records, включая `asset_revision`; ручной version bump при замене media не
требуется.

ID и независимый immutable-ключ явно закрепляются в source manifest один раз,
не зависят от пути, имени или байтов изображения и не переиспользуются для
другого объекта. Их связь хранится в append-only
`catalog-identity-ledger.v1.json`: generator требует присутствия каждой
зарезервированной записи в manifest и совпадения semantic anchor из названия,
категории, подраздела и типа. CI сравнивает итоговый ledger со всеми его
существовавшими версиями в Git. При замене media сохраняются прежние ID, ключ и
anchor, `asset_path` можно изменить, а `asset_revision` пересчитывается из
новых байтов. Снятая позиция остаётся в manifest и ledger как необратимый
`retired`, резервирует идентичность и не входит в published index. Asset до
публикации полностью декодируется через ffmpeg; path traversal и выход через
symlink закрываются.
`catalog.js` читает этот индекс, а не поддерживает параллельную
несогласованную taxonomy. Неполная/невалидная запись не публикуется и не может
стать AI-кандидатом.

`granit-operations` хранит version-pinned read-only snapshot этого же индекса с
`source_repository`, source base SHA, `catalog_version` и SHA-256 canonical
content. Runtime не загружает каталог из сети. Проверка/генератор доказывает,
что vendored snapshot совпадает с landing index. Итоговые commit SHA трёх repo
записываются в publication evidence только после отдельного разрешения на
commit/push.

### 3.2. Retrieval и один model call

Перед единственным обычным model call сервер формирует максимум 8
опубликованных кандидатов:

- если durable slots уже задают тип/материал, кандидаты берутся из этой
  taxonomy;
- если выбор ещё не сделан, берутся детерминированные представители разных
  подходящих групп;
- «не знаю» не очищает уже известный более общий тип и позволяет сравнение;
- пустой/невалидный snapshot даёт пустой candidate set и безопасный текст без
  выдуманных кнопок.

Никакой semantic intent regex не решает, «хочет ли пользователь посмотреть».
Модель получает короткий typed candidate set и сама решает, нужны ли в этом
turn рекомендации. Tool loop, vector service, второй model/verifier call и
runtime network fetch в этом срезе отсутствуют.

Model output сохраняет существующее поле `recommendationIds`, но prompt больше
не требует держать его пустым. Модель может вернуть только ID из exact supplied
candidate set. Validator структурно проверяет subset, уникальность и лимит;
неизвестный ID делает рекомендации непригодными, но не превращает хороший
текст в semantic-regex reject. URL и label модель не генерирует.

Сервер строит из validated IDs `catalog_references`, сохраняет их атомарно с
победившим reply и отдаёт через существующий `site_widget.history.v2`:

```text
kind: "catalog_item"
label: server-owned short label
title: title из pinned snapshot
entity_id: "ent_<hex>"
href: "/catalog.html?section=<category_slug>&entity=<entity_id>#block-<group_slug>"
```

Форма DTO, `history.v2`, `kind` и href grammar не меняются. Category-only DTO в
этом OneShot не добавляется: при широком запросе сервер отдаёт несколько
конкретных опубликованных примеров из разных групп.

### 3.3. Durable context и conversational policy

Model-safe turn view получает bounded/sanitized business slots:

```text
monumentType, material, size, city, cemetery, installation, desiredTiming
```

Raw phone/email/name, `questionSummary` и неизвестные metadata туда не
копируются. Durable/current slot state авторитетнее усечённой истории.

Prompt фиксирует поведение:

- при наличии кандидатов и просьбе показать/посмотреть/сравнить варианты нужно
  продвинуть задачу рекомендациями, а не ещё одной анкетой;
- «не знаю» означает допустимость сравнения, а не просьбу подтвердить ещё раз;
- нельзя снова спрашивать или объявлять сбор уже известного slot;
- цена, наличие, срок изготовления и монтажа не выдумываются из catalog index;
- validator проверяет IDs и объективную структуру, но не угадывает намерение,
  тон или смысл русского текста regex-эвристикой.

### 3.4. Observability не блокирует полезный ответ

Required app-owned run/job/attempt identity и обязательное evidence продолжают
fail closed. Для необязательных provider-specific identifiers вводится узкая
typed validation:

- валидное значение сохраняется в разрешённой форме;
- невалидное необязательное значение отбрасывается;
- вместо raw value пишется только безопасный code/stage/field class;
- отбрасывание необязательного значения не делает reply unsendable;
- raw provider identifier, prompt, customer text и PII не попадают в
  observability.

Обязателен regression с fake provider identifier, содержащим не менее семи
цифр подряд: reply и job успешно фиксируются, raw identifier нигде не
сохраняется, безопасная причина указывает stage/field class. Если выяснится,
что incident вызван обязательным evidence или исправление требует migration,
Исполнитель останавливается с `needs_human_decision`, а не ослабляет fail-closed
границу.

### 3.5. Landing navigation и widget

Landing разбирает только строгие `section`, `entity` и `#block-*`, находит
`entity` в каноническом индексе и сам выводит его реальные category/group.
Валидная ссылка:

1. открывает актуальную категорию и группу;
2. прокручивает к карточке;
3. даёт ей доступный, временный визуальный focus/highlight;
4. не исполняет произвольный selector/URL из query;
5. при неизвестном ID безопасно показывает каталог без ложной карточки.

Навигация остаётся `_self`. Widget сохраняет свой session identifier/UI state и
после загрузки восстанавливает transcript из backend `history.v2`. Старый
каталог не возвращается, существующая новая верстка не заменяется. В
`business-ai-web-widget` меняются только совместимость/тесты или bundle,
необходимые для этого exact контракта; если текущий код уже соответствует
контракту, отсутствие production diff в widget repo допустимо при доказанном
browser acceptance.

Обычный AI reply не сопровождается обещанием, что менеджер уже забрал диалог.
Текст о менеджере разрешён только для фактического handoff/takeover либо честно
названного fallback-состояния. Техническая ошибка не маскируется как handoff.

## 4. Реальный transcript eval

Сценарий сохраняется как sanitized development/adversarial fixture без
production IDs, контактов и raw trace:

```text
1. Покажи варианты памятников
2. вертикальный
3. пока не знаю
4. покажи
5. Сколько стоит памятник 100×50? Нужно установить до 15 мая
6. москва
7. не знаю пока
8. не знаю
9. да
10. какие есть
```

Eval не сравнивает ответы с одной «золотой» формулировкой. Он проигрывает
состояние и проверяет результат каждого turn. Baseline до изменения:

```text
show task success: 0
catalog action rate: 0
silent/technical failure: 1 из 10 visitor turns
clarification ratio: 7 из 9 replies
forgot/re-asked known monument type: 1
backend handoff/takeover: 0
misleading manager copy: присутствует
```

Deterministic eval обязан доказать:

- каждый релевантный show turn при непустом candidate set получает минимум
  одну server-verified `catalog_reference`;
- ни один ID не выходит за exact candidates и pinned published snapshot;
- optional observability rejection не создаёт `worker_failed` и silent reply;
- известный `monumentType` не теряется и не спрашивается повторно;
- size/timing/city и остальные patches сохраняются;
- «не знаю» не порождает повторный yes/no loop;
- отсутствует ложный handoff/takeover;
- latest-wins, response window, lease loss и настоящий manager takeover всё
  ещё отсекают устаревший outbound;
- deep link открывает и подсвечивает правильный current item;
- widget session/transcript переживает `_self` navigation и reload.

Subjective rubric для свободного текста оценивается отдельно:

1. выполнено первичное намерение;
2. есть прогресс, нет questionnaire loop;
3. известные факты не забыты;
4. коммерческая формулировка безопасна;
5. не выдуманы объект, цена, наличие или срок.

Release metric: transcript task success пройден, все safety/factual veto равны
нулю. Повторный live/paid eval не запускается без отдельного owner budget gate.
При таком разрешении одна и та же конфигурация прогоняется минимум пять раз, а
неудачный прогон не усредняется.

## 5. Область и внутренние checkpoints

Разрешены необходимые production/test/docs изменения в:

- `granit-operations`: model-safe context, prompt, typed catalog snapshot,
  retrieval, model contract/validator, persistence/history projection,
  observability sanitizer/diagnostics, deterministic/PostgreSQL/integration
  evals;
- `landing-granit-static`: canonical catalog index, загрузка текущего каталога,
  strict deep-link resolver, focus/highlight и browser tests;
- `business-ai-web-widget`: только exact `history.v2` action compatibility,
  session restoration, browser tests и необходимый distributable artifact.

Внутренний порядок, не допускающий частичного `Done`:

A. зафиксировать exact base SHA/content hashes, contract fixtures и красный
baseline;
B. устранить optional-observability failure и вернуть bounded business slots в
model-safe context;
C. создать versioned catalog index/snapshot, bounded retrieval, validated IDs
и атомарные history actions;
D. реализовать landing deep-link/focus и подтвердить widget compatibility;
E. прогнать transcript eval, failure/concurrency tests и cross-repo browser
acceptance;
F. передать exact multi-repo payload свежему независимому Reviewer с Code
Scout; после `accept` остановиться до owner-команды на commit/push/deploy.

Ожидаемый размер diff — ориентир до 900 production/test lines суммарно в трёх
repo без generated catalog data. Превышение объясняется в карточке и отдельно
проверяется Reviewer. Жёсткий file allowlist не задаётся: это cross-repo
high-cohesion slice, но Исполнитель обязан до кода записать предполагаемые
модули и не расширять результат за пределы раздела 1.

Явно вне области:

- второй runtime, второй model/verifier call, agent tool loop или write tools;
- vector DB/service, runtime fetch каталога по сети;
- model-generated URL/label или принятие ID вне candidate set;
- новая DB schema/migration;
- `history.v3`, новый public DTO или category-only action;
- изменение send gate, latest-wins, response-window или manager-takeover
  semantics;
- возврат старого каталога, редизайн current landing/widget;
- raw traces/PII, изменение retention/privacy;
- production deploy, secrets/runtime config или платные вызовы;
- чтение/изменение перечисленных пользовательских untracked paths.

## 6. Критерии успеха

- [ ] Один exact published index является authority и byte/content-hash
  совпадает с vendored operations snapshot.
- [ ] Один model call получает не более 8 typed candidates и bounded durable
  slots; URL в model input/output отсутствуют.
- [ ] Recommendation IDs принимаются только как subset supplied candidates;
  server строит существующий `history.v2` action.
- [ ] Reply, validated references, state patches, run/attempt и terminal job
  фиксируются одним winning atomic commit; stale/lease-lost/takeover ничего не
  отправляют.
- [ ] Fake optional provider ID с длинными цифрами не валит reply и не
  сохраняется raw; required evidence остаётся fail closed.
- [ ] Transcript eval выполняет все deterministic assertions и фиксирует
  before/after metrics.
- [ ] Browser test проходит путь widget button → current catalog item focus →
  widget/history restore в той же вкладке.
- [ ] Empty/invalid catalog, unknown entity, unknown recommendation ID,
  duplicate ID/path, malformed query и missing asset покрыты negative tests.
- [ ] Замена пути и байтов изображения сохраняет существующие `entity_id` и
  immutable-ключ, меняет `asset_revision`; malformed/deleted tombstone,
  изменение append-only ledger, повреждённый media и symlink-выход отклоняются,
  а декодируемость media проверяется полным проходом реального decoder.
- [ ] Targeted tests, PostgreSQL runtime invariants, typecheck, build,
  architecture guard, cross-repo tests и `git diff --check` проходят.
- [ ] Свежий независимый Reviewer проверил callers, failure paths,
  concurrency, migrations, privacy, false-green tests и все три repo и дал
  `accept` на exact fingerprints.

Ручная staging-проверка после отдельного deploy-разрешения:

```text
Покажи варианты памятников
вертикальный
пока не знаю
покажи
```

Затем нажать каждую полученную кнопку, убедиться в правильной группе/подсветке,
вернуться к виджету и продолжить оставшиеся шесть сообщений fixture. Зелёные
автотесты не заменяют ручное согласие владельца.

## 7. Стоп-гейты и полученное разрешение

Владелец 2026-08-24 явно одобрил:

- заменить прежние AILR-03—06 одним OneShot vertical slice;
- точные prompt/context/retrieval/ID-validation правила этой карточки;
- сохранить `history.v2` и существующую форму catalog action;
- необходимые изменения в трёх перечисленных repo;
- deterministic eval на присланном transcript.

Поэтому перечисленное не требует повторного вопроса внутри реализации.

Немедленная остановка `needs_human_decision`, если потребуется:

- DB migration/schema;
- другая public DTO/version или иная href grammar;
- второй model call/tool loop/runtime, новая factual authority или vector
  service;
- ослабление required observability evidence, send gate, manager takeover,
  privacy/retention;
- секреты/runtime config, платный live eval или внешнее действие, не описанное
  карточкой.

Создание этой карточки не разрешает commit, push, PR, deploy или платный вызов.
После technical completion и independent `accept` Исполнитель останавливается.
Commit/push и staging deploy выполняются только по новой явной команде
владельца с recoverable rollback. Production deploy отдельно запрещён.

Владелец 2026-08-25 отдельно разрешил в новой сессии:

- live-проверку уже опубликованного staging `https://preview.granitkr.ru/`;
- платный model eval по зафиксированному в этой карточке transcript/rubric:
  одна exact model/prompt/catalog конфигурация, минимум пять повторов, с
  фиксацией task success, safety/factual veto, latency, tokens и стоимости.

Это разрешение не требует повторять локальные test suites и не разрешает
commit, push, PR, staging/production deploy, изменение secrets/runtime config
или исходного кода. Если staging не соответствует exact accepted RC payload,
Исполнитель фиксирует mismatch и не подменяет его самостоятельным deploy;
платный eval exact локального RC можно выполнить отдельно через существующий
harness и существующую конфигурацию без её изменения.

## 8. Evidence и независимая проверка

Перед передачей Reviewer Исполнитель фиксирует по каждому repo:

- исходный/final SHA, branch, porcelain и сохранённые чужие изменения;
- полный file list, `git diff --stat` и reproducible payload fingerprint;
- targeted tests, typecheck/lint, build и browser/integration commands;
- PostgreSQL/concurrency/failure результаты в operations;
- transcript before/after eval report без customer identifiers;
- непроверенные области и точный rollback каждого repo.

Reviewer свежей отдельной сессией, не являющийся автором, выполняет Code Scout:

- все callers и public/history/widget consumers;
- normal, empty, malformed и provider-failure paths;
- atomicity, idempotency, lease loss, latest-wins и takeover;
- schema/migrations/state ownership;
- prompt/tool/contracts/privacy/PII;
- false-green fixtures, фактическую catalog authority и deep-link security;
- cross-repo bundle/deploy impact и recoverable rollback.

Verdict относится только к exact fingerprints всех затронутых repo. Любой
последующий production/test diff аннулирует `accept`. Невыполненная обязательная
проверка даёт `needs_evidence`; новая существенная развилка —
`needs_human_decision` или `needs_redesign`.

Rollback до publication: удалить только отделённый diff этого OneShot в каждом
repo. После owner-approved staging publication: вернуть все три repo/runtime
assets к записанным предыдущим commit/image/content hashes. Partial rollback,
при котором backend выдаёт ссылки на неподдерживаемый landing, запрещён.

## 8.1. Technical handoff 2026-08-25

Технический payload подготовлен без commit, push, deploy и платных вызовов.
Один результат: каждый релевантный show-turn может получить проверенные
`history.v2.catalog_references`; кнопка открывает current item, а widget
восстанавливает тот же разговор после `_self` navigation и reload.

Ориентир 900 строк превышен: без двух generated index-файлов payload содержит
примерно 1,8 тыс. добавленных/изменённых строк в трёх repo. Причина — полный
cross-repo security slice, а не дополнительная функция: server-side retrieval,
subset validation, atomic history metadata, optional-observability repair,
durable model-safe slots, deterministic transcript/negative tests, strict
landing resolver/browser acceptance и widget distributable. Два одинаковых
generated index-файла добавляют по 4972 строки; source maps виджета являются
результатом штатной сборки.

Зелёные доказательства: 46 targeted operations tests; architecture guard 21/21;
полный API/manager typecheck и operations build; landing index/navigation 6/6;
landing browser smoke с item focus, session/history reload и тремя migration
cases; widget typecheck, 92/92 unit/component tests, build и package verify.

Неполные доказательства из-за заполненного root filesystem (`ENOSPC`): общий
operations suite дал 372 passed, 10 skipped и 17 failed; 15 PostgreSQL failures
возникли после 33/48 успешных invariants при записи файлов БД, один test timeout
после `ENOSPC`, migration container не прошёл health-check. Ещё два baseline
`ai-turn-context` assertions не относятся к payload и ожидают уже отсутствующее
baseline-поведение. Отдельный widget Playwright suite не стартовал без pinned
`chromium_headless_shell-1228`; обязательный cross-repo browser journey при этом
прошёл landing smoke на установленном Chromium.

Verdict Reviewer: `pending`. Следующий gate — свежая read-only проверка exact
fingerprints всех трёх repo; до `accept` slice не считается завершённым.

## 8.2. Staging RC hardening 2026-08-25

По новой команде владельца публичный лимит отделён от внутреннего retrieval:
детерминированный candidate set и model output schema по-прежнему допускают до
восьми ID, а validated/public projection допускает не более трёх catalog
actions. Для unique subset из пяти валидных ID reply сохраняется, первые три ID
становятся `history.v2.catalog_references`, последние два фиксируются как
`droppedRecommendationIds`. Unknown и duplicate ID по-прежнему целиком
отбрасываются fail closed.

Prompt `granit_model_turn_prompt.v3` различает два пути: generic «покажи»
выбирает от одной до трёх позиций из разных групп и может задать один короткий
вопрос о направлении; при известном типе выбираются до трёх релевантных
позиций без повторного вопроса. Runtime pinned к stabilized index
`landing-catalog.e76ee8be770a`, SHA-256
`94038ef1954ce38691d3bc85b3f658c1d9ad1bfc7a428037d66b26f07d87d22b`.

Новые targeted checks прошли 22/22, PostgreSQL invariants — 48/48,
architecture guard — 21/21, API/manager typecheck и build зелёные. Landing
catalog/identity/navigation — 22/22; W0 browser smoke подтвердил item focus,
`history.v2` restore, три migration cases и нативный переход по фактическому
overview `href`. Widget прошёл typecheck, 92/92 unit/component tests, build,
package verify и 27/27 browser tests.

Первый свежий review нашёл десять legacy overview-ссылок `?category=...`,
которые strict resolver корректно отклонял, но обычный click-path маскировал
через `preventDefault()`. Все ссылки переведены на канонический `?section=...`;
добавлены статический negative test и browser-переход по реальному href в
отдельной странице. После исправления landing suite и W0 smoke повторены.

Полный `npm test` повторён после устранения прежнего `ENOSPC`: 401 passed,
2 skipped, 2 failed assertions и 1 failed suite discovery. Оставшиеся failures
предшествуют этому hardening diff: два `ai-turn-context` assertions требуют
отдельного решения по causal cursor/privacy test fixture, а Vitest пытается
исполнить штатный Node test `tooling/ai-architecture-guardrails.test.mjs` как
Vitest suite. Они не ослаблялись и не маскировались; штатный
`npm run check:architecture` проходит. До independent review общий результат
не объявляется полностью зелёным.

## 9. Передача новой сессии

Начальная команда Исполнителю:

```text
Делай AILR-03 OneShot по
docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md.
Сначала выполни exact-SHA preflight трёх repo и красный transcript baseline.
Не делай commit, push, deploy и платные вызовы. После technical completion
остановись для свежей независимой проверки.
```

Финальная техническая передача должна иметь вид:

```text
Goal: AI-LAYER-SIMPLIFICATION
Текущий срез: AILR-03 OneShot «покажи каталог»
Статус:
Base/head SHA и fingerprints трёх repo:
Один пользовательский результат:
Изменённые области:
Transcript eval before/after:
Failure/concurrency/browser evidence:
Непроверено:
Rollback:
Verdict Reviewer:
Следующий gate: owner commit/push/deploy или repair
```
