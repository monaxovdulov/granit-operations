# Следующая задача: полный контекст консультации для модели

Статус: `prepared_for_next_session`. Владелец одобрил продуктовое решение
2026-08-26, но эта карточка не становится второй active AI-card автоматически.
Она активируется явной командой владельца в новой сессии.

Начальная команда для новой сессии:

```text
Прочитай docs/tasks/AI_FULL_CONVERSATION_CONTEXT_NEXT_TASK_RU.md и реализуй
описанный вертикальный срез. Не выполняй deploy, commit или push без отдельной
команды.
```

Репозиторий: `granit-operations`.

Подготовлено на ветке `agent/ai-layer-refactor`, SHA
`15385b57265ba632e8dba691a8e82701f026b925`.

Пользовательские untracked `context.md` и `output/` не читать и не изменять.

## 1. Решение владельца и продуктовый контекст

Website widget решает короткую коммерческую задачу: поговорить с посетителем,
понять, какой памятник или услуга ему нужны, показать подходящие варианты либо
передать разговор менеджеру. Это не персональный ассистент с многомесячной
историей. Ожидаемый разговор обычно состоит из нескольких или нескольких
десятков коротких сообщений.

Поэтому основной context strategy должна быть простой:

```text
весь доступный model-safe transcript текущей консультации
  + typed known slots и requirements
  + gate
  + статические prompt/tone/facts/tool contracts
  -> основная модель
```

Не надо заранее угадывать, какие реплики важны, обрезать нормальный диалог по
маленькому количеству сообщений или строить summary/RAG над короткой
консультацией. Context reduction добавляется только после наблюдаемого
переполнения или измеренного ухудшения, а не как гипотетическая оптимизация.

## 2. Один наблюдаемый результат

На каждом новом сообщении посетителя основная модель видит в хронологическом
порядке весь текстовый диалог `visitor`/`ai_assistant` текущего разговора до
актуального causal cursor, включая текущую visitor-реплику ровно один раз.

Начальная цель, предыдущие вопросы AI, ответы, отказы, исправления и ссылки
вида «первый вариант» не исчезают после четырёх обменов. Сохранённые typed
slots/requirements продолжают передаваться отдельно и остаются operational
source of truth для persistence, manager handoff и app-owned validation.

## 3. Подтверждённый baseline

Текущий pipeline ограничивает один и тот же контекст каскадом:

1. `PostgresIntakeRepository.loadAiDialogContext()` читает максимум 12
   предыдущих сообщений.
2. `toAiRecentMessages()` ограничивает промежуточный контекст 12 000
   символами.
3. `buildLiveV2TurnView()` повторно оставляет максимум 8 сообщений вместе с
   текущим и максимум 6000 символов текста.
4. `buildLiveV2ModelRequest()` отдельно допускает до 64 000 символов всего
   сериализованного model input.

Из-за лимита 8 сообщений начало разговора исчезает примерно после четырёх
обменов visitor/assistant. Typed state сохраняет отдельные поля, но не хранит
смысловые уточнения, отвергнутые варианты, причины выбора и естественные ссылки
на ранние ответы.

Runtime закреплён на `gpt-5.6-luna`. На дату подготовки карточки официальная
документация OpenAI указывает для модели context window 1,05 млн токенов:
<https://developers.openai.com/api/docs/models>. Перед реализацией повторно
проверить установленную модель и совместимую официальную документацию. Не
выводить новый app budget только из максимального provider window: оставить
явный собственный circuit breaker.

Текущие entrypoints:

- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
  (`loadAiDialogContext`, `toAiRecentMessages`, `advanceAiRollingSummary`);
- `apps/api/src/modules/ai/ai-turn.ts` (`AiTurnInput`, старые bounded context
  constants/helpers);
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-context.ts`;
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-contract.ts`;
- `apps/api/src/modules/ai/profiles/live-v2/model-turn-orchestrator.ts`;
- `apps/api/src/modules/ai/ports/live-v2-runtime.ts`;
- связанные unit, transcript, integration и PostgreSQL tests.

## 4. Целевой контракт контекста

### 4.1. Transcript

- Источник — app-owned `conversation_messages` текущего разговора.
- Порядок — стабильный `messageSequence`, от старых сообщений к новым.
- Верхняя граница — текущий `respondsThroughSequence`; более новые сообщения
  не попадают в старую generation attempt.
- Роли — только текстовые `visitor` и `ai_assistant`.
- Текущая visitor-реплика присутствует ровно один раз и является последней.
- Duplicate public/internal message identity не создаёт duplicate текста.
- Нет обычного ограничения по количеству сообщений для консультации, которая
  помещается в общий model-input budget.

### 4.2. Structured state

Сохранить рядом с transcript:

