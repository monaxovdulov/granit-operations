# Дизайн исправлений website widget: issues #14–#17

Дата: 2026-07-22  
Статус: одобрено владельцем для реализации и staging-only rollout  
Связанные issues: `granit-operations#14`, `#15`, `#16`, `#17`; последующий аудит `#13`

## Цель и порядок

Исправить выявленные владельцем проблемы website widget без ослабления catalog grounding, semantic verifier, persistence-before-reply, manager takeover и atomic send-time gate.

Работа выполняется по приоритетам:

1. P0 `#14`: управление диалогом, неопределённость, повторы, раздражение и неподтверждённый контекст.
2. P0 `#16`: безопасные кликабельные catalog references без технических URL в видимом тексте.
3. P1 `#15`: правдивые `sent / accepted / typing / terminal` состояния и быстрый persistence acknowledgment.
4. P1 `#17`: server-authoritative timestamps и разделители дат.
5. Аудит качества по `#13`, staging rollout и визуальная проверка desktop/mobile.

Production deploy, merge готовых PR, Telegram AI outbound и произвольный HTML в ответах не входят в scope.

## Репозитории и ответственность

- `granit-operations` владеет persistence, dialogue policy, model/verifier boundary, durable AI jobs, public widget API/history и observability.
- `business-ai-web-widget` владеет исходным Web Component, строгим разбором public contract, polling lifecycle, сообщениями, metadata row, ссылками, accessibility и browser tests.
- `landing-granit-static` владеет только vendored content-addressed runtime и staging preview integration.

Исходный код виджета меняется в чистом выделенном worktree `codex/w0-site-widget-truth-timeout`; dirty checkout `business-ai-web-widget/main` не затрагивается. Сгенерированный runtime переносится в landing только после source tests и build.

## #14: app-owned dialogue control

### Сигналы диалога

Перед вызовом модели формируется детерминированное представление последних ходов:

- явная неопределённость: `не знаю`, `не разбираюсь` и близкие формулировки;
- явное исправление неподтверждённого предположения;
- раздражение/жалоба на повтор;
- уже заданные AI-вопросы и их семантические категории;
- подтверждённые visitor facts и persisted slots/requirements.

Сигналы выводятся только из сохранённого текста и app-owned state. Они не становятся новыми customer facts.

### Политика и normalizer

App-owned pre/post-model guard обеспечивает:

- после неопределённости — простое объяснение выбора или безопасная рекомендация с подтверждением, а не повтор taxonomy;
- `у меня дед` может дать только осторожный one-person context с явным подтверждением;
- следующий requested slot не может семантически повторять отклонённый или только что заданный вопрос;
- city, cemetery, budget, deadline, dimensions и иные visitor facts запрещены без visitor evidence;
- исправление явно отзывает ошибочное предположение и не сохраняет derived slot;
- первая жалоба запускает concise repair; повторное раздражение после repair — concise apology и manager handoff/offer;
- policy-owned handoff выключает дальнейшие AI replies через существующий send-time gate.

Prompt и verifier получают те же ограничения, но безопасность не зависит только от поведения модели: post-plan validator отклоняет unsupported facts и duplicate question plans до renderer/send.

Точный transcript из issue #14 сохраняется как deterministic multi-turn regression fixture до изменения поведения. Evals фиксируют ожидаемые intent, action, requested slot, renderer ownership и отсутствие Minsk/cemetery.

## #16: структурированные catalog references

### Backend contract

Проверенная model decision преобразуется в app-owned reply со следующими независимыми частями:

- естественный `text` без raw catalog URL;
- массив `catalog_references` с `kind`, display label/title, canonical relative `href` и catalog entity identity;
- verifier evidence, связывающий reference с выбранной published/active catalog record.

References сохраняются в metadata assistant message и возвращаются в immediate terminal response и public history. Тот же canonical URL, который прошёл grounding/verifier, используется в `href`; модель не генерирует HTML.

### Widget rendering

Widget принимает reference только если:

- `href` относительный и ведёт на `/catalog.html` текущего origin;
- query содержит только ожидаемые `section` и `entity`, anchor соответствует catalog block contract;
- scheme/host отсутствуют, entity имеет допустимый формат;
- label выводится как text node, а не HTML.

Невалидная reference отбрасывается без кликабельного элемента. Для ранее сохранённого текста с каноническим raw URL применяется ограниченный backward-compatible parser: URL удаляется из видимого текста и превращается в ссылку только после той же allowlist-проверки. Остальные URL остаются обычным escaped text.

Поддерживаются одна и несколько references, keyboard focus, meaningful accessible name и click-through к точной карточке/секции.

## #15: быстрый acknowledgment и durable AI job

### Почему не синхронный POST и не таймерная имитация

Текущий POST ждёт model/verifier до 11–18 секунд и не может правдиво показать server acceptance раньше terminal result. Клиентский таймер создавал бы ложную семантику. SSE не нужен для текущей нагрузки: bounded polling существующего history/status проще, восстанавливается после reload и достаточно быстро сообщает terminal state.

### Persistence transaction

В одной Postgres-транзакции backend:

1. валидирует request/idempotency;
2. сохраняет inbound message;
3. создаёт ровно один durable `widget_ai_jobs` row для eligible turn;
4. возвращает `202` с safe public IDs, authoritative inbound timestamp и `automation.status=processing`.

Unique inbound-message identity не допускает duplicate job при retry/replay. Disabled/takeover turns сразу возвращают соответствующее terminal состояние без job.

### Worker

