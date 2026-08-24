# Итоговая оценка

> **Актуализация 2026-08-06:** current-state описания и «Приоритет переделки»
> ниже являются историческим baseline исходного owner review. PR0a—PR2 и
> CONV-1—CONV-3A уже реализованы; Mastra runtime и executable `legacy_s05`
> удалены. Текущий implementation order задают
> завершённая `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md`; текущий порядок
> задают `docs/tasks/AI_LAYER_SIMPLIFICATION_GOAL_RU.md` и её active card.
> Сохраняются архитектурные инварианты этого
> документа, но он не задаёт второй active roadmap и не описывает current
> runtime без сверки с кодом на текущем SHA.

В проекте хорошо сделана **операционная надёжность**:

* входящее сообщение сохраняется до запуска ИИ;
* есть durable jobs, lease, retry и idempotency;
* отправка ответа проходит через атомарный send gate;
* менеджер может перехватить диалог;
* каталог версионируется, хранит provenance и published-состояние;
* используются строгие схемы структурированного ответа;
* предусмотрены shadow/off/enforce-режимы и журналирование AI-run.

Эту часть стоит сохранить.

Проблемы сосредоточены в разговорном контуре. Сейчас один ход проходит примерно такую цепочку:

```text
dialogue policy
    ↓
catalog retrieval
    ↓
LLM generator
    ↓
structural validator
    ↓
LLM semantic verifier
    ↓
optional repair
    ↓
plan normalizer
    ↓
deterministic renderer
    ↓
regex guard
    ↓
send gate
```

На нескольких этапах меняются смысл, действие или формулировка ответа. На ценах, сроках, исправлениях пользователя, раздражении и неуверенности итоговую реплику часто формирует приложение по шаблону. Модель участвует в подготовке черновика, но не всегда управляет фактическим ходом разговора.

Моя субъективная оценка по приложенному коду:

| Область                             | Оценка |
| ----------------------------------- | -----: |
| Надёжность хранения и доставки      |   8/10 |
| Контроль коммерческих галлюцинаций  |   7/10 |
| Масштабируемость AI-воркера         |   4/10 |
| Память диалога                      |   4/10 |
| Качество retrieval                  |   3/10 |
| Естественность консультанта         | 3–4/10 |
| Поддерживаемость разговорной логики |   4/10 |

Ниже — конкретные места, где система будет «тупить».

---

# 1. Агент отвечает на устаревшее состояние диалога

Это один из самых серьёзных дефектов.

В `postgres-intake-repository.ts:470-572` при получении сообщения собирается полный `AiTurnInput`:

* последние сообщения;
* слоты;
* requirements;
* rolling summary;
* прочий контекст.

Этот снимок сохраняется прямо в `widget_ai_jobs.input_payload`.

Затем воркер в `public-widget-intake-service.ts:487-516` использует сохранённый снимок. Перед генерацией он не пересобирает актуальное состояние разговора.

## Как это проявится

Клиент быстро пишет:

```text
Хочу памятник
Для дедушки
Черный, строгий, без золота
```

Система может создать три AI-job:

1. ответить на «Хочу памятник»;
2. ответить на «Для дедушки»;
3. ответить на «Черный, строгий, без золота».

Каждый job содержит собственную старую версию контекста. Ответы будут уходить по очереди. В результате консультант:

* задаст вопрос, на который клиент уже ответил;
* проигнорирует последнее уточнение;
* повторит вступление;
* начнёт три отдельных мини-диалога;
* будет выглядеть медленным и невнимательным.

В `postgres-intake-repository.ts:1165-1199` выбор job дополнительно запрещает брать более новый job разговора, пока есть старый pending/processing. Это сохраняет порядок, но заставляет систему отрабатывать уже потерявшие актуальность ходы.

## Что изменить

Job должен хранить:

```ts
{
  conversationId,
  inboundMessageId,
  turnSequence,
  expectedConversationRevision
}
```

Авторитетный контекст нужно собирать в момент выполнения job.

Перед отправкой ответа send gate должен проверять:

```text
last_inbound_message_id == job.inbound_message_id
conversation_revision == job.expected_revision
```

Когда пришло новое сообщение:

* старый pending-job получает статус `superseded`;
* processing-job может закончить генерацию, но его результат не отправляется;
* несколько сообщений за короткий интервал объединяются в один ход.

Практический debounce для виджета:

```text
400–700 мс после последнего сообщения
```

Это особенно важно для живого чата, где люди часто дробят мысль на три сообщения.

