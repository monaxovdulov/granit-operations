# Карточка среза AI-LAYER-SIMPLIFICATION: AILR-00 — карта runtime и Harness

Статус: `accept` — принят пятым свежим независимым Reviewer.

Goal: `AI-LAYER-SIMPLIFICATION`.

Позиция в roadmap: первый read-only по production-коду срез перед AILR-01.

Ветка / base SHA / head SHA:
`agent/ai-layer-refactor` /
`4c91d162e13251883125ab5b1b32565172f570c6` /
тот же SHA до документационного diff AILR-00.

Фактическая модель Исполнителя: GPT-5; точный runtime identifier интерфейсом
сессии не раскрыт.

Фактическая модель первого независимого Reviewer: `gpt-5.6-sol`, reasoning
`high`, read-only session `01a033ff-3070-7cc2-850d-2a4a175cdf3b`.

Фактическая модель второго независимого Reviewer: `gpt-5.6-sol`, reasoning
`high`, read-only session `01a0340c-11fb-7101-a08c-f2ee8b62aa5b`.

Фактическая модель третьего независимого Reviewer: `gpt-5.6-sol`, reasoning
`high`, read-only session `01a03419-a053-7e82-964a-819582020007`.

Фактическая модель четвёртого независимого Reviewer: `gpt-5.6-sol`, reasoning
`high`, read-only session `01a03427-3db1-7733-b7fa-4b9d184c1f5a`.

Фактическая модель пятого независимого Reviewer: `gpt-5.6-sol`, reasoning
`high`, read-only session `01a03437-a21a-73b3-8279-5376fb307fc6`.

## 1. Один результат

По current code восстановлен один authoritative путь
`inbound -> queue -> fresh context -> model -> validation -> atomic commit ->
history.v2`, а gaps конкретной validator observability и catalog navigation
отделены друг от друга и получают `GO / NO-GO / NO-OP / SPLIT`.

Почему это следующий срез: владелец сначала поручил AILR-00 без рабочего кода,
а затем — реализацию наблюдаемости и catalog RAG; code-derived карта не даёт
подменить текущий single-runtime старым grounded/eval-only контуром.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | `agent/ai-layer-refactor`; только пользовательский untracked `output/` |
| Base/head SHA | `4c91d162e13251883125ab5b1b32565172f570c6`; `origin/main=2122ce143129492797514bb73bdf4a1069e273a2` |
| Current landing | `/home/devuser/ai-projects/landing-granit-static` @ `9d1710867b53323cbd9b99d6642541c7ddd4ec77`; пользовательские untracked `catalog-ux-concept/`, `docs/cms-lite-plan/` не трогаются |
| Current widget source | `/home/devuser/ai-projects/business-ai-web-widget` @ `c44f99637e097a47b3c53099c95d7e8e01701ad8`, clean |
| PR #22 branch | `a5bda98e6c715e4ddfeac16dcf0779cc55b89656` не является ancestor `origin/main`; его fix/evidence не входят в baseline |
| Existing tests | model-turn validator, M2 integration, PostgreSQL runtime invariants, observability sanitizer, history/widget component/domain/browser suites |
| Известный красный baseline | не заявляется до запуска проверок AILR-00 |

Источники истины по приоритету:

1. ADR-010, ADR-011, ADR-012 и current code на SHA выше;
2. owner architecture docs и `AI_LAYER_SIMPLIFICATION_GOAL_RU.md`;
3. `developing-ai-agents` harness-review/harness-spec/build-evals;
4. эта карточка и независимая evidence.

## 3. Область

Разрешено:

- read-only AST/caller/failure/concurrency/privacy/cross-repo audit;
- current и target Harness, evidence/inference/unknown и slice decision;
- закрытие прежней Goal после owner teach-back и переключение active routing;
- rebaseline machine-readable architecture contract и contract-driven ремонт
  его route guard/tests, чтобы новая Goal не считалась второй карточкой, а
  historical mentions не считались active route.

