# Live Widget AI - ускоренный staging-only дизайн

Status: owner-confirmed design; W0/G1Q passed; P2 next; runtime not enabled
Date: 2026-07-14
Repo: `granit-operations`
Related plan: `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`

Этот файл создан по brainstorming convention. Он не является cross-repo task/ADR и не заменяет
owner-approved sequencing в `granit-plan-app`. Канонический проверяемый implementation plan для
`granit-operations` находится по ссылке выше; отдельный W0 task должен быть создан в owning repo
`granit-site-cms` после G0.

## Результат

Первый полезный AI в website widget должен одновременно:

1. сразу показывать клиенту, что сообщение принято в работу;
2. помнить короткий контекст диалога и не повторять уже заданные вопросы;
3. отвечать живым, спокойным русским языком и двигать разговор на один шаг;
4. понимать отрицание и смешанные запросы по смыслу, а не по trigger word;
5. не владеть Postgres, business state, handoff, send gate или публикацией ответа;
6. запускаться первым реальным model runtime через staging-only Mastra + OpenAI API.

Mastra является runtime/orchestration boundary, а не источником интеллекта. Качество создают
контекст, structured decision, app-owned policy, versioned tone/business assets и evals.

## Проверенный текущий разрыв

- `apps/api/src/modules/ai/ai-turn.ts` кладет в `compactContext.messages` только текущий inbound;
- `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts` описывает помощника только для первого
  сообщения и не использует историю/known slots;
- `apps/api/src/modules/ai/policy/widget-ai-policy.ts` делает primary semantic routing широкими
  regex для manager/price/deadline/terms;
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts` ждет полный Responses API
  result и допускает provider timeout до 15 секунд;
- widget consumer в
  `granit-site-cms@5c33610:apps/site/public/assets/js/main.js` показывает
  visitor bubble только после завершения POST и прекращает ожидание через 10 секунд.

Следствие: текущий контур безопасен, но выглядит как single-turn автоответчик; frontend может
показать timeout раньше, чем backend закончит model call.

`granit-ops-decisions@91dcfa1` используется как decision evidence, а не как installable harness
или accepted source of truth. Его ADR/UXD остаются `Proposed`; в этот дизайн взяты только
подтвержденные владельцем направления: app-owned snapshot/apply boundary, structured meaning,
approved facts and release gates.

## Что значит "живой"

| Свойство | Проверяемое поведение |
|---|---|
| Мгновенная реакция UI | Visitor bubble появляется до network result; pending/typing state виден не позднее 300 ms после submit. |
| Память | Model-safe context содержит последние 6-8 релевантных сообщений с явным count/character limit и текущим inbound ровно один раз. |
| Продолжение разговора | Ответ учитывает последний AI question и collected slots, не спрашивает повторно уже известное. |
| Живой тон | Короткий ответ дает пользу и один понятный следующий шаг, без канцелярита, fake empathy и телефонного давления. |
| Понимание смысла | Negation, paraphrase and mixed intent проходят через structured model decision, не через primary regex router. |
| Реальный handoff | Текст о менеджере появляется только вместе с app-owned state transition/stop-AI behavior. |
| Безопасность | Неподтвержденные цены, сроки, наличие, договорные/платежные и юридические обещания не публикуются. |

## Выбранная последовательность

```text
site_widget.v1 acceptance
  +-> widget lane: W0 Live Widget UX -------------------------> combined widget-UX evidence
  |
  +-> backend lane: P1 neutral boundary
        -> P1Q Live Dialog Core (synthetic acceptance fixtures)
        -> P2 minimum run/quality persistence
        -> P3 assets/privacy/retention/manager visibility
        -> M1 Mastra adapter disabled
        -> M2 local/fake contract proof
        -> G6 owner staging approval
        -> M3 first authenticated live_v2 Mastra call/evidence
