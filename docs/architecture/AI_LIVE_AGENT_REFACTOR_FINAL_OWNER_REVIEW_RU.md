# Итоговый план работ

> **Хронология и статус:** это самое позднее итоговое ревью, переданное
> владельцем в текущем диалоге 2026-07-31. При расхождениях с более ранними
> вставленными ревью этот документ отражает более позднюю позицию владельца.
> До отдельной сверки с текущим SHA, кодом и принятыми ADR это входной
> архитектурный материал, а не автоматически утверждённый ADR или контракт
> реализации.

> **Актуализация 2026-08-06:** описания «сейчас», короткий roadmap и порядок
> PR0a—PR9 ниже фиксируют исторический baseline на момент ревью. PR0a—PR2 и
> CONV-1—CONV-3A уже реализованы, Mastra runtime и executable `legacy_s05`
> удалены. Текущий порядок работ задают
> `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md` и её active card: CONV-4,
> затем CONV-5 и общий teach-back. Этот документ сохраняет целевые продуктовые
> принципы, но не является параллельным active roadmap или описанием current
> runtime.

Цель проекта: сделать **живого AI-консультанта**, который отвечает актуально, по-человечески, без анкетного тона и без лишней передачи менеджеру. В ревью это сформулировано прямо: владелец хочет агента, который «отвечает как человек, а не тупящий консультант-анкета»; ревью также подтверждает, что текущая проблема не в слабой модели, а в том, что код перехватывает, переписывает и блокирует её ответы.

## Простыми словами: что сейчас происходит

Клиент пишет в чат. Система часто не даёт модели нормально ответить:

1. **До модели** сообщение перехватывают regex-правила.
   Например, фраза про маму может уйти в шаблон про дедушку; исправление города «установка в Гомеле» может не сохраниться; «ты что посоветуешь?» может ошибочно считаться раздражением.

2. **После модели** ответ может быть переписан renderer-ом.
   Слово «когда» может отправить обычный вопрос в deadline-воронку, а упоминание «гранит» может создать ложный дубль и передать разговор менеджеру.

3. **Verifier тормозит каждый ход.**
   Сейчас даже обычное «привет» проходит через LLM-проверщик, который может заблокировать ответ за «неестественный тон». Один ход может стоить 2–4 LLM-вызова и доходить до 18 секунд.

4. **Память и очередь работают против живого диалога.**
   Память — это обрезанный хвост переписки, а job хранит старый снимок мира. Если клиент пишет три сообщения подряд, система создаёт три ответа, каждый на устаревший кусок контекста.

Итоговый принцип новой архитектуры:

```text
одна очередь сообщений клиента
→ один свежий ход агента
→ один текст модели
→ одна проверка
→ одна транзакция сохранения
```

---

# Короткая версия roadmap

| Эпик                        | Смысл простыми словами                                         | Главный результат               |
| --------------------------- | -------------------------------------------------------------- | ------------------------------- |
| 0. Hotfix                   | Убрать самые опасные текущие баги                              | Меньше тупых ответов уже сейчас |
| 1. Тестовый каркас          | Зафиксировать баги и конкурентные инварианты                   | Безопасно рефакторить           |
| 2. Актуальный ход           | Отвечать на последнюю пачку сообщений, а не на старый snapshot | Burst не создаёт 3 ответа       |
| 3. Новый контракт агента    | Модель пишет финальный текст, код его не переписывает          | Исчезает шаблонный renderer     |
| 4. Нормальная память        | Факты имеют статусы: актуален, заменён, отменён                | Исправления клиента сохраняются |
| 5. Инструменты и retrieval  | Агент сам читает каталог через read-only tools                 | Меньше нерелевантных товаров    |
| 6. Risk-only verifier       | Проверять второй моделью только рискованные ответы             | Быстрее обычный диалог          |
| 7. Runtime rollout          | Sticky runtime, shadow без влияния на state                    | Безопасное включение v2         |
| 8. Observability и качество | Метрики скорости, стоимости, шаблонности                       | Видно, стал ли агент живее      |
| 9. Cleanup                  | Разрезать god-файлы и удалить старые механизмы                 | Код становится поддерживаемым   |

---

# Эпик 0. Hotfix: остановить самые громкие поломки

## Зачем

Есть несколько багов, которые можно исправить до большого v2-рефакторинга. Они уже портят диалоги: «дедушка», bare `когда`, `ты что`, перетирание `watching`, fail-open конфиг. Ревью прямо предлагает катить эти фиксы сразу.