---

# 2. AI-воркер обрабатывает одну задачу за раз

`widget-ai-job-worker.ts:18-77`:

* забирает один job;
* полностью ждёт retrieval, generator, verifier и persistence;
* только после этого начинает следующий.

В `app.ts:53-75` на один API-процесс запускается один экземпляр воркера.

В приложенных evidence-документах нормальные grounded-turn занимали примерно:

* `9.958 сек`;
* `12.775 сек`.

Ходы около `0.7 сек` проходили через детерминированные policy-ветки без полного AI-контура.

При одном процессе практический предел получается около одного полноценного ответа за 10 секунд. Пять посетителей создадут заметную очередь. При этом виджет продолжит показывать, что система принимает сообщения.

## Исправление

Нужен ограниченный worker pool:

```ts
globalAiConcurrency = 4
perConversationConcurrency = 1
```

Обязательны:

* последовательность внутри одного разговора;
* параллельность между разными разговорами;
* supersede устаревших job;
* отдельные лимиты вызовов модели;
* метрика queue wait time.

Полезные метрики:

```text
job_queue_wait_ms
context_assembly_ms
retrieval_ms
generator_ms
verifier_ms
commit_ms
total_turn_ms
superseded_jobs_count
```

Сейчас общая latency есть, но понять источник задержки трудно.

---

# 3. Проверяется один текст, клиенту отправляется другой

Это архитектурная ошибка на границе безопасности.

В `grounded-widget-ai-service.ts:315-403` после успешного semantic verifier происходят дополнительные преобразования:

1. `normalizeWidgetAiReplyPlan`;
2. `renderWidgetAiPlannedReply`;
3. удаление URL;
4. regex guard;
5. финальное определение action/text.

Semantic verifier проверял `decision.replyText`. После этого renderer может сформировать другой текст. При этом результат всё равно получает:

```ts
grounding_verified: true
```

Вместе с этим могут сохраняться исходные:

* slot updates;
* requirement updates;
* catalog references;
* verifier verdict.

Получается недостоверная телеметрия: проверен один payload, отправлен другой.

`toRenderedFallbackReply` в `grounded-widget-ai-service.ts:425-437` также маркирует policy-шаблон как `grounding_verified: true`, хотя semantic verifier этот текст не анализировал.

## Чем это опасно

Например:

1. модель подготовила содержательный ответ;
2. verifier подтвердил его;
3. normalizer решил, что нужен handoff;
4. renderer заменил ответ шаблоном;
5. catalog references и state updates остались от первоначального ответа;
6. журнал показывает successful grounded turn.

После этого невозможно точно установить:

* что видел verifier;
* что увидел пользователь;
* из какого текста извлечены слоты;
* почему произошёл handoff.

## Нужное правило

После проверки финальный текст должен быть неизменяемым.

Допустимы два типа ответа:

### Ответ модели

```ts
{
  origin: "model",
  finalText: "...",
  claimsVerified: true,
  verifiedPayloadHash: "..."
}
```

### Шаблон приложения

```ts
{
  origin: "app_template",
  finalText: "...",
  claimsVerified: "not_applicable",
  templateId: "explicit_manager_handoff"
}
```

Любое изменение `finalText` после verifier требует проверки уже изменённого текста.

Ещё лучше: renderer должен оформлять только структурные части интерфейса — карточки, кнопки, ссылки. Формулировку обычной реплики следует завершать до verifier.

---

# 4. Renderer превращает разговор в анкету

В `widget-ai-reply-renderer.ts:37-119` находится жёсткая нормализация price/deadline/final quote.

Далее `widget-ai-reply-renderer.ts:122-184` формирует шаблонные ответы для:

* цены;
* срока;
* handoff.

В `nextCalculationSlot` около строк `275-283` прописан фиксированный порядок:

```text
monumentType → material → size
```

В `widget-ai-reply-renderer.ts:335-374` находятся фиксированные вопросы.

Поэтому пользователь может спросить:

> Сколько примерно стоит простой чёрный памятник для одного человека?

Модель способна дать полезную ориентацию, объяснить диапазон и назвать факторы. Renderer может отбросить этот ответ и отправить:

> Для расчёта сначала уточним детали. Какой тип памятника вас интересует?

Человек уже сказал «для одного человека» и «простой чёрный». Система продолжает двигаться по своему внутреннему funnel.

## Почему это особенно портит впечатление

Живой консультант обычно выполняет три действия:

