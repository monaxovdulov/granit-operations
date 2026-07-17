# Дизайн: живой grounded-консультант Granit

Status: approved design

Date: 2026-07-17

Repository: `granit-operations` with paired consumer changes in `granit-site-cms`

## 1. Результат

AI в виджете свободно ведет естественный многошаговый разговор, но приложение проверяет каждый бизнес-факт, извлеченный slot и обязательное обещание до отправки ответа клиенту.

Выбран двухпроходный подход:

1. dialogue model формирует живой ответ и typed decision;
2. независимый semantic verifier заново проверяет готовый ответ против истории, slots, системной policy и предоставленного machine-readable каталога;
3. приложение отправляет только прошедший проверку результат.

Regex больше не определяют intent, handoff, юридическую тематику, цены, сроки, наличие, гарантии или другие смысловые решения.

## 2. Зафиксированные решения

- Свобода формулировки остается у dialogue model.
- Бизнес-истина принадлежит отдельному machine-readable каталогу, который владелец предоставит позже.
- HTML сайта не является knowledge source и не преобразуется в факты автоматически.
- Текущие три hardcoded-факта не являются будущим source of truth.
- Отсутствие данных в каталоге является нормальным состоянием.
- При пробеле в знаниях консультант честно сообщает, что конкретное условие не подтверждено, продолжает полезный разговор и собирает параметры.
- Сам пробел не создает terminal handoff. Handoff нужен при явной просьбе клиента, запросе точного недоступного коммерческого условия, готовой заявке либо иной подтвержденной причине.
- Внешний JSON-формат, наполнение и публикация каталога не входят в эту реализацию. Они будут предоставлены отдельно.
- До подключения каталога используется пустой безопасный provider: он возвращает ноль бизнес-фактов, но не ломает обычный диалог.

## 3. Граница каталога

Внутри `granit-operations` вводится `CatalogKnowledgePort`. Он изолирует AI core от будущего внешнего формата данных.

Порт возвращает нормализованный неизменяемый snapshot со следующими семантическими свойствами:

- schema/version identity;
- content hash;
- стабильный record ID и revision;
- kind записи;
- publication status;
- период действия;
- структурированные значения;
- aliases/search text;
- qualifiers, например регион, комплектация или валюта.

Это требования к внутреннему представлению, а не утверждение внешней JSON schema. Когда владелец предоставит отдельный machine-readable слой, адаптер сопоставит его с `CatalogKnowledgePort` без изменения оркестратора, prompt contract или verifier.

Состояния значений различаются явно:

- отсутствующее поле означает «неизвестно»;
- `false` означает подтвержденное отсутствие;
- `draft` не разрешено показывать клиенту;
- `published` разрешено использовать в пределах срока действия;
- `retired` остается доступным только для аудита старых runs.

Модель ссылается на точный record, revision и путь внутри нормализованной записи. Версия и hash snapshot сохраняются в `ai_run`.

Первый provider — `EmptyCatalogKnowledgeProvider`. Он не содержит временных бизнес-фактов и не читает HTML сайта.

## 4. Компоненты

### `AiConversationOrchestrator`

Координирует один turn: загружает контекст, получает knowledge snapshot, вызывает dialogue model, проверяет typed decision, запускает verifier/repair, применяет send-time gate и сохраняет результат.

### `CatalogKnowledgePort`

Предоставляет snapshot и поиск релевантных published records. Реализация поиска скрыта за портом и появится вместе с предоставленным владельцем machine-readable слоем. Первый empty provider не реализует фиктивный индекс и всегда возвращает пустую выборку.

### `AiDecisionValidator`

Проверяет JSON schema, версии, допустимые enum, catalog references, slot evidence, количество вопросов и согласованность typed action. Он не пытается понять естественный язык regex-правилами.

### `AiSlotEvidenceService`

Проверяет provenance slots, точные цитаты, message IDs, offsets, конфликты и правила перезаписи. Значение менеджера модель не перезаписывает.

### `AiSemanticVerifier`

Независимо анализирует готовый `replyText`, не доверяя claim annotations основной модели. Возвращает typed verdict и controlled violation codes.

### `AiRepairService`

Делает не более одной попытки исправления при `repair` и только в пределах общего deadline budget.

### `AiHandoffService`

Применяет подтвержденный handoff как app-owned state transition, а не как текстовое обещание модели.

### `AiReviewService` и `AiEvalRunner`

Связывают manager labels с `ai_run`, создают обезличенные regression cases и запускают настоящий generator + verifier pipeline.

## 5. Поток одного сообщения