## Что сделать

### 0.1. Config fail-closed

Файл:

```text
parseWidgetAiGroundedMode
```

Сейчас неизвестное значение env может включить `enforce`. Нужно:

```text
unknown value → off + error log on startup
```

## 0.2. Убрать самые вредные regex false-positive

Файлы:

```text
widget-ai-dialogue-control.ts
widget-ai-reply-renderer.ts
```

Удалить или ослабить:

```text
isOnePersonMemorialContext + дедушка-шаблон
isDeadlineIntakeRequest с bare "когда"
isFrustration с "ты что"
duplicateRequestedSlot → handoff
guardUnsupportedWidgetReply для кладбища/Минска
REPAIR_MARKER через видимый текст
```

## 0.3. Не перетирать manager/watching state

Файл:

```text
saveSiteWidgetAiMessage
```

Сейчас обычный AI-ответ может вернуть:

```text
aiState = ai_collecting_info
agentAllowedToReply = true
```

Даже если менеджер уже перевёл разговор в watching. Нужно сохранять текущее состояние, если оно не принадлежит AI.

## 0.4. Мини-debounce

В enqueue:

```ts
availableAt = now + 600ms
```

Это ещё не полноценный latest-wins, но уже уменьшит поток ответов на burst.

## Definition of Done

* «памятник для мамы, не разбираюсь» не даёт слово «дедушка»;
* «когда вы работаете?» не уходит в deadline-воронку;
* «ты что посоветуешь?» не считается раздражением;
* AI-ответ не перетирает manager/watching state;
* неизвестный env-режим не включает enforce.

---

# Эпик 1. Тестовый каркас: сначала зафиксировать инварианты

## Зачем

Текущие тесты в основном идут через `memory-intake-repository.ts`, который не воспроизводит реальные свойства PostgreSQL: `FOR UPDATE SKIP LOCKED`, lease expiry, partial indexes, параллельные транзакции. Ревью отдельно отмечает, что без PostgreSQL-тестов конкурентные инварианты фактически не проверены.

## Что сделать

Добавить тестовый набор:

```text
widget-ai-runtime-invariants.test.ts
widget-ai-concurrency.test.ts
widget-ai-fault-injection.test.ts
widget-ai-multiturn-baseline.test.ts
```

Лучше через Testcontainers или отдельный real Postgres test DB.

## Обязательные сценарии

| Сценарий                             | Что проверяем                          |
| ------------------------------------ | -------------------------------------- |
| Новое сообщение во время generation  | Старый ответ не отправляется           |
| Manager takeover во время generation | AI commit отклоняется                  |
| Crash после commit до finishJob      | Повтор job не создаёт второй ответ     |
| Два worker одновременно              | Коммит проходит один                   |
| Duplicate webhook                    | Нет второго message/job                |
| Lease expired во время model call    | Старый worker не может сохранить ответ |
| Burst из 3 сообщений                 | Один итоговый AI-ход                   |
| Shadow turn                          | Не пишет state и не делает handoff     |

## Definition of Done

* Есть реальные Postgres-тесты.
* Есть xfail/skip-спеки для будущих v2-инвариантов.
* Hotfix-регрессии из kill-list заведены тестами.

---

# Эпик 2. Актуальный ход: response window, epoch, latest-wins

## Простыми словами

Клиент часто пишет так:

```text
Хочу памятник
Для дедушки
Чёрный и строгий
```

Система должна ответить **один раз** на всю пачку, а не три раза на каждый кусок.

## Технически

Вводим две основные сущности:

```text
message_sequence
generation_epoch
```

Ревью предлагает упростить счётчики до `last_message_sequence` и `generation_epoch`; latest user seq и last consumed seq можно выводить из сообщений и committed ai_turns.

### 2.1. `message_sequence`

В conversation:

```sql
last_message_sequence bigint not null default 0
```

При вставке любого сообщения:

```sql
UPDATE conversations
SET last_message_sequence = last_message_sequence + 1
WHERE id = $conversation_id
RETURNING last_message_sequence;
```

Это значение пишется в:

```text
conversation_messages.message_sequence
```

### 2.2. `generation_epoch`

Увеличивается при событиях, после которых старый AI-ответ нельзя отправлять:

```text
новое сообщение клиента
сообщение менеджера
manager takeover
AI disable/enable
conversation close
смена runtime mode
```

### 2.3. Job больше не хранит полный snapshot

Сейчас job хранит `AiTurnInput` целиком. Это создаёт протухший контекст. Нужно хранить ссылку:

```ts
type WidgetAiJobV3 = {
  conversationId: string;
  expectedGenerationEpoch: number;
  respondsThroughSequence: number;
};
```

Актуальный state собирается в момент выполнения job.

### 2.4. Response window

AI-ход отвечает не на один `inboundMessageId`, а на диапазон:

```text
messages after last committed AI turn
through latest visitor message sequence
```

Идемпотентность:

```sql
UNIQUE (
  conversation_id,
  generation_epoch,
  responds_through_sequence,
  runtime_mode
)
```

Ревью отдельно указывает, что при переходе на response window старый ключ `ai:${inboundMessageId}` исчезает, и этот миграционный шов нужно закрыть в том же PR.

### 2.5. Latest-wins на текущей очереди

Ревью предлагает не мигрировать сразу на Graphile Worker: в проекте уже есть SKIP LOCKED-очередь, lease/retry/idempotency, а latest-wins можно сделать поверх существующей таблицы.

Нужное поведение:

```text
новое сообщение
→ supersede старый pending job
→ поставить новый job на now + debounce
→ если old processing закончит позже, commit fence его отклонит
```

### 2.6. Commit fence

Перед сохранением ответа:

```sql
SELECT *
FROM conversations
WHERE id = $conversation_id
FOR UPDATE;
```

Проверки:

```text
conversation.generation_epoch == job.expectedGenerationEpoch
latest visitor message sequence == job.respondsThroughSequence
responder_mode == 'ai'
conversation is open
agentAllowedToReply == true
```

Если проверка не прошла:

```text
не отправлять ответ
пометить job как stale/superseded
создать новый job при необходимости
```

## Файлы

```text
postgres-intake-repository.ts
public-intake-repository.ts
widget-ai-job-worker.ts
public-widget-intake-service.ts
schema.ts
migrations/*.sql
```

## Definition of Done

* Burst из 3 сообщений даёт 1 ответ.
* Ответ собирается по свежему state.
* Старый processing job не может отправить ответ после нового сообщения.
* Manager takeover блокирует AI commit.
* Commit ответа и finish job происходят в одной транзакции.

---

# Эпик 3. Новый контракт агента: модель предлагает, код проверяет

## Простыми словами

Модель должна говорить нормальным текстом. Код не должен после неё заменять ответ на шаблон.

## Текущая проблема

Сейчас verifier проверяет один текст, а потом `normalizeWidgetAiReplyPlan`, renderer, URL stripper и guard могут изменить его. При этом metadata всё равно пишет `grounding_verified: true`. Ревью описывает четыре мутации после проверки.

## Новый контракт

### 3.1. Model output

```ts
type ModelTurnOutput = {
  version: "granit_model_turn.v1";

  message: {
    answerText: string;

    question?: {
      text: string;
      target: PendingQuestionTarget;
    };
  };

  statePatches: ProposedStatePatch[];

  recommendationIds: string[];

  handoffIntent?: {
    reason:
      | "customer_requested_manager"
      | "customer_wants_final_quote"
      | "customer_ready_to_order";
  };
};
```

### 3.2. Canonical final text

Модель не возвращает `finalText` напрямую. Сервер собирает его один раз:

```ts
function composeFinalText(message) {
  if (!message.question) return message.answerText.trim();

  return [
    message.answerText.trim(),
    message.question.text.trim()
  ].join("\n\n");
}
```

Правило:

```text
answerText не должен заканчиваться вопросом, если question уже есть
```

Если есть дубль:

```text
structural repair один раз
```

Ревью прямо предлагает анти-дубль для canonical finalText, иначе модель может продублировать вопрос в обеих секциях.

### 3.3. ValidatedTurnPlan

После model output код создаёт:

```ts
type ValidatedTurnPlan = {
  finalText: string;
  finalTextHash: string;

  appliedPatches: ValidatedStatePatch[];
  droppedPatches: RejectedStatePatch[];

  recommendationCards: CatalogCard[];

  riskAssessment: RiskAssessment;
  validationResults: ValidationResult[];

  handoffAction?: ValidatedHandoffAction;
};
```

### 3.4. Запрет на смысловую мутацию