App-owned worker claim-ит jobs через `FOR UPDATE SKIP LOCKED`, фиксирует attempt/lease timestamps и выполняет существующий generator → verifier → atomic send gate → persistence pipeline. Возможные terminal состояния: `replied`, `degraded`, `manager_pending`, `blocked`, `failed`.

Обработка restart-safe: stale lease возвращается в retry с ограниченным числом попыток; сохранённый assistant message/idempotency key предотвращает повторную отправку. Worker стартует только при явной runtime config и включается на staging в рамках одобренного rollout. Production config не меняется.

Public history/status содержит processing state по inbound public message и terminal reason/state. Polling само ничего не генерирует и не меняет job.

### Client state machine

- Bubble создаётся немедленно: `✓ Отправлено` означает browser dispatch.
- После реального `202`: server timestamp заменяет client timestamp, отображается `✓✓ Принято`, запускаются typing и bounded polling.
- Typing не является сообщением и не получает timestamp.
- Reply/history reconciliation заменяет typing persisted reply.
- Degraded, timeout, network error, takeover, abort, navigation и poll budget завершаются отдельным правдивым состоянием без вечной анимации.
- Reload читает сохранённый session id и public history, но не повторяет POST и не создаёт новый AI run.

Три точки typing animation поддерживают `prefers-reduced-motion`; `aria-live` сообщает текстовые статусы. Full disclosure не добавляется в transcript, а показывается один раз как компактная подпись в intro/header. Битый greeting glyph и повторяющийся `Сохранено` удаляются.

## #17: timestamps и date separators

Каждое persisted message использует backend `submitted_at`. Immediate acknowledgment также возвращает authoritative inbound timestamp. Pending bubble временно использует captured client time и заменяет его server value после ack.

Widget:

- показывает `HH:mm` через `ru-RU` в timezone браузера;
- использует semantic `<time datetime>` и полный localized accessible label;
- объединяет время outgoing message и delivery checks в одну metadata row;
- добавляет `Сегодня`, `Вчера` или localized calendar date между днями;
- не меняет canonical message ordering при timezone formatting;
- безопасно скрывает invalid/missing timestamp вместо `Invalid Date`;
- пересчитывает relative separators при смене локального дня, пока widget открыт.

## Public contract evolution

Текущий клиент строго разбирает `site_widget.v1`, поэтому добавление новых полей под тем же номером создало бы rollout-окно несовместимости. Асинхронный flow выпускается как явный `site_widget.v2`:

- v2 request сохраняет text-only request semantics, но явно выбирает новый response contract;
- v2 POST success возвращает `automation.status=processing` и authoritative `submitted_at`;
- v2 history содержит structured `catalog_references` и processing/terminal status там, где применимо;
- terminal immediate response сохраняется для replay уже завершённого idempotent turn;
- новый widget запрашивает versioned history v2 явно; default history v1 и sync POST v1 остаются доступны старому staging runtime на время перехода;
- после backend-first deploy новый content-addressed widget переключается на v2; v1 не удаляется в рамках этих issues.

Strict v2 parsers и fixtures обновляются синхронно; неизвестные или небезопасные поля по-прежнему fail closed. Schema artifacts, contract docs и CORS behavior обновляются согласованно. Public internal IDs, traces, model prompts и secrets не выдаются.

## Ошибки, retries и rollback

- Persistence failure до acknowledgment возвращает retryable failure и не показывает `✓✓`.
- Job/model/verifier failure после acknowledgment оставляет visitor message сохранённым и переводит UI в calm delayed/degraded state.
- Manager takeover выигрывает любую гонку через существующий atomic send gate.
- Polling ограничен по частоте, duration и abort signal; сетевой сбой не создаёт новый inbound message.
- Rollback backend: выключить worker flag/AI widget, вернуть предыдущий image и миграцию оставить inert; destructive down migration на staging не требуется.
- Rollback frontend: повторно развернуть предыдущий content-addressed landing commit/runtime.

## Проверки и доказательства

### Backend

- transcript regression #14 и дополнительные uncertainty/correction/frustration cases;
- duplicate-question и unsupported-context validator tests;
- catalog reference single/multiple/malformed/history tests;
- ack latency независимо от delayed model;
- job transaction, replay, concurrent claim, stale lease, retry, restart, takeover и no-duplicate tests;
- full API suite, typecheck/build, offline evals и live staging eval/smoke.

### Widget

- parser/state/component tests для sent/accepted/typing/replied/degraded/takeover/network/reload;
- URL allowlist, escaping, raw-URL compatibility и keyboard/screen-reader tests;
- timestamp/date tests: today/yesterday/older/year boundary/timezones/invalid/midnight;
- reduced motion, aria-live и no-overflow coverage;
- full unit/component, TypeScript, production build и Playwright browser suite.

### Staging evidence

- measured time-to-ack отдельно от time-to-reply;
- live exact #14 transcript или безопасный deterministic equivalent;
- «Арфа» link visible-label and click-through smoke;
- takeover and degradation terminal states;
- desktop и mobile screenshots для sent, accepted, typing, replied, degraded/takeover и multi-day history;
- ручная оценка layout, overflow, focus, readable labels, console/network errors и фактической работоспособности.

Evidence сохраняется без PII/secrets в `docs/release/evidence/`. Production не меняется.

## Аудит issue #13

После реализации #14–#17 каждый исходный плохой ответ классифицируется по ownership: prompt/model, policy, memory, normalizer, renderer, knowledge/retrieval, verifier или UI. Аудит сверяет corpus, automated coverage, persisted AI-run metadata и fresh staging results. Если обнаружен непокрытый regression в этом scope, он исправляется до staging handoff; отдельные product/knowledge gaps документируются явно и не маскируются общим статусом `passed`.