1. Inbound сохраняется durable до любого model call.
2. Приложение загружает bounded history, persisted slots и актуальный gate state.
3. `CatalogKnowledgePort` возвращает snapshot и релевантные записи. Пустой snapshot допустим.
4. Dialogue model получает историю, slots, текущий вопрос и только выбранные catalog records.
5. Model возвращает свободный `replyText` и typed decision.
6. App валидирует структуру, ссылки, evidence и state-independent invariants.
7. Semantic verifier независимо классифицирует все утверждения и проверяет action.
8. При `repair` выполняется одна исправляющая генерация и повторная проверка.
9. При `pass` приложение повторно читает send-time gate, атомарно сохраняет slot updates/run/outbound/handoff и возвращает ответ.
10. При `block`, verifier failure или timeout inbound не теряется; создается degradation evidence и безопасный public result.

Модель не пишет напрямую в Postgres, не переключает AI state и не отправляет сообщения в канал.

## 6. Typed dialogue decision

Decision содержит:

- version;
- action и intent;
- свободный `replyText`;
- extracted slots;
- requested slot, максимум один;
- claim annotations;
- risk flags;
- handoff reason;
- confidence.

Claim annotation указывает span в `replyText` и grounding reference:

- catalog record + revision + normalized path для бизнес-факта;
- message ID + quote + offsets для факта о клиенте;
- system policy ID для app-owned boundary/disclosure;
- `conversation_only` для нейтральной связки без фактического утверждения.

Annotations помогают аудиту, но не являются доказательством сами по себе: verifier повторно сегментирует весь текст и может обнаружить неразмеченный факт.

## 7. Evidence-backed slots

Каждый AI-extracted slot обязан иметь:

- slot name;
- normalized value;
- confidence;
- visitor message ID;
- точную цитату;
- start/end offsets.

Приложение проверяет, что сообщение существует, принадлежит visitor, цитата точно совпадает с указанным диапазоном и находится в разрешенном bounded context.

Slots из прошлых visitor messages допустимы, если их evidence остается в переданном контексте. Некорректный evidence делает decision repairable, а не молча сохраняется.

Manager-confirmed value имеет высший приоритет. Новое конфликтующее сообщение клиента сохраняется как отдельная версия с provenance и показывается менеджеру как конфликт.

## 8. Semantic verifier

Verifier возвращает один из verdict:

- `pass`;
- `repair`;
- `handoff`;
- `block`.

`handoff` означает обязательное app-owned действие, а не разрешение отправить исходный draft. Если draft не соответствует required handoff, оркестратор сначала пытается получить исправленный текст в пределах budget, а затем использует безопасный app-owned handoff response. `block` никогда не отправляет исходный draft.

Controlled violations включают:

- `unsupported_claim`;
- `invalid_catalog_reference`;
- `expired_commercial_fact`;
- `invalid_slot_evidence`;
- `commercial_promise`;
- `legal_advice`;
- `missed_manager_request`;
- `repeated_question`;
- `wrong_handoff`;
- `too_many_questions`;
- `low_confidence`.

Verifier различает:

- бизнес-факт, который требует catalog grounding;
- факт о клиенте, который требует message evidence;
- рекомендацию, допустимую только как предложение, а не гарантия;
- нейтральную разговорную связку;
- app-owned disclosure/boundary;
- цену, срок, наличие, гарантию или договорное условие, которые требуют опубликованную и действующую коммерческую запись.

Фраза с отдельными словами `свяж` или `документ` не является основанием для handoff. Verifier учитывает смысл всего сообщения и истории.

## 9. Что остается детерминированным

Без semantic parsing приложение продолжает жестко обеспечивать:

- `agentAllowedToReply=false`;
- manager takeover;
- stale generation/send gate;
- idempotency;
- неизвестную schema/version;
- catalog identity и срок действия records;
- корректность IDs, revisions, JSON paths и evidence offsets;
- лимиты контекста, длины ответа и числа вопросов;
- атомарность persistence и handoff.

Regex остаются только для технических задач: нормализация whitespace, PII sanitization в eval assets и узкие проверки формата. Они не принимают policy или intent decisions.

## 10. Пробелы знаний и ошибки

Если нужной записи нет среди доступных подтвержденных данных, модель может прямо сообщить, что точное условие пока не подтверждено, и задать один полезный вопрос. Это разрешенный grounded-ответ без business claim.

Verifier failure или timeout закрывает только текущий turn:

- inbound остается сохраненным;
- unsafe draft не отправляется;
- создается degradation event;
- менеджер получает видимый work item/notification;
- AI не отключается навсегда и может обработать следующий inbound, если gate это разрешает.

Terminal handoff применяется только по подтвержденной причине.

Dialogue call, verifier и возможный repair имеют общий backend deadline 18 секунд. Repair запускается только при достаточном остатке budget. Цель — p95 verified-turn не более 15 секунд; frontend timeout/UX должен быть немного длиннее backend budget.

## 11. Persistence и аудит

Additive persistence хранит:

- `ai_runs`: generator/verifier model identities, prompt/policy/schema versions, catalog snapshot identity, latency, tokens, verdict и controlled violations;
- slot evidence и версии конфликтов;
- verifier result без chain-of-thought;
- `ai_review_labels`;
- sanitized `ai_eval_cases`;
- `ai_eval_runs`;
- existing handoff/degradation evidence.

Raw chain-of-thought, secrets и неограниченные provider payloads не сохраняются.

## 12. Manager experience

`ManagerLeadDetail` получает `structuredIntake`:

- slots со значением, provenance, evidence и временем;
- конфликты;
- использованные catalog references;
- известные и отсутствующие параметры;
- lead summary;
- handoff reason;
- последний verifier verdict.

Панель показывает карточку над диалогом и позволяет открыть цитату-основание. Telegram notification содержит компактные slots, контакт, причину передачи и ссылку на заявку.

Менеджер может поставить controlled label конкретному AI-ответу: `unsupported_fact`, `wrong_intent`, `repeated_question`, `early_handoff`, `missed_handoff`, `bad_tone` или `poor_summary`.

## 13. Widget experience

UI использует server-owned state:

- `ai_active`: AI может отвечать и показывается pending indicator;
- `manager_pending`: диалог передан, повторная AI-анимация не показывается;
- `manager_active`: outbound подписан как ответ менеджера;
- degraded turn: сообщение принято, но AI не ответил;
- closed: ввод и состояние соответствуют server contract.

Заголовок, pending text и следующий public action зависят от фактического состояния, а не от локального предположения frontend.

## 14. Evals

Текущий декларативный массив заменяется исполняемым корпусом из 30–50 реалистичных многошаговых диалогов.

Eval runner:

- вызывает настоящий generator и verifier;
- воспроизводит history и known slots по turn;
- проверяет action, grounding, slot evidence, повторные вопросы, handoff и тон;
- сохраняет latency, usage, versions и причины отказа;
- поддерживает promotion обезличенного manager review в regression case.

Обычные unit/integration tests не вызывают сеть. Live model eval запускается opt-in локально, в staging или отдельном CI job. Hard-safety regression блокирует продвижение новой версии; soft-quality threshold фиксируется отдельно.

## 15. Рефакторинг текущего кода

Из большого `public-widget-intake-service.ts` выносятся validation, slot evidence, grounding, verifier orchestration, handoff application и eval concerns.

Дублирующиеся source checks в intake service и `WidgetAiService` заменяются одним typed validation pipeline. Оба текущих набора semantic policy-regex удаляются после появления эквивалентных verifier cases и прохождения regression suite.

Существующий send-time gate, durable inbound persistence и manager takeover сохраняются как app-owned safety boundary.

## 16. Rollout

Новый pipeline имеет режимы:

- `off`: текущий путь;
- `shadow`: новый generator/verifier выполняется, но не определяет public outbound; результаты сравниваются и сохраняются;
- `enforce`: клиент получает только verified result.

Порядок: local tests -> live eval -> staging -> shadow -> owner-reviewed enforce. Реализация не включает production enablement или deploy.

## 17. Реализационные срезы

1. Internal contracts, `CatalogKnowledgePort`, empty provider и refactoring seams.
2. Typed claims, slot evidence, semantic verifier и bounded repair.
3. Additive persistence, manager structured intake и notifications.
4. Widget server-owned states и degradation UX.
5. Executable eval corpus, live runner и rollout modes.

Machine-readable каталог и адаптер к его будущему внешнему формату являются отдельной последующей поставкой владельца.

## 18. Критерии готовности

Работа считается завершенной, когда:

1. Ни один regex не принимает semantic/policy decision.
2. Каждый сохраненный AI-slot имеет проверяемое message evidence.
3. Каждый business claim либо имеет актуальный catalog reference, либо блокируется.
4. Пустой catalog provider поддерживается без выдуманных фактов и потери inbound.
5. Unsupported claim не проходит send-time gate.
6. Manager takeover блокирует stale draft.
7. Manager видит structured intake, evidence, conflicts и verifier status.
8. После handoff widget не показывает AI pending state.
9. Live eval действительно вызывает generator и verifier на 30–50 multi-turn cases.
10. Hard-safety cases проходят полностью; quality threshold измеряется отдельно.
11. p95 verified-turn соответствует цели 15 секунд в staging evidence.
12. Backend tests/typecheck, migrations, manager checks, site checks/build и live eval проходят.

## 19. Не входит в scope

- создание, заполнение или утверждение внешнего machine-readable каталога;
- временный перенос данных из HTML сайта;
- автоматическое утверждение цен, сроков, гарантий или наличия;
- production deploy или включение `enforce`;
- Telegram AI outbound;
- streaming;
- хранение chain-of-thought;
- прямой доступ модели к Postgres или channel send.