После `ValidatedTurnPlan`:

```text
finalText immutable
```

Renderer может добавить:

```text
карточки
кнопки
metadata
```

Но не может менять обычный текст ответа.

## Что удалить или оставить только как technical gates

Удалить как смысловые механизмы:

```text
normalizeWidgetAiReplyPlan
renderWidgetAiPlannedReply
stripVerifiedCatalogUrls
guardUnsupportedWidgetReply
buildWidgetAiDialogueControlReply
```

Оставить ранними техническими gates:

```text
AI off
manager active
explicit human request
unsupported/forbidden content
critical system failure
```

## Файлы

```text
grounded-widget-ai-service.ts
widget-ai-reply-renderer.ts
widget-ai-dialogue-control.ts
widget-ai-prompt.ts
widget-ai-semantic-verifier.ts
```

## Definition of Done

* Текст модели не переписывается после проверки.
* В metadata не пишется `grounding_verified: true` для текста, который verifier не видел.
* В обычном ответе нет принудительного «Для расчёта сначала уточним детали».
* `finalTextHash` сохраняется в `ai_turns`.

---

# Эпик 4. Нормальная память: facts, slots, corrections

## Простыми словами

Если клиент сказал:

```text
Я про Минск не говорил, установка в Гомеле
```

Система должна:

```text
отменить Минск
сохранить Гомель
не переспросить город снова
```

Сейчас correction может перехватываться regex-шаблоном до модели, и новый факт не сохраняется.

## Технически

Не добавляем новый `conversation_facts` как второй source of truth. Расширяем существующие таблицы:

```text
conversation_slots
conversation_slot_events
conversation_requirements
```

Ревью считает отдельный `conversation_facts` рядом со slots/events/requirements вторым source of truth.

### 4.1. Slots

Добавить статусы:

```text
active
tentative
retracted
superseded
```

### 4.2. Slot events

Добавить операции:

```text
set
confirm
supersede
retract
```

### 4.3. Requirements

Для предпочтений:

```text
active
retracted
superseded
```

Пример:

```text
без золота
→ active avoidance

хотя тонкая золотая надпись нормально
→ старое "без золота" superseded/retracted
→ новое preference active
```

### 4.4. Pending question

Добавить таблицу:

```text
conversation_pending_questions
```

Правило простое:

```text
активный вопрос живёт ровно до следующего response window клиента
новый вопрос ассистента отменяет предыдущий
```

Это закрывает проблему коротких ответов:

```text
да
нет
ага
```

Они имеют смысл только если есть активный вопрос.

### 4.5. Evidence без offsets от модели

Модель возвращает:

```ts
{
  sourceMessageId: "...",
  quote: "установка в Гомеле"
}
```

Код сам:

```text
нормализует текст
ищет quote
вычисляет offsets
отклоняет ambiguous quote
```

Ревью отмечает, что требование точных UTF-16 offsets заставляет модель не извлекать факты.

## Файлы

```text
postgres-intake-repository.ts
conversation-state-reader.ts
conversation-slot-evidence-service.ts
ai-slot-evidence-service.ts
widget-ai-prompt.ts
migrations/*.sql
```

## Definition of Done

* Correction города сохраняет новый город и ретрактит старый.
* «Да» обновляет только target активного вопроса.
* Preferences можно отменять и заменять.
* Модель не возвращает UTF-16 offsets.
* Summary не является источником истины для slots.

---

# Эпик 5. Инструменты и retrieval: агент читает каталог, но не пишет в систему

## Простыми словами

Агенту надо дать нормальный доступ к знаниям:

```text
каталог
советы по выбору
география/зона услуг
```

Но инструменты должны быть только на чтение. Агент не должен сам создавать handoff, менять state или отправлять ссылки.

## Решение

Выбрать **bounded tool-loop**, а не отдельный `RetrievalPlan`. Ревью прямо говорит, что RetrievalPlan и tool-loop конкурируют, и рекомендует выбрать одно. Рекомендация — tool-loop с 2–3 шагами.

## Инструменты

```ts
search_catalog({
  query,
  kind?,
  constraints?,
  limit
})

get_approved_advice({
  topic,
  constraints?
})

check_service_area({
  city,
  cemetery?
})
```

Ограничения:

```text
maxSteps = 3
maxToolCalls = 2
tools read-only
no DB writes
no handoff side effects
no direct URLs from model
```