1. отвечает на явный вопрос;
2. использует уже названные сведения;
3. задаёт только то уточнение, которое действительно влияет на следующий шаг.

Текущий renderer часто начинает с пункта 3.

## Как переделать

Уберите фиксированный slot funnel из renderer.

Модель должна возвращать:

```ts
{
  responseAct: "answer_and_clarify",
  answer: "Ориентировочная стоимость зависит...",
  nextQuestion: {
    slot: "size",
    reason: "размер сильнее всего влияет на расчёт при уже известном материале"
  }
}
```

Policy может ограничивать число вопросов:

```ts
maxQuestionsPerTurn = 1
```

Выбор вопроса должен зависеть от:

* того, что уже известно;
* текущего намерения пользователя;
* влияния параметра на ответ;
* ожидаемой информационной ценности;
* предыдущих вопросов.

Renderer после этого только соединяет `answer` и `nextQuestion` без переписывания смысла.

---

# 5. В коде зашиты реакции на отдельные инциденты

`widget-ai-dialogue-control.ts` содержит очень специфические правила:

* точный repair marker;
* шаблоны для correction/frustration/uncertainty;
* отдельную Minsk/cemetery-логику;
* regex по городу и кладбищу;
* дедушка/бабушка/отец/мать;
* определение ранее заданных вопросов через поиск слов в тексте.

В `grounded-widget-ai-service.ts:113-118` эти правила могут завершить обработку до generator. В таком ходе модель не получает возможности нормально:

* понять всё сообщение;
* извлечь несколько предпочтений;
* обработать коррекцию;
* обновить состояние;
* сформулировать ответ под конкретный контекст.

## Пример потери информации

Пользователь:

> Я вообще не разбираюсь, хочу высокий строгий памятник без золота.

Фраза «не разбираюсь» может активировать canned uncertainty-reply. При этом полезные сведения:

* высокий;
* строгий;
* без золота

могут не попасть в state updates.

Другой пример:

> Я ничего про Минск не говорил, установка будет в Гомеле.

Policy может извиниться за Минск. При этом:

* старая география останется в памяти;
* Гомель не будет установлен как новое значение;
* отсутствует операция `retract` для прежнего предположения.

## Что оставить детерминированным

Ранний bypass оправдан для небольшого числа однозначных ситуаций:

* пользователь явно попросил человека;
* менеджер уже ведёт разговор;
* канал отключён;
* обнаружено запрещённое действие;
* системная ошибка не позволяет безопасно ответить.

Раздражение, неуверенность, исправление и неоднозначность должны поступать в общий dialogue planner. Это обычные речевые акты:

```ts
userAct:
  | "ask"
  | "provide"
  | "confirm"
  | "reject"
  | "correct"
  | "complain"
  | "request_handoff"
```

Для каждого акта нужна обработка состояния, а не только выбор готовой фразы.

---

# 6. Одна и та же политика размазана по нескольким слоям

Сейчас решения о поведении находятся одновременно в:

* `prompts/widget-ai-prompt.ts`;
* `policy/widget-ai-policy.ts`;
* `widget-ai-dialogue-control.ts`;
* semantic verifier instructions;
* reply normalizer;
* reply renderer;
* intake-validator;
* unsafe regex guard.

Например, правило «не повторять вопрос» может проверяться:

* в prompt;
* через `inferAskedSlots`;
* verifier;
* renderer;
* regression corpus.

При изменении поведения приходится синхронно править несколько реализаций. Одна из них почти неизбежно останется старой.

Также есть расхождение путей:

* legacy `WidgetAiService` вызывает полный policy;
* grounded service выполняет только часть pre-policy;
* off/shadow/enforce могут вести себя по-разному.

## Рекомендуемая ответственность слоёв

### Dialogue planner

Решает:

* что пользователь сделал;
* что обновить в состоянии;
* на что ответить;
* нужен ли retrieval;
* какой риск у ответа;
* какой следующий вопрос уместен.

### Knowledge retriever

Возвращает компактные источники по структурированным ограничениям.

### Response generator

Формирует окончательный текст.

### Safety/grounding validator

Проверяет факты, IDs, цены, сроки и state operations.

### Renderer

Создаёт UI-компоненты:

* карточку товара;
* CTA;
* кнопку вызова менеджера;
* форматирование.

Renderer не должен выбирать вопрос и переписывать обычный ответ.

---

# 7. `rollingSummary` фактически является обрезанным логом