- contact-presence flags и разрешённый `preferredContact` enum;
- model-safe business slots с provenance;
- model-safe requirements с provenance;
- актуальный gate (`aiState`, `agentAllowedToReply`).

Typed state не заменяется повторным извлечением из transcript. Он нужен для
manager UI/handoff, доказуемых patches, manager-authored values, restart-safe
работы и app-owned state transitions.

Текущая visitor-реплика остаётся сырьём для новых `statePatches`: значения из
неё становятся persisted state только после существующей quote-evidence
валидации и atomic commit.

### 4.3. Privacy и model-safe projection

В model input не добавлять отдельные:

- internal/public conversation/message IDs;
- timestamps;
- page URL/referrer и unrestricted metadata;
- реальные значения contact profile (`name`, `phone`, `email`);
- evidence IDs, confidence, provider errors и observability traces;
- manager/system сообщения как диалоговые роли.

Текст visitor/assistant сообщений передаётся как фактический разговор. Он может
содержать сведения, которые сам посетитель написал в сообщении, включая
контактные данные. Не обещать, что raw message text автоматически очищен от
PII, и не вводить regex-redaction в этой задаче: она может изменить смысл и
является отдельным privacy/product решением. Расширение historical transcript
не должно приводить к сохранению raw текста в новой observability или manager
metadata.

### 4.4. Один budget gate

Убрать каскад маленьких message/character limits из нормального пути. Оставить
один явный app-owned предел на полностью сериализованный model request, включая
transcript, facts, tone, tool definition и, во втором вызове, catalog results.

Точная величина определяется до кода по фактическому статическому payload,
закреплённой модели и текущей официальной документации. Она должна с большим
запасом пропускать типичный полный разговор и оставаться существенно ниже
provider context window.

При превышении:

- не обрезать старые сообщения молча;
- не создавать summary или RAG автоматически;
- вернуть существующий безопасный fallback текущего хода;
- записать только sanitized reason и размеры/counts без raw текста;
- не создавать ложный manager handoff.

### 4.5. Удаление дублирующей сложности

В пределах подтверждённых production callers удалить или перестать применять:

- лимиты `12 -> 8 -> 6000` в direct model-turn path;
- отдельный `lastAiQuestion`, если полный transcript делает поле полностью
  производным и ни один app-owned validator/consumer от него не зависит;
- `rollingSummary` в direct runtime, где оно уже не передаётся модели;
- дублирующие bounded-context helpers/constants, если caller audit подтвердит,
  что они не нужны другим исполняемым путям.

Не удалять shared/legacy код только по названию. Сначала найти production и test
callers. Если удаление затрагивает другой действующий контракт, оставить его и
зафиксировать отдельным cleanup-кандидатом.

## 5. Пример обязательного acceptance-сценария

```text
1. Visitor: Нужен памятник.
2. AI: Для одного человека или для двоих?
3. Visitor: Для одного.
4. AI: Какой материал рассматриваете?
5. Visitor: Чёрный гранит.
6. AI: Можно показать несколько лаконичных вариантов.
7. Visitor: Только без золота.
8. AI: Учту это ограничение.
9. Visitor: Нет, всё-таки нужен двойной. Покажи варианты, о которых говорили.
```

На ходе 9 модель обязана получить сообщения 1—9 в правильном порядке, текущую
реплику один раз, persisted `material=чёрный гранит`, прежний тип с provenance
и saved requirement `decoration/avoidance=золото`. Текущая явная коррекция
«нужен двойной» имеет prompt-level priority и может создать validated patch.

Если модель выбирает `search_catalog`, второй model call получает тот же полный
turn view плюс bounded результаты единственного поиска. Tool/model-call лимиты,
published-ID validation и public limit в три рекомендации не меняются.

## 6. Scope

В scope:

- fresh context query/projection текущего conversation window;
- direct `live_v2` turn input и model request budget;
- удаление доказанно дублирующего context-selection кода в затронутом пути;
- sanitized context-size observability, только если она нужна для проверки
  circuit breaker и использует существующий allowlisted metadata contract;
- unit, transcript, runtime integration и PostgreSQL coverage;
- актуализация `docs/AI_POLICY.md` после реализации.

Вне scope:

- смена модели, reasoning effort, prompt tone или catalog/handoff semantics;
- новая DB schema/migration или публичный widget contract;
- Responses API provider-managed conversation state/`previous_response_id`;
- summary, embeddings, RAG или retrieval по истории разговора;
- автоматическая PII-redaction raw message text;
- изменение retention/privacy policy;
- landing/widget/manager UI и другие репозитории;
- deploy, runtime configuration, secrets, платные model/eval calls;
- commit, push, PR или merge без отдельного разрешения.

Provider-managed conversation state не использовать: app-owned PostgreSQL
history, causal cursor, latest-wins, idempotency и send gate должны оставаться
воспроизводимым источником фактического model input.