## Retrieval v2

Заменить текущий token-overlap на:

```text
PostgreSQL FTS russian
pg_trgm
kind filters
aliases
published=true
structured filters
```

Текущий retrieval описан как token-overlap без русской морфологии, из-за чего запросы могут поднимать нерелевантные записи.

## Evidence cards

Для коммерческих полей:

```ts
type EvidenceCard = {
  recordId: string;
  revision: string;
  title: string;
  claims: Array<{
    claimId: string;
    kind: "material" | "dimension" | "price" | "availability" | "service";
    text: string;
    normalizedValue?: unknown;
  }>;
};
```

Модель возвращает:

```text
recommendationIds
usedClaimIds для price/dimension/availability
```

Ссылки строит сервер.

## Файлы

```text
file-catalog-knowledge-provider.ts
catalog-knowledge-port.ts
widget-ai-prompt.ts
agent-runner-port.ts
catalog-tool.ts
approved-advice-tool.ts
service-area-tool.ts
```

## Definition of Done

* «чёрный двойной памятник» ищет monument-like records, а не фотокерамику.
* Модель не пишет URL.
* Сервер проверяет recordId/revision/published.
* Простые сообщения не тянут каталог без необходимости.
* Каталог возвращает компактные карточки, а не 12 полных записей.

---

# Эпик 6. Risk-only verifier: убрать вторую модель из каждого хода

## Простыми словами

Не надо проверять второй моделью каждую фразу. Это дорого и медленно. Проверять нужно только то, где ошибка реально опасна:

```text
точная цена
договорные условия
сроки
обещание установки
коммерческое обязательство
```

## Текущая проблема

Verifier сейчас вызывается на каждом ходе, проверяет tone/helpfulness и может запустить repair-loop. Это даёт 2–4 LLM-вызова на обычный ответ.

## Новый порядок

```text
ModelTurnOutput
→ deterministic validation
→ risk assessment by server
→ semantic verifier only if high/commercial risk
→ commit
```

## Что убрать из blocker-ов

```text
unnatural_tone
unhelpful_response
```

Они должны стать eval-сигналами, а не причиной блокировки живого ответа.

## Verifier без span offsets

Verifier проверяет:

```text
есть ли неподтверждённая цена
есть ли неподтверждённый срок
есть ли claims без evidence
есть ли опасное обещание
```

Он не должен требовать точные UTF-16 координаты.

## Файлы

```text
widget-ai-semantic-verifier.ts
grounded-widget-ai-service.ts
deterministic-turn-validator.ts
risk-policy.ts
```

## Definition of Done

* Smalltalk и обычные уточнения проходят без verifier.
* Рискованные claims без evidence не отправляются.
* Verifier не может напрямую делать handoff.
* Средний ход становится одним LLM-вызовом + tools при необходимости.

---

# Эпик 7. Runtime rollout: sticky version и read-only shadow

## Простыми словами

Нельзя включить новую архитектуру всем сразу. Нужно запускать v2 на части разговоров и сравнивать с v1 так, чтобы shadow-ветка ничего не ломала.

## Что сделать

### 7.1. Runtime version per conversation

```sql
conversations.ai_runtime_version text
```

Назначается при создании conversation:

```text
legacy
v2_shadow
v2_enforce
```

Один разговор должен проходить через один runtime до закрытия или явной миграции.

### 7.2. Shadow только read-only

Shadow не должен:

```text
писать state
создавать pending question
делать handoff
отправлять сообщение
менять aiState
```

Ревью также отмечает, что текущий shadow гоняет обе ветки на request path и удваивает live-путь.

### 7.3. Порядок rollout

```text
offline replay
→ sampled shadow
→ 5% sticky enforce
→ 25%
→ 100%
```

## Файлы

```text
runtime-mode-resolver.ts
shadow-widget-ai-reply-generator.ts
public-widget-intake-service.ts
schema.ts
migrations/*.sql
```

## Definition of Done

* Shadow не пишет в production state.
* Runtime version sticky внутри conversation.
* Есть сравнение v1/v2 по trace и eval.
* Rollback переключает только новые conversations или явно мигрированные.

---

# Эпик 8. Observability, handoff UX и метрики качества

## Простыми словами

Нужно видеть не только «ответил/не ответил», а:

```text
насколько быстро
сколько стоило
почему ушёл менеджеру
повторил ли вопрос
ответил ли на вопрос клиента
звучит ли шаблонно
```