В `postgres-intake-repository.ts:2702-2711` summary строится добавлением строк вида:

```text
[время] Клиент: ...
[время] Ассистент: ...
```

В `postgres-intake-repository.ts:2757-2764` сохраняются последние 12 000 символов хвоста.

Параллельно в prompt передаются:

* recent messages;
* slots;
* requirements;
* rolling summary.

Таким образом, одни сведения попадают в контекст несколько раз.

## Последствия

* старые ошибки ассистента сохраняются как часть памяти;
* модель видит свои прежние предположения и может принять их за факт;
* начало истории отрезается на случайной границе;
* важное решение может исчезнуть, а незначительный small talk остаться;
* растут токены и latency;
* модель начинает повторять старые формулировки.

## Как должна выглядеть память

Нужна структурированная память разговора:

```ts
type ConversationState = {
  revision: number;

  customerGoal?: string;

  activeFacts: Array<{
    id: string;
    key: string;
    value: string;
    sourceMessageId: string;
    confidence: number;
  }>;

  preferences: Array<{
    id: string;
    value: string;
    status: "active" | "retracted" | "superseded";
  }>;

  rejectedAssumptions: Array<{
    value: string;
    correctedAtMessageId: string;
  }>;

  pendingQuestion?: {
    id: string;
    kind: "boolean" | "choice" | "free_text";
    slot?: string;
    askedAtTurn: number;
  };

  unresolvedTopics: string[];
  lastAgentAct?: string;
  semanticSummary: string;
};
```

`semanticSummary` должен содержать только устойчивую информацию:

```text
Клиент выбирает одиночный памятник для дедушки.
Предпочитает строгую форму, чёрный гранит, без золочения.
Установка планируется в Гомеле.
Размер пока не определён.
Клиент спросил ориентир по цене.
```

Не следует переносить в summary неподтверждённые утверждения ассистента.

---

# 8. Нет полноценной модели исправления и отмены фактов

Slots хранят одно активное значение, а update может заменить любое значение, которое пришло не от менеджера.

Requirements устроены как upsert по сочетанию:

```text
conversation + category + mode + value
```

Для них отсутствуют понятные состояния:

* active;
* retracted;
* superseded;
* tentative.

## Пример

```text
Клиент: Хочу без золота.
Клиент: Хотя нет, тонкая золотая надпись нормально.
```

Обе preference могут остаться активными.

Другой пример:

```text
Ассистент: Для установки в Минске...
Клиент: Я из Гомеля.
```

Шаблон может извиниться, но в хранилище отсутствует явная операция удаления ошибочного предположения.

## Нужны state operations

```ts
type StateOp =
  | {
      op: "set";
      key: string;
      value: string;
      evidence: MessageEvidence;
      confidence: number;
    }
  | {
      op: "retract";
      factId: string;
      evidence: MessageEvidence;
    }
  | {
      op: "supersede";
      factId: string;
      value: string;
      evidence: MessageEvidence;
    }
  | {
      op: "confirm";
      factId: string;
      evidence: MessageEvidence;
    };
```

Каждая операция должна ссылаться на конкретное пользовательское сообщение.

---

# 9. «Да» и «нет» могут подтверждать произвольный слот

В `ai-slot-evidence-service.ts:80-87` короткие contextual answers вроде:

```text
да
нет
ага
угу
нужно
хочу
```

могут считаться достаточным evidence для слота.

Аналогичная логика используется для requirements около строк `119-120`.

При этом нет жёсткой привязки к последнему заданному вопросу. Следовательно, ответ «да» теоретически может подтвердить слот, который модель решила обновить по собственной инициативе.

`hasLexicalSupport` около строк `137-153` ищет совпадающий stem длиной от пяти символов. Отрицание практически не учитывается.

Фраза:

> Чёрный не хочу.

может дать lexical support значению «чёрный».

## Исправление

Контекстный ответ должен быть допустим только при наличии `pendingQuestion`:

```ts
{
  id: "question-42",
  kind: "boolean",
  target: {
    type: "slot",
    key: "needsInstallation"
  }
}
```

Тогда:

```text
да → true только для needsInstallation
```

Для free-text и preference нужны:

* явное lexical evidence;
* обработка отрицания;
* confidence;
* provenance;
* возможность оставить значение tentative.

---

# 10. Confidence есть в схеме, но почти не влияет на применение

Схемы допускают `confidence: 0..1`, однако отсутствует чёткая политика:

* какое значение сразу сохраняется;
* какое считается предположением;
* какое отбрасывается;
* когда нужно переспросить.

В результате модель может вернуть низкую уверенность, пройти verifier и обновить долговременное состояние.

## Простая политика

```text
0.90–1.00  → применить как active
0.70–0.89  → сохранить tentative
0.50–0.69  → использовать только в текущем reasoning
< 0.50     → отбросить
```

Для чувствительных полей порог должен быть выше:

* место установки;
* ФИО;
* контактные данные;
* бюджет;
* срок;
* согласие на передачу менеджеру.

Manager-owned values должны иметь отдельный приоритет и не перезаписываться моделью.

---

# 11. Retrieval каталога слишком примитивный

`file-catalog-knowledge-provider.ts:30-45`:

* считает простой score;
* берёт все записи со score выше нуля;
* при равном score сортирует по ID.

`file-catalog-knowledge-provider.ts:49-75` использует в основном token overlap и несколько бонусов.

Отсутствуют:

* морфология;
* нормальные stopwords;
* исправление опечаток;
* IDF;
* semantic ranking;
* фильтры по типу записи;
* структурированные constraints;
* минимальный релевантный score;
* обучение на пользовательских формулировках.

Поле `CatalogSearchInput.intents` существует в `catalog-knowledge-port.ts:50-55`, но провайдер его фактически не использует.

Я воспроизвёл текущий scoring на приложенном snapshot. Получались такие результаты:

| Запрос                                    | Среди верхних результатов                                  |
| ----------------------------------------- | ---------------------------------------------------------- |
| «Сколько примерно стоит памятник?»        | монтаж цоколя, фотокерамика, колумбарные позиции, эпитафия |
| «Есть зелёный гранит?»                    | гранитный стол, гранитная скамья                           |
| «Нужен чёрный двойной памятник 120 на 60» | 3D-фотопортрет или икона                                   |

Такой RAG будет уверенно подсовывать модели формально совпавшие, но бесполезные записи.

## Нужен гибридный retrieval

Сначала planner формирует структурированный запрос:

```ts
{
  kinds: ["monument_model"],
  query: "строгий двойной памятник",
  constraints: {
    materialColor: "black",
    personCount: "two",
    widthCm: "120",
    heightCm: "60"
  }
}
```

Затем retrieval:

1. фильтрует по `kind`;
2. применяет точные constraints;
3. выполняет BM25/full-text;
4. добавляет embedding rank;
5. rerank делает только на небольшом наборе;
6. возвращает 3–5 записей с объяснением совпадения.

Для PostgreSQL начальной версии хватит:

* нормализованных полей;
* `tsvector`;
* `pg_trgm`;
* структурированных фильтров;
* небольшой embedding-колонки при необходимости.

---

# 12. В модель отправляется слишком тяжёлый каталог

`toCatalogPromptRecord` передаёт:

* id;
* revision;
* status;
* hash;
* validity;
* aliases;
* qualifiers;
* provenance;
* frontend;
* полный `data`.

Для top-12 записей из приложенного каталога payload занимает примерно 27–32 тысячи символов ещё до истории разговора и инструкций.

Далее похожий материал видят generator и verifier.

Это увеличивает:

* latency;
* стоимость;
* вероятность потери внимания;
* число случайных совпадений;
* размер verifier output.

## Компактная карточка evidence

Модели достаточно:

```ts
{
  evidenceId: "ev_17",
  recordId: "monument_42",
  kind: "monument_model",
  title: "Двойной памятник D-14",
  facts: [
    "материал: чёрный гранит",
    "ширина: 120 см",
    "доступна установка"
  ],
  approvedClaims: [
    "Модель рассчитана на два портрета"
  ]
}
```

Hash, revision, provenance и URL остаются на сервере. После ответа приложение разрешает `recordId` в актуальную запись.

---

# 13. URL зря проходит через текст модели

Сейчас prompt требует, чтобы модель воспроизвела точный `frontend.url`. Verifier должен найти claim с точными offsets. Затем приложение удаляет URL из текста и создаёт карточку.

Это хрупкий цикл:

```text
server URL
→ prompt
→ model text
→ exact verifier offsets
→ URL stripping
→ server card
```

Модель должна возвращать только:

```ts
recommendedRecordIds: [
  {
    recordId: "monument_42",
    reason: "соответствует запросу на строгую двойную форму"
  }
]
```

Приложение само:

* проверяет наличие ID;
* получает опубликованную revision;
* строит URL;
* создаёт карточку;
* исключает протухшие записи.