Явно вне области:

- production/test behavior, schema/migrations, public DTO, prompt/model/tools;
- catalog snapshot, widget/landing code и deploy;
- cherry-pick или ручное копирование PR #22;
- `output/` и untracked paths соседних repo.

Ожидаемый diff: docs/state/architecture-contract routing и узкий guard/test
этого routing; hard line limit не нужен, production closure обязана остаться
байт-в-байт прежней.

## 4. Критерии успеха

- [x] Карта называет конкретного владельца ingress, queue, fresh context,
  model call, validation, commit, observability и public history.
- [x] Для каждого terminal/failure path указаны persisted и public outcomes.
- [x] Доказано, какие catalog producer/consumer paths production-reachable, а
  какие остались только в eval/tests.
- [x] Current/target Harness заполнены по обязательным полям skill.
- [x] Отдельно записаны evidence, inference и unknown; неизвестное не выдано за
  факт.
- [x] Итог даёт один из `GO / NO-GO / NO-OP / SPLIT` для следующего среза.
- [x] Architecture guard, link/JSON/diff checks проходят; production source
  hashes не меняются.
- [x] Свежий независимый Reviewer выполнил Code Scout и выдал `accept`.

## 5. Стоп-гейты

- [x] Архитектурный/roadmap gate закрыт owner-командами «Делай AILR-00» и
  последующим поручением реализовать validator observability и catalog RAG.
- [x] Migration/schema или public contract — не изменяются.
- [x] Prompt/tool/model-policy/privacy/send gate/takeover — не изменяются.
- [x] Deploy/secrets/paid call/working code другого repo — не выполняются.

Нового stop-gate внутри read-only production scope AILR-00 нет.

## 6. Выполнение

### 6.1. Authoritative production path

| Этап | Владелец в current code | Фактическое поведение |
|---|---|---|
| HTTP ingress | `PublicWidgetIntakeService.acceptSiteWidgetMessage()` | Проверяет `site_widget.v2`, сохраняет inbound и при включённом runtime атомарно ставит job; клиент сразу получает `accepted/processing` и дальше читает history. |
| Durable queue | `PostgresIntakeRepository.acceptInboundMessage()` и `claimSiteWidgetAiJob()` | Claim разрешён только для открытого диалога, включённого runtime, прежнего `generation_epoch`, самого нового visitor sequence и неистёкшей попытки; применяется `FOR UPDATE SKIP LOCKED`. |
| Worker/fence | `WidgetAiJobWorker.runOnce()` | После claim проверяет current job каждые 250 ms, передаёт `AbortSignal`, stale turn завершает как `superseded`. В retry budget попадает только exception, вышедший из executor; provider exception ниже перехватывается оркестратором и до worker catch не доходит. |
| Fresh context | `PostgresIntakeRepository.loadFreshClaimedSiteWidgetAiTurn()` и `loadAiDialogContext()` | Контекст перечитывается после claim из authoritative conversation/messages/slots/requirements/memory; enqueue-time snapshot не считается модельным контекстом. |
| Model-safe view | `buildLiveV2TurnView()` | Оставляет до восьми безопасных сообщений в лимите символов, current inbound ровно один раз, известные слоты и gate; IDs, timestamps, URLs, contact values и unrestricted metadata модели не передаются. |
| Assembly | `buildDirectWidgetAiTurnExecutor()` | Собирает единственный recorded direct executor с `model_turn_v1`; configured adapter — `OpenAiLiveV2DecisionGenerator`, current model config — `gpt-5.6-luna`, reasoning `medium`. |
| Model call | `executeModelTurn()` -> `generateDecision()` | Один Responses structured-output call на ход. Production tool loop, catalog retrieval и второй model/verifier call отсутствуют. |
| Validation | `validateModelTurnOutput()` | Проверяет schema, непустой/недублирующий вопрос, unsafe claim, tone, repeated reply, известный slot и patch evidence. Любой proposed `recommendationId` сейчас отбрасывается как `unsupported_recommendation`. |
| Recorded outcome | `RecordedLiveV2TurnService.execute()` и `terminalStateFor()` | Создаёт logical run/attempt/spans/events. Успех передаётся на atomic commit; invalid candidate завершается без outbound. |
| Atomic commit | `RecordedPublicWidgetAiTurnExecutor.execute()` -> `persistAiReplyWithSendGate()` | Хеширует final text и в одной транзакции повторно проверяет gate/epoch/latest sequence/lease, пишет outbound, patches/handoff, winning attempt, run и job. |
| Public history | `PublicWidgetIntakeService.getSiteWidgetHistory()` -> repository | Возвращает `site_widget.history.v2`; только сохранённый outbound становится сообщением клиента. `catalog_references` читаются из metadata, но current direct executor их не создаёт. |