## Production-инварианты

Должны быть 0:

```text
stale_reply_sent
duplicate_reply_sent
unverified_high_risk_reply
commit_after_takeover
reply_overwrites_manager_state
```

Ревью предлагает именно такие staging acceptance-метрики.

## Performance

Целевой бюджет из ревью:

```text
p50 total ≤ 3.5s
p95 total ≤ 7s
```

Также добавить:

```text
cost_per_committed_turn
queue_wait_ms
generation_ms
tool_ms
validation_ms
commit_ms
superseded_generation_count
```

Ревью отдельно предлагает `cost_per_committed_turn` как детектор возвращения к дорогому 4-вызовному циклу.

## Quality eval

Offline judge:

```text
explicit_question_answered > 85%
repeated_question < 5%
unnecessary_handoff < 10%
доля ходов с вопросом < 60%
доля шаблонных зачинов < 5%
correction_applied > 90%
```

Шаблонные зачины:

```text
Понял:
Фиксирую:
Для расчёта сначала уточним детали
Передам менеджеру
```

## Warm handoff

Разделить состояния:

```text
responder_mode:
  ai
  manager
  shared

escalation_status:
  none
  manager_notified
  transfer_requested
  manager_accepted
```

Поведение:

```text
customer_ready_to_order
→ notify manager
→ AI продолжает отвечать

explicit human request
→ transfer_requested
→ AI сообщает о передаче

manager accepted
→ generation_epoch++
→ active AI run cancelled
```

## Файлы

```text
quality-events.ts
ai-run-attempts.ts
handoff-service.ts
manager-notification-outbox.ts
widget-events.ts
```

## Definition of Done

* У каждого handoff есть причина.
* Есть latency/cost dashboard.
* Есть nightly eval на шаблонность.
* Manager notification не останавливает AI без реального takeover.
* Виджет получает `agent_thinking` / `manager_joined` events.

---

# Эпик 9. Structural cleanup: резать god-файлы после стабилизации поведения

## Зачем не раньше

Ревью предлагает сначала починить correctness и runtime, а уже потом дробить большие файлы. Иначе одновременно меняются SQL, поведение, ownership модулей и структура кода. Итоговый порядок PR в ревью ставит structural cleanup последним.

## Что разрезать

### Было

```text
postgres-intake-repository.ts
public-widget-intake-service.ts
widget-ai-reply-renderer.ts
widget-ai-dialogue-control.ts
grounded-widget-ai-service.ts
```

### Стать должно

```text
modules/intake/
  public-widget-intake-service.ts
  site-widget-message-ingress.ts

modules/conversations/
  conversation-turn-store.ts
  conversation-state-reader.ts
  conversation-control-service.ts

modules/ai/runtime/
  agent-turn-coordinator.ts
  model-turn-output.ts
  validated-turn-plan.ts
  deterministic-turn-validator.ts
  agent-runner-port.ts

modules/ai/tools/
  catalog-tool.ts
  approved-advice-tool.ts
  service-area-tool.ts

modules/ai/jobs/
  widget-ai-job-worker.ts
  widget-ai-turn-task.ts

modules/ai/observability/
  ai-run-attempt-store.ts
  quality-event-store.ts
```

## Принцип

Не делать интерфейс на каждую функцию. Ports нужны только на внешних границах:

```text
AgentRunner
KnowledgeSearch
JobScheduler
TraceSink
Clock
```

Чистые проверки оставить функциями:

```ts
validateEvidence()
validateStatePatches()
assessRisk()
composeFinalText()
validateRecommendationIds()
```

## Definition of Done

* Старые смысловые renderer/policy удалены.
* Legacy v1 AI-path удалён или закрыт feature flag.
* God-файлы уменьшены.
* Новая структура не меняет поведение, только раскладывает уже зелёный runtime.

---

# Итоговый порядок PR

Это объединённый порядок из ревью, адаптированный под реализацию.

## PR 0a. Postgres test harness

```text
Testcontainers / real Postgres
concurrency tests
fault-injection specs
baseline multi-turn cases
```

## PR 0c. Hotfix

```text
fail-closed config
дедушка
bare "когда"
"ты что"
не перетирать watching
простое availableAt +600ms
kill-list tests как xfail/active
```

## PR 1. Turn identity

```text
message_sequence
generation_epoch
responds_through_sequence в job
epoch increments на invalidating events
```