Тогда URL не участвует в генерации и semantic verification.

---

# 14. Каталога недостаточно для поведения хорошего консультанта

Каталог отвечает на вопросы вида:

* какая модель существует;
* какой материал указан;
* какая услуга доступна;
* какая цена опубликована.

Человеческому консультанту также нужна утверждённая предметная база:

* чем одинарный памятник отличается от двойного;
* как размер влияет на внешний вид;
* какие ограничения создаёт участок;
* как выбирать материал;
* какие этапы установки;
* какие данные нужны для предварительного расчёта;
* когда стоит вызвать замерщика;
* какие формулировки не давать без менеджера.

При строгом grounding модель без такой базы получает три варианта поведения:

* отвечает очень общо;
* задаёт ещё один вопрос;
* уходит в handoff.

Нужны отдельные классы знаний:

```text
commercial_facts       — цена, наличие, сроки, договорные условия
catalog_products       — модели, материалы, услуги
approved_advice        — правила выбора и объяснения
conversation_facts     — сведения конкретного клиента
```

Для них можно установить разные режимы проверки.

---

# 15. Semantic verifier выполняет слишком много задач

`widget-ai-semantic-verifier.ts:344-368` просит одну модель одновременно:

* найти все factual spans;
* вернуть точные UTF-16 offsets;
* связать claims с источниками;
* проверить слоты;
* проверить requirements;
* определить повтор вопроса;
* оценить тон;
* оценить естественность;
* определить handoff;
* проверить policy.

Это сложная и хрупкая схема. Verifier вызывается с `reasoning.effort: "low"` и `text.verbosity: "low"` в `openai-structured-response-client.ts:43-59`.

Generator и verifier по умолчанию используют одну модель. Два вызова снижают часть ошибок, однако профиль ошибок остаётся сходным.

## Разделение проверки

### Детерминированно

* record IDs существуют;
* numeric claims присутствуют в evidence;
* цены совпадают;
* URL строится сервером;
* state operation имеет evidence;
* короткий ответ связан с pending question;
* conversation revision актуальна.

### Semantic verifier только для риска

* коммерческое обещание;
* срок;
* итоговая стоимость;
* юридически значимое утверждение;
* неоднозначная рекомендация с высокой ценой ошибки;
* низкая confidence planner.

Обычный диалог:

```text
generator + deterministic checks
```

Рисковый диалог:

```text
generator + deterministic checks + semantic verifier
```

Это заметно сократит среднюю latency.

---

# 16. Verifier может отправить разговор менеджеру раньше полной проверки собственного ответа

В `grounded-widget-ai-service.ts:135-137` и `164-166` handoff от verifier может примениться сразу.

При этом детерминированные `verificationIssues` участвуют в вычислении `isPass` около строк `523-530`, но не всегда блокируют решение о handoff.

Ошибочный или чрезмерно осторожный verifier способен завершить AI-разговор.

Нужен порядок:

```text
validate verifier contract
→ validate reason codes
→ confirm handoff policy
→ commit handoff
```

Handoff должен иметь структурированную причину:

```ts
{
  type: "handoff",
  reason:
    | "explicit_customer_request"
    | "binding_price_request"
    | "unsupported_service_area"
    | "low_confidence_after_repair"
    | "manager_required_by_policy",
  evidenceMessageId: "..."
}
```

---

# 17. Repair-path не укладывается в реальный бюджет

Конфигурация примерно такая:

* общий deadline: 18 секунд;
* generator: 10 секунд;
* verifier: 6 секунд.

Repair допускается, когда остаётся около 3.5 секунды. Полноценная повторная пара generator + verifier обычно требует большего бюджета.

Кроме того, repair использует почти тот же контекст и retrieval. Ошибка retrieval при повторе сохранится.

## Что делать

Repair оставлять только для узких структурных ошибок:

* invalid JSON;
* отсутствующее обязательное поле;
* неизвестный record ID;
* неполное state operation.

При нерелевантном retrieval следует:

1. изменить retrieval query;
2. получить другие evidence;
3. выполнить один новый final generation.

Четыре модельных вызова внутри интерактивного хода дадут плохую p95 latency.

---

# 18. Handoff-телеметрия искажает причины

`safeHandoffResult` в `grounded-widget-ai-service.ts:558-567` сводит разные случаи к `binding_terms`. Risk flag также может получать `binding_terms_requested` для low confidence или out-of-scope.