```

`W0` может выполняться отдельным cross-repo PR параллельно backend prerequisites после
`site_widget.v1` acceptance. `P1Q` не вызывает реальную модель и не добавляет Mastra packages;
M1 остается disabled implementation, а первый authenticated model call происходит только в M3.

## W0 - Live Widget UX

Owning repo: `granit-site-cms`. Ни этот design artifact, ни operations task не разрешают менять
site repo; конкретный W0 implementation task/evidence создаются там отдельно.

При submit consumer:

1. немедленно добавляет локальную visitor bubble со статусом `pending`;
2. показывает отдельный typing/loading indicator, но не fake AI text;
3. сохраняет idempotency key и текст до подтвержденного accepted/replayed response;
4. после accepted response переводит visitor bubble в `saved` и показывает только persisted AI
   reply из `site_widget.v1`;
5. при ошибке помечает локальное сообщение как `not_confirmed/retryable`, не стирает ввод и не
   создает AI bubble;
6. использует согласованный timeout invariant: browser deadline больше server/provider deadline
   плюс bounded persistence/network allowance.

Первый slice не меняет `site_widget.v1`, не добавляет SSE/WebSocket и не показывает model tokens
до app validation/send gate.

## P1Q - Live Dialog Core

P1 сначала завершает versioned app boundary и фиксирует golden baseline direct S05. P1Q создает
отдельный `live_v2` profile subtree; он не меняет текущие
`prompts/widget-ai-prompt.ts`, `policy/widget-ai-policy.ts`, direct provider request или их version
constants.

### Bounded context

App service загружает из Postgres последние 6-8 релевантных text messages в стабильном порядке,
с отдельным character cap. В model-safe snapshot попадают direction/role/time/text, last AI
question and controlled collected slots. Raw transport DTO, DB repositories, unrestricted
metadata and unnecessary contact values в AI boundary не попадают.

### Structured decision

Provider-neutral port возвращает strict candidate с одним из четырех app-owned actions:

- `answer` - короткий полезный ответ;
- `ask_clarifying_question` - ответ плюс максимум один следующий вопрос;
- `handoff_to_manager` - reason, missing slots and optional safe customer copy;
- `no_reply` - controlled reason без customer-visible model text.

Candidate также содержит `replyDraft`, controlled `reason`, `missingSlots`, short evidence,
negation/mixed-intent flags and used approved-source IDs. Точные TypeScript/JSON field names
фиксируются в P1Q implementation task, но action set и ownership не расширяются без owner review.

App-owned `live_v2` validator проверяет schema, allowed action, approved-source requirements,
forbidden claims and handoff semantics. Regex разрешен только для hard output safety/format
checks, а не для определения смысла запроса. Legacy S05 использует отдельный замороженный
validator.

### Tone and business assets

Versioned `live_v2` profile кодирует поведение, а не набор вечных canned replies:

- принять смысл запроса без ненужного эха;
- дать конкретную пользу доменными словами;
- задать один следующий вопрос только если он продвигает заявку;
- не превращать диалог в анкету;
- не использовать fake empathy и пустые слова `бережно/аккуратно` как замену помощи;
- не давить телефоном, пока handoff/contact действительно не нужен.

Первый approved business-facts snapshot содержит только проверенные типы изделий, материалы,
варианты оформления and process facts. Цены, сроки, наличие, скидки, оплата, договор и гарантии
остаются закрыты, пока для них нет отдельного owner-approved source/version/template.

Imported content under
`granit-site-cms@5c33610:apps/site/src/imported-pages/` может служить только
материалом для ручного отбора: README этого репозитория прямо оставляет owner corrections
незавершенными. Runtime читает только небольшой schema-validated snapshot, скопированный в
`granit-operations` после явного owner approval, а не HTML/CMS/Sheet другого репозитория.

### Frozen direct compatibility

Legacy mapping структурный и не анализирует текст:

- `reply_candidate` + `agentAllowedToReplyAfterSend=false` -> `handoff_to_manager`;
- другой `reply_candidate` -> `answer`;
- `no_reply` -> `no_reply` с существующим reason;
- `ask_clarifying_question` legacy path не создает.

Golden tests фиксируют S05 prompt/policy/disclosure, deterministic replies, current
`gpt-5.5`/low/`store:false` request and public/send-gate outcomes. Direct rollback является явной
операторской сменой режима, не automatic per-turn retry и не вторым quality implementation.

## Minimum app-owned observability

До live Mastra call приложение должно уметь связать turn с conversation/inbound/outbound и
сохранить:

- app `trace_id`/run ID and runtime mode;
- prompt, policy, tone, facts and model profile versions;
- requested/returned model identity, latency and token usage;
- structured action, send-gate result and terminal outcome/reason;
- sanitized failure/degradation event.

Postgres/app services остаются source of truth. Mastra не пишет business tables, не отправляет
customer reply and cannot weaken redaction, retention or send-time gate.

## M1-M3 - disabled implementation, затем первый live model call

M1 добавляет disabled in-process adapter, M2 доказывает wiring локально с fakes. Только M3 после
G6 делает первый authenticated provider call со следующим профилем:

- in-process staging-only Mastra;
- server-only `OPENAI_API_KEY`;
- explicit `gpt-5.6-sol`;
- requested `reasoning.effort=medium`;
- `store:false`;
- no silent model/effort/auth substitution.

Legacy `direct_openai` остается operations-only emergency rollback и не получает `live_v2`
features в этом slice. Это не второй product mode и не параллельная quality implementation.

Если `medium` не проходит staging latency gate, конфигурация не меняется молча. Отдельный
`low` experiment возможен только после нового explicit owner approval и отдельного task/config
change; текущий evidence run останавливается.

## Ошибки и fallback

- Invalid candidate: no outbound; sanitized quality reason; safe fallback/handoff according to
  app policy.
- Timeout/provider failure: inbound remains saved; UI gets honest accepted/fallback state; no
  invented AI message.
- Takeover/state change during model work: candidate is blocked by current app send gate.
- Unexpected model identity: current run fails closed and further Mastra evidence stops.
- Observability write failure: no false success; preserve inbound and route to manager review.

## Tests and evidence

P1Q содержит 15-20 repo-authored synthetic acceptance fixtures. Они доказывают context assembly,
schema/source validation and predefined candidate-to-apply/send-gate behavior. Fakes не доказывают
model understanding, negation/mixed-intent routing или natural tone.

M3 прогоняет фиксированные 15-20 sanitized inputs через authenticated model: multi-turn
continuation, known-slot reuse, no-repeat, typo/paraphrase, negated and explicit manager requests,
mixed price/ordinary question, safe general choice, missing approved fact, unsafe promise and
takeover. Этот corpus не импортирует customer transcripts и не заменяет будущий S10 bad-dialog
sanitization/promotion workflow.

M3 hard gates must pass 100%:

- schema-valid action;
- no prohibited commercial/legal promise;
- no AI reply after blocked send gate/takeover;
- explicit manager request produces real handoff state;
- negated manager request does not produce false handoff.

Первый failure любого hard gate немедленно останавливает оставшийся corpus run и запускает
operator rollback на frozen direct profile; safety failure нельзя усреднять в общий pass rate.

Soft quality is reviewed with stable labels: `context_retained`, `useful_next_step`,
`no_repeated_question`, `natural_tone`, `too_dry`, `form_instead_dialog`. Staging evidence records
pass rate, fallback rate, p50/p95 full-response latency, token/cost summary and UI pending-state
timing. Exact full-response latency threshold is an owner gate after the first representative
staging baseline; no production claim follows from local results.

## Out of scope

- production or real-customer enablement;
- token streaming/SSE/WebSocket in the first slice;
- vector RAG, long-term semantic memory or full catalog ingestion;
- arbitrary tools, external browsing, skills/layers or Codex harness;
- `codex_subscription`, ChatGPT subscription auth or installed server CLI reuse;
- Mastra Studio, public runtime/trace routes or Mastra Cloud as source of truth;
- Telegram AI outbound, S08 or S10 manager-driven eval promotion;
- free generation of prices, deadlines, availability or binding terms.

## Approval boundary

Owner confirmed this design direction on 2026-07-14. Approval permits updating planning docs
only. Canonical cross-repo sequencing remains the owner-approved `granit-plan-app` decision;
implementation authority comes only from repo-local tasks in each owning repo. Each slice still
requires its own review, tests and evidence. No package, runtime, schema, deploy, staging or
production change is authorized by this document.