## 7. TDD и критерии успеха

Сначала создать или обновить тесты и подтвердить ожидаемый RED на текущем
лимите.

- [ ] Диалог из acceptance-сценария приходит модели полностью и
  хронологически; сообщение 1 не исчезает.
- [ ] Более длинный типичный fixture (не менее 20 сообщений) не режется по
  количеству, если полный request помещается в budget.
- [ ] Текущий inbound присутствует ровно один раз даже при duplicate row/input.
- [ ] `respondsThroughSequence` исключает сообщения из будущего response
  window и сохраняет latest-wins semantics.
- [ ] Manager/system/non-text сообщения не попадают в model transcript.
- [ ] Separate profile contact values, internal/public IDs, timestamps,
  page/referrer URLs и unrestricted metadata не появляются в model-safe
  payload; raw visitor/assistant text проверяется как отдельная секция.
- [ ] Known slots/requirements и provenance сохраняются; current-message patch
  по-прежнему требует уникальную точную quote evidence.
- [ ] Search path передаёт тот же полный turn во второй model call, максимум
  восемь candidates и не более трёх public recommendations.
- [ ] Gate/takeover и stale attempt по-прежнему блокируют commit ответа.
- [ ] Искусственное превышение единого request budget даёт безопасный
  наблюдаемый fallback без silent truncation и без manager handoff.
- [ ] Новая observability не содержит raw transcript/PII.
- [ ] Файлы production source остаются в пределах project size policy; новую
  самостоятельную логику не добавлять в существующий файл больше 800 строк.

Минимальные проверки выбираются после code-derived blast-radius audit, но
обязательный ориентир:

```bash
npx vitest run \
  apps/api/test/live-v2-context.test.ts \
  apps/api/test/model-turn-orchestrator.test.ts \
  apps/api/test/catalog-show-transcript.test.ts \
  apps/api/test/m2-live-v2-runtime-integration.test.ts \
  --maxWorkers=1
npm run test:widget-ai:postgres
npm run typecheck:api
npm run check:architecture
npm run build
git diff --check
```

Если общий suite имеет старый красный baseline, отделить его свежим запуском на
base SHA или другим воспроизводимым доказательством. Не объявлять общий suite
зелёным по targeted checks.

Качественную проверку полного диалога можно выполнить обезличенными сценариями
через подписочный Codex Exec, как предложил владелец. Это не заменяет
детерминированные тесты и не разрешает платный API call.

## 8. Стоп-гейты и разрешения

Текущим поручением владелец одобрил для следующей сессии:

- замену bounded recent-message context на полный model-safe transcript
  текущей консультации;
- необходимые изменения context contract/prompt wording в этой узкой области;
- удаление доказанной дублирующей context-selection сложности;
- сохранение typed slots/requirements и одного общего app-owned budget gate.

Новая неоднозначность требует остановки, если она меняет:

- privacy/retention или redaction raw customer text;
- модель, reasoning effort, tool/handoff/catalog semantics;
- DB schema/migration или публичный контракт;
- provider-managed state или runtime ownership;
- другой репозиторий, staging/deploy, secrets или платные вызовы.

## 9. Self-review, независимый Reviewer и rollback

Перед завершением выполнить self-review exact diff с фокусом на:

- causal ordering и response-window isolation;
- duplicate/current-message handling;
- PII и raw transcript leakage в observability;
- input-budget false green и поведение overflow;
- stale turn, manager takeover и atomic send gate;
- скрытые callers удаляемых summary/bounded helpers;
- рост token usage/latency и отсутствие ложного утверждения о staging качестве.

Изменение нетривиальное: после self-review нужен свежий read-only Reviewer по
правилам `AGENTS.md`. Он проверяет точные требования, base SHA, final diff,
tests и непроверенные области и возвращает findings либо `accept`.

Rollback до публикации — удалить только diff этой задачи. После отдельного
commit/push — `git revert <task-commit-sha>`. Schema/data rollback не нужен,
поскольку migration и изменение persisted contract не входят в scope.

## 10. Передача следующей сессии

Следующая сессия сначала фиксирует фактические branch/base SHA и dirty state.
Указанный SHA является точкой подготовки карточки, а не разрешением работать
поверх сдвинувшейся ветки вслепую.

Итоговый отчёт должен содержать:

- фактический base/head SHA;
- что именно теперь получает первый и второй model call;
- какие старые limits/summary paths удалены или оставлены и почему;
- tests/checks и независимый verdict;
- измеренные request characters/input tokens на 5-, 9- и 20-message fixtures;
- непроверенные staging latency/quality/cost;
- changed files, `git diff --stat` и rollback;
- явное подтверждение отсутствия deploy, secrets и платного API call.