Из-за этого аналитика будет показывать, что клиенты спрашивали обязательные условия, хотя причиной мог быть:

* плохой retrieval;
* verifier uncertainty;
* unsupported geography;
* ошибка structured output;
* policy timeout.

Причины handoff нужно хранить без сведения к общему флагу.

---

# 19. Regression corpus обучает систему проходить шаблонный funnel

В `widget-ai-regression-corpus.ts` около 45 кейсов. Многие проверки основаны на:

* наличии определённой фразы;
* запрещённом substring;
* ожидаемом следующем слоте;
* минимальной длине;
* специальных issue14-сценариях.

`widget-ai-eval-runner.ts:45-81` запускает отдельный искусственный turn на готовом snapshot. Он не прогоняет реальную последовательность:

```text
inbound
→ persistence
→ job queue
→ state update
→ next inbound
→ correction
→ supersede
→ final answer
```

Система может пройти corpus и оставаться неприятной в живом разговоре.

## Что добавить в eval

### Многотуровые сценарии

* пользователь дробит сообщение на три части;
* отвечает «да» на конкретный вопрос;
* исправляет город;
* меняет предпочтение;
* раздражается из-за повтора;
* задаёт вопрос посреди сбора параметров;
* возвращается через сутки;
* менеджер перехватывает разговор;
* пишет новое сообщение во время генерации.

### Метрики

* answered_explicit_question;
* repeated_question_rate;
* stale_reply_rate;
* unnecessary_handoff_rate;
* slot_precision;
* slot_retraction_accuracy;
* task_completion_rate;
* turns_to_useful_answer;
* p50/p95 latency;
* human preference score;
* response phrase repetition.

Для естественности полезно pairwise-сравнение:

```text
Ответ A / Ответ B
Какой больше похож на внимательного консультанта?
Какой лучше использовал известные сведения?
Какой дал больше пользы до уточняющего вопроса?
```

Человеческие оценки здесь важнее проверки на наличие шаблонной фразы.

---

# 20. Кодовые монолиты усложняют изменение поведения

`PublicWidgetIntakeService` — около 1 387 строк. Он одновременно:

* валидирует API;
* поддерживает разные версии intake;
* вызывает AI;
* проверяет ответ;
* сохраняет его;
* обрабатывает degradation;
* создаёт handoff;
* собирает public response.

`PostgresIntakeRepository` — около 4 149 строк. Там находятся:

* intake transactions;
* job queue;
* memory;
* slots;
* requirements;
* AI runs;
* handoffs;
* history;
* manager notifications.

Ports формально присутствуют, но реальные границы ответственности размыты.

## Разделение

```text
WidgetMessageIngress
ConversationJobQueue
ConversationTurnAssembler
ConversationStateStore
KnowledgeRetriever
AgentRuntime
TurnCommitter
HandoffService
QualityEventStore
```

Особенно важно отделить:

```text
TurnAssembler  — читает свежее состояние
AgentRuntime   — принимает решение и генерирует payload
TurnCommitter  — атомарно проверяет revision и применяет результат
```

---

# Целевая архитектура живого агента

```text
1. Inbound message
        ↓
2. Persist + increment conversation revision
        ↓
3. Debounce/coalesce burst
        ↓
4. Claim latest active turn
        ↓
5. Assemble fresh ConversationState
        ↓
6. Detect user act and plan response
        ↓
7. Structured retrieval when needed
        ↓
8. Generate final response once
        ↓
9. Deterministic risk/state checks
        ↓
10. Semantic verifier for high-risk claims
        ↓
11. Revision-aware atomic commit
        ↓
12. Publish response
```

## Возможный контракт хода

```ts
type TurnPlan = {
  userAct:
    | "ask"
    | "provide"
    | "confirm"
    | "reject"
    | "correct"
    | "complain"
    | "request_handoff";

  taskIntent: string;

  responseAct:
    | "answer"
    | "answer_and_clarify"
    | "recommend"
    | "summarize"
    | "handoff";

  risk: "low" | "commercial" | "legal";

  retrieval?: {
    kinds: string[];
    query: string;
    constraints: Record<string, string>;
  };

  stateOps: StateOp[];

  recommendedRecordIds: Array<{
    recordId: string;
    reason: string;
  }>;

  finalText: string;
};
```

Основные свойства:

* `finalText` уже является текстом для пользователя;
* renderer не переписывает его;
* ссылки строятся по record IDs;
* state updates содержат evidence;
* один уточняющий вопрос выбирается по контексту;
* ответ на явный вопрос входит в тот же ход;
* handoff имеет конкретную reason code.

