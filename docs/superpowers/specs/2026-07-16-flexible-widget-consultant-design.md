# Дизайн: гибкий AI-консультант в виджете Granit

Status: approved direction, implementation design  
Date: 2026-07-16  
Mode: `Consult-first`  
Repository: `granit-operations` with paired consumer changes in `granit-site-cms`

## 1. Результат

AI в виджете ведет естественный многошаговый разговор, понимает недавний контекст, накапливает параметры заявки, задает один наиболее полезный вопрос за ход и передает менеджеру структурированную заявку. Приложение продолжает владеть бизнес-истиной, запретами, persistence, manager takeover и финальным правом отправки.

Это не prompt-only улучшение. Результат считается готовым только при одновременном наличии:

- app-owned conversation context;
- накопленных slots заявки;
- typed candidate decisions;
- утвержденных knowledge sources/tools;
- manager-visible handoff и degradation state;
- review/eval/regression loop;
- подтвержденного end-to-end поведения виджета.

## 2. Утвержденное поведение Consult-first

При первом вопросе о цене без утвержденного прайс-источника консультант:

1. честно сообщает, что точную цену подтвердит менеджер;
2. не завершает разговор только из-за слова «цена»;
3. задает один полезный вопрос о еще неизвестном параметре;
4. продолжает собирать данные для качественной заявки;
5. передает менеджеру, когда клиент просит человека, требует обязательного коммерческого обещания, сообщает достаточно данных и хочет расчет/контакт либо возникает риск или деградация.

AI не следует жесткой анкете. Он выбирает следующий вопрос по контексту, но приложение ограничивает список допустимых slots, число вопросов, источники фактов и handoff rules.

## 3. Поток одного сообщения

```text
channel adapter
  -> persist inbound
  -> load bounded conversation context
  -> merge persisted + newly extracted slots
  -> deterministic pre-policy
  -> provider proposes typed AiTurnDecision
  -> schema/source/policy validation
  -> persist slot updates and decision evidence
  -> send-time gate
  -> persist outbound OR handoff OR degradation
  -> return safe public response
```

Модель не отправляет сообщения и не пишет бизнес-состояние напрямую. Candidate decision становится результатом только после app validation и send-time gate.

## 4. Conversation context

`AiTurnInput` версии Stage B получает:

- последние 12 сообщений текущей conversation в порядке от старых к новым;
- обе стороны: `visitor` и `ai_assistant`;
- максимум 12 000 символов контекста, с сохранением самых новых сообщений;
- текущий inbound отдельно от истории;
- persisted known slots;
- page/contact/locale context;
- gate snapshot;
- policy, prompt, knowledge и model versions;
- approved sources, выбранные приложением до provider call.

История строится из `conversation_messages` после durable inbound persistence. Provider не использует `previous_response_id` как источник памяти: app-owned Postgres history остается единственным источником диалогового контекста и позволяет менять модель без потери состояния.

## 5. Slots заявки

Первая версия поддерживает:

| Slot | Назначение |
|---|---|
| `monumentType` | одиночный, двойной, семейный, комплекс или неизвестно |
| `material` | предпочтительный материал/цвет |
| `size` | известный размер или свободное описание |
| `city` | город клиента/установки |
| `cemetery` | место установки без юридических консультаций |
| `engraving` | портрет, надпись, оформление |
| `installation` | нужна ли установка/демонтаж/благоустройство |
| `budgetContext` | свободное пожелание клиента без обещания цены |
| `desiredTiming` | пожелание клиента, не обещанный срок |
| `customerName` | имя |
| `phone` | контакт, хранимый существующим contact flow |
| `preferredContact` | телефон, WhatsApp, Telegram или email |
| `questionSummary` | короткое app-visible резюме запроса |

Slots имеют provenance: `contact`, `visitor_message`, `ai_extraction`, `manager`, а также `sourceMessageId`, confidence и timestamp. Новое значение не затирает подтвержденное менеджером. Конфликтующие значения сохраняются как последнее клиентское уточнение с evidence, а не молча объединяются.

AI запрашивает не более одного slot за ход. Он не спрашивает известные данные повторно и не обязан заполнять все slots перед handoff.

## 6. Typed decision

Provider возвращает JSON, валидируемый приложением:

```ts
type AiTurnDecisionV2 = {
  version: "granit_ai_turn_decision.stage_b.v1";
  action: "answer" | "clarify" | "handoff" | "block" | "fallback";
  intent:
    | "general_question"
    | "product_selection"
    | "price_intake"
    | "deadline_intake"
    | "contact_request"
    | "manager_request"
    | "binding_terms"
    | "out_of_scope";
  replyText?: string;
  extractedSlots: SlotCandidate[];
  requestedSlots: SlotName[];
  riskFlags: RiskFlag[];
  handoffReason?: HandoffReason;
  sourceEvidence: ApprovedSourceEvidence[];
  confidence: number;
};
```

App validation отклоняет решение, если:

- отсутствуют обязательные поля или версия неизвестна;
- `clarify` содержит ноль или больше одного requested slot;
- requested slot уже известен;
- reply содержит неподтвержденный business fact;
- price/deadline/binding promise нарушает hard policy;
- source evidence не совпадает с app-provided approved sources;
- handoff/block не имеет допустимой причины;
- модель пытается изменить gate, lead state или send authority.

Invalid decision приводит к app-owned degradation/handoff, а не к попытке «починить» JSON свободным текстом.

## 7. Policy

Hard policy остается детерминированной:

- explicit manager request всегда создает handoff;
- manager takeover и `agentAllowedToReply=false` всегда блокируют AI send;
- final price, точный срок, договор, гарантия, оплата, рассрочка, скидка, наличие и юридические обещания запрещены;
- legal/funeral/inheritance advice не обслуживается;
- price amount допускается только из approved price tool и только после отдельного owner-approved policy enablement;
- Telegram AI outbound остается выключен до отдельного approval.

Текущие широкие regex больше не должны превращать обычный первый вопрос о цене или сроке в фиктивный handoff. Pre-policy детерминированно перехватывает только explicit manager request, явно запрещенные обязательные обещания и out-of-scope high-risk cases. Остальное классифицируется typed decision внутри ограниченного corridor и проверяется post-policy.

## 8. Approved knowledge и tools

Business facts не берутся из model memory. Первый approved knowledge source — версионированный repo asset в `granit-operations`, собранный из публично утвержденного контента Granit и прошедший review. Каждый факт имеет:

- `sourceId` и `version`;
- короткий canonical fact;
- допустимые intents;
- public provenance URL или документ;
- `reviewedAt`;
- флаг, разрешено ли цитирование клиенту.

Provider получает только факты, выбранные app-owned retrieval по intent/keywords. Решение обязано вернуть source evidence для любого бизнес-факта. Price knowledge отделено от general knowledge и по умолчанию отсутствует.

Tools первой версии:

- `lookupApprovedKnowledge(query, intent)` — read-only;
- `readKnownSlots()` — только snapshot текущего turn;
- `proposeHandoff(reason, summary)` — candidate action без записи в DB;
- позже `lookupApprovedPriceOrientation(...)` после отдельного утверждения источника.

## 9. Настоящий handoff и degradation

Handoff — состояние приложения, не текст в сообщении. При validated handoff приложение атомарно:

- сохраняет safe reply;
- переводит conversation в `needs_manager`;
- устанавливает `agentAllowedToReply=false` для terminal handoff;
- пишет timeline event с controlled reason;
- сохраняет structured handoff summary и known slots;
- создает manager-visible work item/notification через app outbox;
- блокирует последующие AI replies до явного resume.

Для consultative handoff после достаточного сбора данных используется terminal handoff. Простое упоминание цены без запроса человека не является handoff.

Provider error, timeout, invalid decision, source mismatch и unsafe output создают degradation event. Inbound остается сохраненным, клиент получает safe fallback, а менеджер видит причину без raw provider payload и secrets.

## 10. Persistence

Новые app-owned сущности:

- `conversation_slots` — актуальные slots с provenance;
- `ai_runs` — один turn/run: input fingerprint, versions, decision status, safe token/latency metadata;
- `conversation_handoffs` — reason, summary, state transition и resolution;
- `ai_review_labels` — controlled manager labels;
- `ai_eval_cases` — sanitized promoted cases;
- `ai_eval_runs` — regression result по version bundle.

Raw chain-of-thought, provider payloads, secrets и неограниченные полные snapshots не сохраняются. Message text уже остается в app-owned conversation history; eval assets проходят sanitization.

## 11. Review и eval loop

Manager может пометить диалог контролируемой меткой:

- `wrong_intent`;
- `repeated_question`;
- `missed_handoff`;
- `early_handoff`;
- `unsupported_fact`;
- `unsafe_commercial_promise`;
- `bad_tone`;
- `poor_lead_summary`.

Метка связывается с `ai_run`, сообщением и conversation. Promotion создает sanitized eval case с input context, expected action/properties и forbidden output patterns.

Минимальный regression corpus покрывает:

- многошаговый выбор памятника;
- follow-up без повторного вопроса;
- первый price question в Consult-first;
- final quote pressure;
- explicit manager request;
- legal/funeral boundary;
- provider/tool degradation;
- manager takeover во время генерации;
- unsupported fact/source mismatch;
- качественное резюме заявки.

Promotion policy блокирует rollout новой policy/prompt/knowledge версии при hard-safety regression. Soft-quality thresholds фиксируются отдельно и сначала используются как review gate.

## 12. Widget UX

Paired consumer в `granit-site-cms`:

- сохраняет public session id;
- восстанавливает server-owned conversation history после reload через safe public history endpoint;
- показывает AI disclosure до первого сообщения;
- использует состояния «думает», «передано менеджеру», «ответит менеджер»;
- не показывает success AI, пока outbound не сохранен;
- синхронизирует frontend timeout с backend latency contract;
- после terminal handoff отключает AI expectation, но продолжает сохранять inbound для менеджера.

Streaming не является обязательным для dialog core. Сначала устраняется timeout mismatch и добавляется понятное pending state; streaming допускается отдельным UX slice.

## 13. Компоненты

- `AiConversationOrchestrator` — turn flow и применение результата;
- `AiContextRepository` — recent messages и slots;
- `AiSlotService` — merge/validation/provenance;
- `AiPolicyService` — hard pre/post checks;
- `AiPromptRegistry` — versioned prompt bundle;
- `AiProvider` — typed provider boundary;
- `ApprovedKnowledgeService` — app-owned retrieval/evidence;
- `AiHandoffService` — atomic state transition/work item;
- `AiRunRepository` — safe evidence/latency/status;
- `AiReviewService` и `AiEvalRunner` — bad-dialog loop.

Существующий `WidgetAiService` постепенно становится compatibility adapter и затем удаляется после переноса поведения в channel-neutral core. Public widget contract меняется только additively.

## 14. Реализационные срезы

### Slice A — Dialog core

- Stage B contracts;
- bounded recent-message context;
- persisted slots;
- typed provider decision;
- Consult-first policy;
- compatibility mapping в текущий widget response;
- focused multi-turn tests.

### Slice B — Approved knowledge

- reviewed knowledge asset/schema/version;
- app-owned retrieval;
- source-evidence validation;
- unsupported-fact regression cases.

### Slice C — Handoff/degradation

- persisted handoff/degradation state;
- manager-visible timeline/work item/notification;
- explicit resume contract;
- stale-draft and failure-path tests.

### Slice D — Review/evals

- `ai_runs`, labels, sanitized eval cases и runner;
- hard/soft promotion rules;
- first real bad-dialog-to-regression loop.

### Slice E — End-to-end widget

- safe history read endpoint;
- restored UI history and handoff states;
- latency contract;
- paired operations/site tests and staging evidence.

## 15. Проверка готовности

Goal не закрывается узкими unit tests. Нужны доказательства:

1. Два и более последовательных сообщения используют предыдущий контекст.
2. Known slot не запрашивается повторно и виден менеджеру.
3. Первый вопрос о цене продолжает Consult-first без суммы и без раннего handoff.
4. Explicit manager request и final quote pressure создают persisted manager-visible handoff.
5. Model/tool/source failure создает degradation и safe fallback без потери inbound.
6. Неподтвержденный business fact не отправляется.
7. Takeover между generation и persistence блокирует stale reply.
8. Bad dialog проходит полный цикл label -> sanitized eval -> regression -> verified fix.
9. Widget восстанавливает историю и корректно показывает replied/handoff/fallback после reload/retry.
10. Typecheck, full tests, migration checks, provider/consumer contract tests и paired staging smoke проходят.

Production enablement требует отдельного release approval и не следует автоматически из реализации этой спеки.

## 16. Не входит в дизайн

- Telegram AI outbound;
- прямой доступ модели к Postgres или channel send;
- Mastra как обязательный runtime первого среза;
- финальные цены или коммерческие обещания;
- vector-memory-first платформа;
- хранение chain-of-thought;
- production deploy без отдельного sign-off.