Это один production-reachable контур. `FileCatalogKnowledgeProvider` и
`GroundedWidgetAiService` имеют callers только в eval/tests и не являются
скрытым fallback production runtime. Ветка PR #22 также не входит в baseline.

### 6.2. Failure, persistence и client outcome

| Условие | Persisted evidence | Что получает клиент |
|---|---|---|
| Runtime выключен при ingress | inbound без AI job | `accepted`, automation disabled/manager pending; AI не запускается. |
| Manager takeover, закрытый gate или новая generation | claim не выдаётся либо attempt/job fenced; outbound отсутствует | history не получает AI-сообщение. Это соответствует owner rule: если менеджер забрал диалог, AI не отвечает. |
| Новое visitor message во время работы | старая попытка abort/fence -> `superseded`; atomic commit дополнительно отвергает stale sequence | устаревший outbound не появляется; новый inbound получает отдельный свежий job/context. |
| Provider exception/timeout | `executeModelTurn()` превращает exception в terminal `generator_failed`; run получает `fallback_unavailable`, `outcome_reason=generator_failed`, `failure_code=runtime_failure`, а job атомарно становится `blocked` без retry. Из-за текущей общей completion-семантики physical attempt при этом записывается как `succeeded`, хотя runtime span/quality event фиксируют failure. | В history нет AI-сообщения; принятый inbound остаётся. |
| `context_invalid` | blocked run, `execution_context_mismatch` | outbound отсутствует; public detail не раскрывается. |
| `gate_unavailable`/persistence failure | failed run/attempt, generic recorder/persistence codes | outbound не считается сохранённым; публичный fallback остаётся generic. |
| Validator reject | run `blocked`, `outcome_reason=candidate_invalid`, `failure_code=invalid_candidate`, generic quality/span code | outbound отсутствует; точный validator code клиенту не возвращается. |
| Valid answer | succeeded run/attempt и outbound атомарно | новое AI-сообщение появляется в `history.v2`. |
| Valid handoff | reply и takeover state фиксируются атомарно, `agentAllowedToReply=false` | последнее AI-сообщение видно, последующие AI-ответы запрещены. |

Для queued path `recordedFallbackSuccess()` формирует внутренний worker-result с
`next_step=manager_review`, но `toRecordedTurnResponse()` намеренно не вызывает
`transitionToManagerReview()` при наличии job. Это не текущий HTTP-ответ widget,
однако формулировка результата шире фактического state transition; находка
остаётся отдельным кандидатом, а не исправляется в AILR-00.

### 6.3. Почему exact validator reason сейчас теряется

`ModelTurnValidationResult` использует общий union из одиннадцати кодов, но
terminal `ok:false` имеют только восемь: `invalid_shape`, `invalid_answer`,
`duplicate_question`, `invalid_question`, `unsafe_claim`, `tone_violation`,
`repeated_reply` и `known_slot_requested`. Ещё три кода —
`unsupported_recommendation`, `invalid_patch_evidence`, `duplicate_patch` —
являются non-terminal diagnostics: соответствующие IDs/patches отбрасываются,
а безопасный текст плана может пройти. `executeModelTurn()` кладёт конкретный
terminal code в `plan.validationCode`. Затем `terminalStateFor()` сворачивает
все terminal reject-планы в:

```text
status=blocked
outcome_reason=candidate_invalid
failure_code=invalid_candidate
quality_event=policy_violation/candidate_invalid
span_error=validation_failed
```

То есть «candidate invalid» означает только: candidate не прошёл локальный
валидатор и не был отправлен. По сохранённым run/attempt/span/event нельзя
узнать, какой именно check сработал. Сырые prompt/response сохранять для этого
не нужно и нельзя. В `ai_runs.metadata` уже есть JSONB, поэтому рабочая гипотеза
AILR-01 — сохранить туда только finite allowlisted code. Это inference до теста
repository path; если существующего поля недостаточно, срез останавливается на
DB stop-gate.

### 6.4. Current Harness

**Context.** Fresh context принадлежит приложению и собирается после claim.
Модель видит ограниченный dialog view, known slots и approved static facts.
Лимиты проверяются `live-v2-context` tests. Catalog candidates в production
context отсутствуют.

**Tools.** У модели нет production tools. `recommendationIds` присутствует в
output schema, но любой непустой список принудительно отбрасывается. Старый file
catalog provider не подключён к app assembly.

**Constraints.** Жёсткими являются send gate до генерации, fresh gate после неё,
atomic commit gate, structured schema и локальные unsafe/tone/repeat/known-slot
checks. Gate/fence предотвращают ответ после takeover или нового сообщения.

**Verification.** Детерминированный validator формирует canonical text и его
SHA-256; repository сверяет committed text. `requiresSemanticVerifier=false`,
отдельного semantic/model judge нет. Catalog ID/source/version не проверяются,
потому что live catalog отсутствует.

**Correction.** Provider exception не повторяется: оркестратор преобразует его
в terminal `generator_failed`, после чего job блокируется. Worker retry до трёх
попыток по умолчанию относится только к exception, который вышел из executor,
например к непойманной recorder/persistence ошибке. Stale job отсекается.
Validator reject не repair-ится и не повторяет model call: ход завершается без
ответа. Bounded worker concurrency — 4 по умолчанию, clamp 1..16.

**Untrusted content/privacy.** Visitor text — untrusted data, а не instruction;
IDs, timestamps, URLs, contact values и произвольная metadata удаляются из
turn view. Observability sanitizer сохраняет только allowlisted enum/count/hash/
version/duration fields, без raw model text и PII.

**Trajectory/evidence.** Logical run, physical attempt, spans, quality events и
winning commit связаны durable IDs. Траектория stale/worker-retry/commit
восстанавливается, но provider failure сейчас противоречиво сочетается с
`succeeded` attempt, а точная причина validator reject после терминализации не
сохраняется. Первый факт остаётся отдельной находкой; второй и составляет
минимальный observability gap AILR-01.

### 6.5. Catalog producer/consumer map

1. Operations уже умеет отдать из history только legacy reference вида
   `catalog_item {label, href, entityId}` и принимает лишь старый URL
   `/catalog.html?section=...&entity=ent_...#block-...`.
2. Current direct executor не переносит catalog references в outbound metadata.
3. Widget parser/render тоже знает только этот legacy `catalog_item`; ссылка
   открывается с `target=_self`, поэтому страница меняется в той же вкладке.
4. Widget сохраняет в local storage только `public_session_id` под общим
   `conversation-scope-id`, а также open state и panel size под ID экземпляра.
   Transcript локально не хранится: после reload виджет использует сохранённый
   session ID и восстанавливает сообщения из backend `history.v2`.
   `persist-open-state` на current landing/catalog не включён, поэтому история
   переживает reload, а гарантированное сохранение открытого состояния — нет.
5. Current landing catalog читает только `?category=...`; item имеет
   `data-model-id`, но URL не раскрывает/скроллит/подсвечивает category group или
   item. Старые `section/entity/#block` больше не являются его контрактом.