---

# Приоритет переделки

## Этап 1. Устранить ответы из прошлого

Первый PR:

1. `conversation_revision`;
2. `turn_sequence`;
3. проверка latest inbound в send gate;
4. supersede старых job;
5. coalescing короткой серии сообщений;
6. worker pool с per-conversation lock.

Это устранит повторные и устаревшие ответы.

## Этап 2. Зафиксировать границу final response

1. запретить изменение `finalText` после verifier;
2. разделить `model` и `app_template`;
3. убрать ложный `grounding_verified`;
4. разделить state commit и text commit;
5. добавить hash проверенного payload.

## Этап 3. Ослабить анкетный funnel

1. убрать фиксированный порядок `monumentType → material → size`;
2. убрать canned uncertainty/frustration/correction replies;
3. ввести `userAct`, `responseAct`, `pendingQuestion`;
4. применять правило «ответить на вопрос, затем при необходимости задать один вопрос»;
5. добавить retract/supersede.

## Этап 4. Исправить retrieval

1. structured constraints;
2. фильтрация по kind;
3. компактные evidence cards;
4. 3–5 записей вместо тяжёлых top-12;
5. record IDs вместо URL;
6. retrieval score и selected reasons в telemetry;
7. approved advisory knowledge.

## Этап 5. Упростить verification

1. deterministic проверки record IDs, чисел и evidence;
2. semantic verifier для high-risk;
3. убрать точные UTF-16 spans там, где хватает evidence IDs;
4. убрать общий repair-loop;
5. отдельная причина каждого handoff.

## Этап 6. Заменить текущие eval

1. настоящий multi-turn replay через persistence и queue;
2. burst scenarios;
3. corrections и retractions;
4. latency/load tests;
5. human pairwise preference;
6. метрики повторов и бесполезных handoff.

---

# Что конкретно я бы удалил или сильно сократил

* Большую часть бизнес-логики из `widget-ai-dialogue-control.ts`.
* Фиксированный price/deadline funnel в `normalizeWidgetAiReplyPlan`.
* Определение ранее заданного вопроса через regex по полному тексту.
* Передачу raw URL через модель.
* `rollingSummary` в форме хвоста транскрипта.
* Универсальное evidence-правило для «да/нет».
* Автоматический handoff при первом verifier uncertainty.
* Legacy `WidgetAiService` после стабилизации нового пути.
* Дублирующие правила из prompt, renderer и verifier.

Не стал бы сейчас добавлять multi-agent framework, Mastra или отдельного supervisor-agent. Текущие проблемы находятся в очереди, актуальности состояния, retrieval, памяти и владении финальным ответом. Дополнительная оркестрация увеличит число переходов и latency.

---

# Что сохранить без существенной переделки

* persistence-before-AI;
* durable jobs;
* idempotency;
* leases и retries;
* `FOR UPDATE SKIP LOCKED`;
* atomic send gate;
* manager takeover;
* каталог с revisions/provenance;
* published-only knowledge;
* structured outputs;
* quality events;
* shadow mode;
* release evidence.

Это хороший фундамент. Разговорный слой можно заменить постепенно, не переписывая всю систему.

---

# Главные источники ощущения «тупого консультанта»

В порядке влияния:

1. **Ответ по устаревшему snapshot.**
2. **Последовательная очередь из старых ходов.**
3. **Фиксированный renderer, который тащит клиента по слотам.**
4. **Canned policy-ответы на обычные человеческие реплики.**
5. **Слабый retrieval с нерелевантными товарами.**
6. **Память в виде обрезанного транскрипта.**
7. **Повторная перепись текста после verifier.**
8. **Отсутствие retract/supersede для исправлений.**
9. **Слишком дорогой и перегруженный verifier.**
10. **Регрессии, измеряющие прохождение funnel вместо качества разговора.**

Первый технический срез стоит сделать вокруг четырёх вещей: **revision-aware send gate, coalescing, worker pool и неизменяемый final text**. После этого правки промпта и тона начнут давать предсказуемый эффект.

## Ограничение анализа

Архив содержит статический review context, а не полный репозиторий: отсутствуют dependencies, lockfile, `packages/shared` и часть смежных модулей. Поэтому я не запускал typecheck и test suite независимо. Выводы основаны на приложенном коде, документах и воспроизведении текущего retrieval-scoring на приложенном catalog snapshot.