## PR 2. Latest-wins на своей очереди

```text
supersede pending
debounce
fresh assembler
response window
turn-key idempotency
commit + finish job в одной транзакции
local AbortController
agent_thinking event
убрать синхронный v1 AI из HTTP path
```

## PR 3. ModelTurnOutput → ValidatedTurnPlan → CommittedTurn

```text
короткий output contract
canonical finalText
quote-only evidence
server-derived risk
удаление смыслового renderer/policy
новый prompt с few-shot примерами
kill-list tests обязательные
```

## PR 4. State patches на существующих таблицах

```text
slot statuses
slot event operations
requirement statuses
pending questions
correction/retract/supersede
async semantic summary with watermark
```

## PR 5. Bounded tools + retrieval v2

```text
search_catalog
get_approved_advice
check_service_area
maxSteps=3
Postgres FTS russian
pg_trgm
kind filters
claim cards
```

## PR 6. Risk-only verifier

```text
deterministic checks first
semantic verifier only for commercial/binding claims
no span-offsets
no handoff from verifier
tone/helpfulness → eval only
```

## PR 7. Sticky runtime + read-only shadow

```text
ai_runtime_version
sampled shadow in worker
no state writes from shadow
offline comparison
```

## PR 8. Observability + handoff UX

```text
responder_mode
escalation_status
Langfuse/OTel optional
cost_per_committed_turn
template judge
warm handoff
status events
```

## PR 9. Structural cleanup

```text
split god files
delete legacy renderer/policy/worker
remove old funnel assertions
document final runtime
```

---

# Главное для программиста: какие правила держать в голове

## 1. Модель не пишет в базу

Модель возвращает proposal:

```text
ответ
предложенные изменения памяти
рекомендованные record IDs
handoff intent
```

Код валидирует и коммитит.

## 2. Текст после проверки не меняется

```text
compose finalText
validate
optional verifier
hash
commit
```

После hash никакой TypeScript не переписывает текст.

## 3. Один пользовательский burst = один AI-ход

```text
message 41
message 42
message 43
→ one job
→ one response window
→ one answer
```

## 4. Старый ответ не имеет права на commit

Любое invalidating event:

```text
new message
manager takeover
AI off
close
runtime switch
```

увеличивает `generation_epoch`.

## 5. Regex не понимает клиента

Regex можно использовать для технических gates:

```text
AI disabled
manager active
explicit human request
forbidden content
```

Нельзя использовать regex для:

```text
исправления города
раздражения
неуверенности
выбора следующего вопроса
deadline по слову "когда"
дубля slot по слову "гранит"
```

## 6. Verifier не судит стиль на live-path

Стиль проверяется offline judge. Live verifier проверяет только рискованные claims.

---

# Минимальный Definition of Done для v2

На staging должны пройти такие сценарии:

```text
1. Клиент пишет 3 сообщения подряд → получает 1 ответ.
2. Клиент исправляет город → старый город retracted, новый active.
3. Клиент пишет "ты что посоветуешь?" → получает рекомендацию, не извинение.
4. Клиент спрашивает "когда вы работаете?" → получает режим работы/ответ, не deadline funnel.
5. Менеджер забирает диалог во время generation → AI ничего не отправляет.
6. Модель рекомендует товар → сервер проверяет recordId/revision/published.
7. Обычный smalltalk проходит без semantic verifier.
8. Ответ не начинается шаблонно чаще 5% на eval-корпусе.
9. p50 total ≤ 3.5s, p95 ≤ 7s при 5 параллельных диалогах.
10. stale_reply_sent, duplicate_reply_sent, commit_after_takeover = 0.
```

---

# Самое важное решение

Не начинать с мультиагентов, LangGraph, Graphile, Mastra или нового workflow-runtime. В ревью уже есть вывод: текущий проект можно починить на собственной очереди и bounded single-agent loop; внешние платформы сейчас добавят миграционную сложность.

Рабочая целевая схема:

```text
ваш код держит порядок, state, транзакции и безопасность
модель пишет нормальный человеческий ответ
tools дают модели знания только на чтение
validator проверяет факты
commit сохраняет всё атомарно
eval следит, чтобы шаблоны не вернулись
```

Финальный результат, к которому ведёт план: **один актуальный ход, один свой текст модели, одна транзакция — и меньше кода, который имитирует понимание через regex и шаблоны**.