6. Manifest машиночитаем, однако path/hash suffix не объявлен стабильным public
   ID. Предыдущая offline cross-check дала 194 однозначных совпадения и 35
   отсутствующих; выводить runtime ID из имени файла нельзя.

Следовательно, «следы старого врага» сохранились на history/widget стороне, но
producer и новый catalog resolver разорваны. Простое включение старого
`GroundedWidgetAiService` вернуло бы второй расходящийся runtime и неверные URL.

### 6.6. Target Harness для следующих срезов

**Context.** Приложение до единственного model call выбирает малый набор только
published catalog candidates из versioned snapshot: stable ID, type
`category|item`, короткие machine-readable признаки и display label. Полный
manifest и URL модели не передаются.

**Tools.** Model tool loop не добавляется. Retrieval остаётся server-side
детерминированным pre-step; один model call может вернуть только ID из выданного
candidate set.

**Constraints.** Модель не строит URL и не выдумывает ID. Server проверяет
snapshot version, published status, membership candidate set, лимит/уникальность
ID и уже после проверки строит reference/URL. Send/takeover/stale gates остаются
без изменений. Terminal reject оставляют только для механической целостности,
безопасности и неподтверждённого факта; точный allowlist — отдельное owner
решение AILR-02.

**Verification.** Offline retrieval fixtures проверяют view intent, category и
конкретный item, empty/no-match, unpublished/unknown ID и стабильность URLs.
Integration проверяет один provider call, allowlisted IDs, metadata/history и
отсутствие raw content в telemetry. Cross-repo acceptance проверяет reload,
сохранённый widget, раскрытие category/group, scroll и highlight item.

**Correction.** Empty/low-confidence retrieval не превращается в ложную ссылку:
модель отвечает без кнопок либо задаёт обычный вопрос. Invalid proposed ID
отбрасывается server-side; никаких дополнительных model calls. Текущая
provider-failure семантика остаётся terminal без retry; stale fence и atomic
commit остаются current behavior. Изменение retry policy требует отдельного
среза и не подмешивается в catalog work.

**Boundaries.** Малый фиксированный candidate cap; максимум шесть references по
текущей output schema; одно model invocation; только versioned local/published
artifact на request path; отсутствие network fetch каталога на каждый ход.
Конкретные thresholds, DTO и URL shape не утверждаются AILR-00.

### 6.7. Evidence, inference, unknown

**Evidence из current code:** один direct executor; один model call; fresh
post-claim context; pre/post/commit gates; exact validation code существует до
terminal mapping; все рекомендации отбрасываются; grounded/file catalog не
production-reachable; legacy history/widget reference не соответствует current
landing URL reader.

**Stale active-reference finding:** `README.md` направляет аудитора в
`docs/AI_POLICY.md`, но разделы `Grounded send path`, `Knowledge`, memory и
degradation в этом документе всё ещё описывают eval-only
`GroundedWidgetAiService`, semantic verifier, repair и file catalog как
production. Они противоречат current assembly и не являются источником
фактического runtime behavior. AILR-00 классифицирует их как stale, но не меняет
AI-policy без отдельного owner stop-gate; current code и эта exact-SHA карта
имеют приоритет по `docs/source-of-truth.md`.

**Inference, которую надо доказать тестом:** existing `ai_runs.metadata` может
хранить sanitized validator code без migration; server-side retrieval проще и
надёжнее tool loop для текущей задачи; маленький candidate set укладывается в
один model turn.

**Unknown:** authoritative stable ID/crosswalk для 35 unmatched manifest rows;
точный public DTO и URL для category/group/item; offline retrieval threshold и
качество на реальных запросах; необходимость prompt change; реальный UX после
deploy. Ни один из этих пунктов не считается решённым зелёными unit tests.

### 6.8. Slice decision

Общий запрос — **SPLIT**, потому что observability, validator policy, catalog
authority/retrieval и cross-repo navigation имеют разные контракты и stop-gates.

- **AILR-01: GO** — exact sanitized validator code во внутреннем run evidence,
  без raw text, public response и schema migration. Если JSONB path не подходит,
  решение становится `NO-GO` до owner DB decision.
- **AILR-02: SPLIT / stop-gate** — уменьшение terminal hard gates и
  согласование stale `docs/AI_POLICY.md` с current/target runtime меняют
  AI-policy; сначала фиксируются точный allowlist/документальный diff и owner
  approval.
- **AILR-03: GO** — read-only authority/crosswalk и offline retrieval eval, без
  production/public change.
- **AILR-04—05: stop-gate перед кодом** — prompt/output и public
  history/widget/catalog URL contract должны быть записаны и явно подтверждены.
- **AILR-06: NO-OP до предыдущих срезов** — deploy и ручная production проверка
  не разрешены; зелёные тесты означают evidence, а не разрешение публикации.

Соседние находки не исправляются: exact validator reason — AILR-01; terminal
hard-gate allowlist — AILR-02; catalog authority/retrieval/navigation —
AILR-03—06.

## 7. Evidence

Base/head: `4c91d162e13251883125ab5b1b32565172f570c6`; branch
`agent/ai-layer-refactor`; `origin/main=2122ce143129492797514bb73bdf4a1069e273a2`.
Точный repair-review fingerprint записывается в machine state перед повторной
проверкой. Алгоритм охватывает все changed files, включая active card, кроме
самозаписывающегося machine state и пользовательского `output/`: для
отсортированных status entries хешируется строка
`<XY> <path>\0<SHA-256(file)>\n`; перевод строки входит и после последней
записи.

Выполнено:

- `ast-index update` и последующий symbol/caller audit, затем адресные `rg/sed`
  проверки failure/public paths: current index был up to date;
- `npm run check:architecture`: guard passed, negative tests 21/21;
- read-only repo-local Markdown link scan: 133 files, zero missing targets;
- JSON parse `.agents/state/granit-dev-workflow.json` и architecture contract:
  2/2;
- `git diff --check`: passed;
- production closure: 140 sources,
  paths SHA-256 `95f2c18c9ddc7aaba769ec2f422bbfffaa35d8b7881f5c5548ba726d08827781`,
  contents SHA-256
  `efc78259159baf5ee4980a503f17a16eae0a1b5d89fe520d3c9d2b4fe356cfdf`;
  оба hash совпадают с reviewed contract.

Затронуто 17 файлов: 15 tracked modifications и две новые task docs; суммарно
823 insertions, 70 deletions с учётом новых файлов. Полный список:

```text
.agents/state/granit-dev-workflow.json
docs/AGENT_WORKFLOW.md
docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md
docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md
docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md
docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md
docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md
docs/source-of-truth.md
docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md
docs/tasks/AI_REF_AILR_00_RUNTIME_HARNESS_MAP_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md
docs/tasks/ARCHIVE_RU.md
docs/tasks/README.md
tooling/ai-architecture-contract.json
tooling/ai-architecture-guardrails.mjs
tooling/ai-architecture-guardrails.test.mjs
```

Прямое влияние: active Goal/card routing, machine contract и его contract-driven
проверка; production behavior не изменён. Косвенное влияние: новая сессия
получает AILR-00 вместо завершённой CONV Goal. Не проверено: PostgreSQL runtime,
paid model, browser UX, внешние repo и deploy — они не применимы к docs/routing
срезу и остаются явными unknown будущих срезов. Пользовательский `output/` и
untracked paths landing repo не читались и не менялись.

Rollback до публикации: удалить только AILR-00 docs/state/contract diff и
вернуть guard/route к reviewed contract на base SHA; runtime/schema/data
rollback не нужен. Зелёные проверки не разрешают deploy: он возможен только
после отдельного ручного согласия владельца.

## 8. Независимая проверка

Первый verdict: `changes_requested`.

Findings:

1. `medium`: `docs/AI_POLICY.md`, на который ссылается README, описывает
   недостижимый grounded/verifier/catalog path как production; карта должна
   явно классифицировать расхождение либо менять policy через stop-gate.
2. `low`: карта смешала одиннадцать значений общего validation union с восемью
   terminal reject codes.

Repair: stale policy явно отделена от current code без изменения policy, а
terminal/non-terminal коды разведены. После повторных checks нужен новый свежий
Reviewer; автор не принимает repair сам.

Второй verdict: `changes_requested`.

Finding:

1. `low`: карта ошибочно приписала local storage хранение transcript; tracked
   widget сохраняет там только session/UI state, а сообщения восстанавливает из
   backend `history.v2`.

Repair: state ownership уточнён без изменения widget, public history или
privacy-контракта. После повторных checks нужен третий свежий Reviewer; автор не
принимает repair сам.

Третий verdict: `changes_requested`.

Finding:

1. `medium`: карта ошибочно утверждала, что provider exception/timeout идёт по
   worker retry budget. Current orchestrator превращает его в terminal
   `generator_failed`; job блокируется без retry, а physical attempt из-за
   общей completion-семантики записывается как `succeeded`.

Repair: provider path отделён от exception, вышедшего из executor, и одинаково
исправлен в production map, failure table и Current/Target Harness. Production
code и retry policy не менялись. После повторных checks нужен четвёртый свежий
Reviewer; автор не принимает repair сам.

Четвёртый verdict: `changes_requested`.

Findings:

1. `medium`: guard всё ещё исключал прежнюю
   `AI_RUNTIME_CONVERGENCE_GOAL_RU.md` по захардкоженному имени, поэтому её
   повторная активация рядом с новой Goal давала false-green.
2. `low`: machine state отправлял следующего Reviewer проверять уже устаревший
   fingerprint второго repair.
3. `low`: описание fingerprint не фиксировало завершающий `\n`, хотя он входит
   в фактический byte stream и меняет итоговый SHA-256.

Repair: сначала добавлен воспроизводящий negative test, который был красным с
`expected AI_CARD_LIMIT, received []`; затем hardcoded-исключение удалено, и
тот же тест вместе с полным architecture suite прошёл 21/21. Machine state и
описание fingerprint синхронизированы с четвёртым review и точным алгоритмом.
Production code не менялся. После повторных checks нужен пятый свежий Reviewer;
автор не принимает repair сам.

Пятый verdict: `accept` на fingerprint
`5ab09846f682dfe618dbd973b29a4e8b0b3736e7319233c8b37c60f9a8974cbb`.

Findings отсутствуют: замечаний critical/high/medium/low нет. Reviewer
независимо воспроизвёл 16-entry fingerprint с завершающим `\n`, получил два
`AI_CARD_LIMIT` при in-memory реактивации прежней Goal, восстановил runtime и
failure/concurrency/privacy paths по current code и подтвердил tracked-only
widget/landing map вместе с cross-check 229 = 194 + 35. Production diff в
`apps/` и `packages/` пуст, `git diff --check` и production guard прошли.

Ограничения review: локального AST index не было, поэтому callers проверены
через `rg` и прямой assembly/import audit; PostgreSQL, browser UX, paid provider,
deploy и полный suite не запускались как неприменимые или запрещённые этому
read-only срезу. Пользовательский `output/` и untracked paths внешних repo не
читались.

## 9. Передача Goal

Почему изменение понадобилось: текущий production path и старые catalog traces
расходятся, а общий `candidate_invalid` скрывает диагноз.

Доказательство принятия: свежий Reviewer независимо восстанавливает тот же
caller graph и failure/public outcomes на том же SHA.

Оставшийся риск: AILR-00 ничего не исправляет и не доказывает качество на
реальном распределении.

Следующий срез после `accept`: AILR-01 — точный sanitized validator reason без
изменения public fallback и без schema migration; если existing storage
недостаточно, остановиться на DB stop-gate.
