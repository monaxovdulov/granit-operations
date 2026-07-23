# План реализации: живой AI-консультант и постоянная навигация в каталог

Design: `docs/superpowers/specs/2026-07-21-widget-ai-consultation-catalog-navigation-design.md`

Issue: `monaxovdulov/granit-operations#13`

Status: готов к реализации после посадки design-only PR `#12`

## Цель

Устранить повторяющийся опрос из issue `#13`, разрешить только подтверждённые каталогом цены и ссылки, а переход по catalog action выполнить без размонтирования или мигания того же DOM-экземпляра виджета. Изменения поставляются согласованными версиями трёх репозиториев: backend/contracts, browser widget и статический landing.

## Исходные точки и безопасность веток

1. Сначала смержить design-only PR `monaxovdulov/granit-operations#12`. Реализацию вести отдельной веткой `agent/widget-ai-quality-catalog-navigation` от обновлённого `main`; не добавлять код в PR `#12`.
2. `granit-operations`: базой служит `main`, содержащий commit `8100358`; следующая migration — `0016`.
3. `business-ai-web-widget`: создать чистый worktree и ветку `agent/widget-catalog-actions` от `7f72ff4b6044ce1973f21249e0a8770c622dcc62` (`origin/fix/widget-staging-response-contract`). Эта integration branch на 27 commits впереди `main` без divergence, поэтому feature PR сначала target-ит её либо ждёт её посадки в `main`. Текущий основной checkout со staged deletions не изменять, не восстанавливать и не использовать для реализации.
4. `landing-granit-static`: создать чистый worktree и ветку `agent/persistent-widget-catalog-navigation` от `f8139135f8308308c4eb8baee75ba20558871784`. `origin/agent/catalog-rag-staging` и preview branch `origin/codex/site-widget-v1.0.0-rc` указывают на этот commit и находятся на 9 commits впереди `main`; feature PR сначала target-ит preview branch, которую уже слушает deploy workflow, либо ждёт её посадки. Не начинать со stale локального checkout.
5. Перед каждым срезом записать точные base/head SHA и `git status --short --branch`; коммиты, PR и diff review вести отдельно для каждого репозитория.
6. Реальные числовые цены не публиковать в этом цикле без отдельного owner-reviewed набора данных. Схема и тестовые fixtures входят в работу, production-like snapshot остаётся без сумм до подтверждения владельцем.
7. Текущий checkout не содержит default source root `../pdf-analiz`, который ожидает `build:catalog-knowledge`. Builder проверять на committed минимальном source fixture; не заявлять production snapshot rebuild. Для будущей публикации цен сначала предоставить точный canonical product source и записать его version/hash.
8. Если любая remote integration branch сдвинулась до начала реализации, сначала повторить graph/diff audit и обновить base SHA в issue; не делать слепой rebase поверх неизвестных изменений.

## Срез 1. Регрессия issue `#13` и состояние `unknown_for_now`

Репозиторий: `granit-operations`

Файлы:

- `apps/api/src/modules/ai/ai-dialog-contract.ts`
- `apps/api/src/modules/ai/ai-turn.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-semantic-verifier.ts`
- `apps/api/src/modules/ai/grounding/ai-decision-validator.ts`
- `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`
- `apps/api/src/modules/ai/rendering/widget-ai-reply-renderer.ts`
- `apps/api/src/modules/ai/services/grounded-widget-ai-service.ts`
- `apps/api/src/modules/ai/verification/widget-ai-semantic-verifier.ts`
- `apps/api/src/modules/ai/verification/widget-ai-verification-validator.ts`
- `apps/api/src/modules/conversations/repositories/conversation-message-repository.ts`
- `apps/api/src/modules/conversations/repositories/intake-repository.ts`
- `apps/api/src/modules/conversations/repositories/lead-conversation-types.ts`
- `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`
- `apps/api/src/modules/conversations/repositories/public-intake-repository.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/manager/src/types.ts`
- `apps/manager/src/display.ts`
- `apps/manager/src/App.tsx`
- `apps/api/test/helpers/memory-intake-repository.ts`
- `apps/api/test/grounded-widget-ai.test.ts`
- `apps/api/test/manager-ai-quality-visibility.test.ts`
- `apps/api/test/openai-widget-assistant-provider.test.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/widget-ai-memory.test.ts`
- `packages/db/migrations/0016_widget_ai_catalog_navigation.sql`
- `packages/db/src/schema.ts`

Работа:

1. Сначала добавить падающий последовательный multi-turn test с репликами из issue `#13`: `не знаю`, `я не разбираюсь`, `не определился`, `с кладбищем`, повторное `не определился`.
2. Добавить evidence-backed `deferredSlotUpdates` и отдельное turn input поле `deferredSlots`; строку `не знаю` никогда не сохранять как значение слота.
3. Создать `conversation_slot_deferrals` с уникальностью `conversation_id + slot_name`, source message, quote/UTF-16 offsets и timestamps. В одной транзакции создавать deferral, удалять его после подтверждённого значения и сохранять outbound turn.
4. Добавить typed `requested_slot` к `ai_runs` и сохранять финальный app-owned normalized plan. Валидировать deferral только по точной цитате visitor message и последнему успешному run, который действительно задал этот slot; не позволять модели откладывать произвольный параметр.
5. Заменить фиксированную очередь вопросов goal-based выбором: исключать known/deferred slots, учитывать полезность вопроса и признаки неуверенности; после двух последовательных deferrals предлагать каталог или помощь менеджера.
6. Сохранить проверенный естественный `replyText`, когда он согласован с normalized plan. App-owned renderer применять только при изменённом/опасном plan и сделать его context-aware.
7. Различать клиентский факт и обратимую рекомендацию: `у меня дед` не доказывает `monumentType=single`, но позволяет предложить single как стартовый вариант словами `можно изменить`. Рекомендацию не сохранять в known slots.
8. Добавить в manager-facing `structuredIntake` отдельный `deferredSlots` с evidence; исключить эти имена из обычного `missingFields` и показать блок `Пока не определено`, не создавая фиктивное значение в `slots`.

Проверка:

- focused tests на evidence, создание/повтор deferral, удаление новым value, transaction rollback и idempotent replay;
- multi-turn test подтверждает, что cemetery не спрашивается повторно и не заменяется другим профессиональным вопросом;
- `у меня дед` не создаёт unsupported slot value, а ответ предлагает понятную обратимую базовую гипотезу;
- `manager-ai-quality-visibility.test.ts` подтверждает отдельный deferred read model и отсутствие фиктивного slot value;
- `npm test -- apps/api/test/grounded-widget-ai.test.ts apps/api/test/widget-ai-memory.test.ts apps/api/test/public-intake.test.ts apps/api/test/manager-ai-quality-visibility.test.ts apps/api/test/openai-widget-assistant-provider.test.ts`;
- `npm run eval:widget-ai:offline`;
- `npm run typecheck`.

Коммит: `feat(ai): remember deferred consultation answers`

## Срез 2. Каноническая цена и безопасные catalog suggestions

Репозиторий: `granit-operations`

Файлы:

- `apps/api/src/modules/ai/catalog/catalog-knowledge-port.ts`
- `apps/api/src/modules/ai/catalog/catalog-prompt-record.ts`
- `apps/api/src/modules/ai/catalog/file-catalog-knowledge-provider.ts`
- новый `apps/api/src/modules/ai/catalog/catalog-action-resolver.ts`
- новый `apps/api/src/modules/ai/catalog/catalog-price-resolver.ts`
- `apps/api/src/modules/ai/ai-dialog-contract.ts`
- `apps/api/src/modules/ai/ai-turn.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-semantic-verifier.ts`
- новый `apps/api/src/modules/ai/catalog/sources/catalog-prices.v1.json`
- `apps/api/src/modules/ai/catalog/snapshots/catalog-knowledge.v1.json`
- `apps/api/src/modules/ai/grounding/ai-catalog-reference-validator.ts`
- `apps/api/src/modules/ai/grounding/ai-decision-validator.ts`
- `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`
- `apps/api/src/modules/ai/rendering/widget-ai-reply-renderer.ts`
- `apps/api/src/modules/ai/services/grounded-widget-ai-service.ts`
- `apps/api/src/modules/ai/verification/widget-ai-semantic-verifier.ts`
- `apps/api/src/modules/ai/verification/widget-ai-verification-validator.ts`
- `apps/api/src/scripts/build-catalog-knowledge.ts`
- новый `apps/api/test/fixtures/catalog-builder/`
- новый `apps/api/test/catalog-knowledge-build.test.ts`
- новый `apps/api/test/catalog-action-resolver.test.ts`
- новый `apps/api/test/catalog-price-resolver.test.ts`
- `apps/api/test/catalog-knowledge-provider.test.ts`
- `apps/api/test/grounded-widget-ai.test.ts`
- `apps/api/test/openai-widget-assistant-provider.test.ts`

Работа:

1. Расширить schema каталога typed price record полями `priceType`, `amountMinor`, `currency`, `unitLabel`, `appliesToRecordIds`, `includes`, `excludes`, `installation`, периодом действия, provenance и owner approval.
2. Добавить checked-in reviewed price source с версией и пустым массивом records. Builder объединяет его с явно переданными product entities и один генерирует backend snapshot; generated snapshot вручную не редактируется, а source root/version/hash попадают в build result.
3. В build/provider validation отклонять неположительные суммы, неизвестную валюту/unit, dangling target IDs, overlap или неверный период действия, draft/retired/expired price record и запись без review provenance.
4. Добавить отдельные reviewed test fixtures для `from`, `fixed`, отсутствующей цены и трёх installation states, передаваемые builder как fixture source. Не добавлять сумму в текущий production-like price source или snapshot.
5. Добавить максимум три model-owned `catalogSuggestions` только как `{recordId, target}`. Проверять selected/published/current record, snapshot identity и наличие канонического `frontend` destination.
6. Создать единый app-owned resolver публичного label/href. Разрешать только относительный `/catalog.html`, query keys `section` и `entity`, а для item — fragment, точно равный `frontend.blockId`/`frontend.anchor` той же record; запрещать origin/protocol/encoded path escape/лишние параметры.
7. Привязать текст цены и installation claim к конкретной price record. При отсутствии записи запрещать числа и использовать `цена по запросу`.
8. Сбрасывать model suggestions, если normalization заменил ответ или изменил его смысл; renderer может вернуть только детерминированные actions из того же verified snapshot.

Проверка:

- provider/build tests для published, draft, retired, expired и malformed price records;
- malicious URL table tests и item/section destination tests;
- exact `от N ₽`, fixed price, installation included/excluded/unspecified и no-price tests;
- stale snapshot и suggestion-not-selected отклоняются до public boundary;
- `catalog-knowledge-build.test.ts` дважды запускает builder на committed fixture во временные outputs и сравнивает байты/content hash;
- `npm test -- apps/api/test/catalog-knowledge-build.test.ts apps/api/test/catalog-knowledge-provider.test.ts apps/api/test/catalog-action-resolver.test.ts apps/api/test/catalog-price-resolver.test.ts apps/api/test/grounded-widget-ai.test.ts apps/api/test/openai-widget-assistant-provider.test.ts`;
- `npm run typecheck`.

Коммит: `feat(ai): ground prices and catalog suggestions`

## Срез 3. Backward-compatible actions, persistence и history

Репозиторий: `granit-operations`

Файлы:

- `packages/contracts/src/site-widget/v1.ts`
- `packages/contracts/schemas/site-widget.v1.json`
- `packages/contracts/src/index.ts`
- `apps/api/src/config.ts`
- `apps/api/src/app-context.ts`
- `apps/api/src/modules/intake/ports/public-widget-ai-reply-generator.ts`
- `apps/api/src/modules/intake/routes/public-intake-routes.ts`
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/api/src/modules/conversations/repositories/conversation-message-repository.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/test/helpers/memory-intake-repository.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/public-intake-cors.test.ts`
- `apps/api/test/config.test.ts`
- `apps/api/test/ai-observability-sanitizer.test.ts`

Работа:

1. Расширить message request optional полем `client_capabilities` и history GET параметром `capability`; единственное распознаваемое значение первого релиза — `catalog_navigation.v1`.
2. Расширить capable accepted response optional полем `reply.actions` и capable history message optional полем `actions`. Текущий widget `7f72ff4` использует exact-key parsing, поэтому без capability backend обязан вернуть прежнюю точную text-only форму, а не надеяться на игнорирование нового поля.
3. Разрешить только публичную форму `catalog_navigation` с `item | section`, bounded label, safe href, catalog version и record id; внутренние evidence/provider fields в contract не выводить.
4. Сохранить capability-negotiated actions в `conversation_messages.metadata.public_actions` в той же транзакции, что outbound reply. Если flag или capability отсутствовали на исходном send, сохранить text-only public result. History читает только сохранённый public payload.
5. Включить normalized/sorted `client_capabilities` в idempotency fingerprint. Для совпавшего key возвращать первоначально сохранённые actions байт-в-байт, не резолвить их заново по новому snapshot или изменившемуся flag; тот же key с другим capability set отклонять как payload conflict.
6. Добавить `AI_WIDGET_RICH_ACTIONS_ENABLED=false` по умолчанию. Actions выдаются только при `flag && capability`; внутреннее качество ответа и deferrals работают независимо.
7. Санитизировать action metadata отдельно от model/verifier metadata и писать controlled quality event при отброшенном unsafe action без утечки PII.
8. Подтвердить CORS для history GET и неизменность существующих send-time gates, handoff и manager-visible dialogue.

Проверка:

- contract parse tests для legacy exact shape, unknown/known capability, valid actions, limit и hostile href;
- persistence/history/idempotency tests, включая смену catalog version после первого ответа и capability mismatch на том же key;
- flag-off и flag-on integration tests;
- `npm run smoke:api`;
- `npm test`;
- `npm run typecheck`;
- `npm run build`.

Коммит: `feat(api): persist widget catalog actions`

## Срез 4. Multi-turn eval и географическая честность

Репозиторий: `granit-operations`

Файлы:

- `apps/api/src/modules/ai/eval/widget-ai-regression-corpus.ts`
- `apps/api/src/modules/ai/eval/widget-ai-eval-runner.ts`
- `apps/api/src/modules/ai/knowledge/approved-widget-knowledge.ts`
- `apps/api/src/scripts/run-widget-ai-evals.ts`
- `apps/api/test/widget-ai-eval.test.ts`
- `apps/api/test/widget-ai-memory.test.ts`

Работа:

1. Научить eval runner последовательно переносить known slots, deferrals, recent messages и catalog identity между ходами одной case.
2. Зафиксировать issue `#13` как обязательный multi-turn corpus case с проверками action/next question/deferral, а не набором независимых prompts.
3. Добавить cases на раздражение клиента, две deferrals, последующее уточнение значения, no-price, reviewed-price fixture, item/section suggestions и unsafe suggestion.
4. Зафиксировать текущую business truth: Москва и Московская область подтверждены, Минск не подтверждён. Ответ после `Минск` предлагает manager confirmation и не продолжает расчёт как доступный.
5. Сохранить live eval opt-in; dry-run обязан показать версии prompt/verifier/catalog и число multi-turn cases без model call.

Проверка:

- `npm run eval:widget-ai:offline`;
- `npm run eval:widget-ai:dry-run`;
- live eval выполнять только с owner-provided credentials и явно записать, был ли реальный model call;
- corpus assertion запрещает повтор одного deferred requested slot.

Коммит: `test(ai): cover issue 13 consultation flow`

## Срез 5. Rich actions и восстановление в browser widget

Репозиторий: `business-ai-web-widget`

База: чистый worktree от `7f72ff4b6044ce1973f21249e0a8770c622dcc62`

Файлы:

- `packages/site-widget/src/domain/response.ts`
- `packages/site-widget/src/domain/config.ts`
- `packages/site-widget/src/domain/loader-options.ts`
- `packages/site-widget/src/domain/state.ts`
- `packages/site-widget/src/domain/view-model.ts`
- `packages/site-widget/src/types/public.ts`
- `packages/site-widget/src/services/intake-client.ts`
- `packages/site-widget/src/services/session-store.ts`
- `packages/site-widget/src/events/widget-events.ts`
- `packages/site-widget/src/components/widget-message.ts`
- `packages/site-widget/src/components/granit-site-widget.ts`
- `packages/site-widget/src/styles/message.styles.ts`
- `packages/site-widget/src/styles/widget.styles.ts`
- `packages/site-widget/src/loader.ts`
- `packages/site-widget/tests/helpers/response-fixtures.ts`
- `packages/site-widget/tests/domain.test.ts`
- `packages/site-widget/tests/component.test.ts`
- `packages/site-widget/tests/loader.test.ts`
- `packages/site-widget/tests/browser/widget.spec.ts`

Работа:

1. Объявлять `client_capabilities: ["catalog_navigation.v1"]` в send request и ту же capability в history GET; парсить optional actions, сохраняя strict проверку остальных ключей. Невалидную action отбрасывать, не теряя текст ответа.
2. Добавить optional loader config `data-history-base-path` с default `/public/intake/site-widget/sessions`; client добавляет только заранее нормализованный UUID и `/history`, затем capability query. Hydrate transcript при восстановленной session id: `404` очищает stale id, временная ошибка оставляет id и позволяет retry, intro/disclosure не дублируются.
3. Рендерить actions отдельными Lit bindings без Markdown, `innerHTML` и raw HTML. Добавить loading/success/error/retry состояние на конкретную action.
4. Для primary click/Enter создать `navigationId` и отправить bubbling/composed/cancelable `site-widget:catalog-navigate`; modifier/middle click оставить стандартным new-tab действием. Разрешать один in-flight visit и принимать `site-widget:catalog-navigation-result` с `success | error` только для текущего id.
5. Сохранять messages, draft, open/minimized state, scroll и выполняющийся request внутри живого custom element. Navigation не должна вызывать history refetch.
6. Добавить mobile состояние `Вернуться в диалог`; при catalog navigation сворачивать panel без удаления элемента. На desktop сохранять normal/wide panel, а fullscreen предварительно сворачивать.
7. Отправлять `site-widget:layout-change` с allowlisted `closed | minimized | open` и `normal | wide | fullscreen`, не раскрывая внутреннее состояние Shadow DOM.
8. Сделать loader идемпотентным относительно permanent host: не создавать второй widget при повторном выполнении после Turbo visit.

Проверка:

- domain tests на accepted/history mapping и tolerant action rejection;
- component tests на text-only safe render, navigation/layout events, correlation, modifier click, unhandled bridge, retry и disclosure dedupe;
- loader test на повторный вызов с уже смонтированным элементом;
- browser tests на сохранение draft/messages/pending request при simulated navigation events;
- `npm run check`;
- `npm test`;
- `npm run build`;
- `npm run test:browser`;
- `npm run verify:package`;
- `npm run release:runtime` и `npm run smoke:runtime`.

Коммиты:

- `feat(widget): render persistent catalog actions`
- `feat(widget): restore public conversation history`

Результат среза: immutable runtime artifact и manifest, привязанные к точному новому source commit SHA; versioned directory не перезаписывается.

## Срез 6. Permanent host, Turbo bridge и каталог на landing

Репозиторий: `landing-granit-static`

База: чистый worktree от `f8139135f8308308c4eb8baee75ba20558871784`

Файлы:

- `index.html`
- `catalog.html`
- `about.html`
- `styles.css`
- `catalog.css`
- `catalog.js`
- `lazy-loading.js`
- `form-handler.js`
- `portfolio-slider.config.js`
- `portfolio-slider.js`
- `review-slider.js`
- `vendor/hotwired/turbo/8.0.23/` с runtime, license и manifest/checksum
- новый `site-navigation.js`
- `data/catalog.json`
- `data/catalog-inline.js`
- `scripts/build-catalog.py`
- `scripts/smoke-catalog.py`
- `.github/scripts/w0-browser-smoke.mjs`
- `.github/workflows/deploy-preview.yml`
- `vendor/granit/site-widget/by-commit/<new-widget-sha>/`

Работа:

1. Vendor exact widget runtime из среза 5 и Turbo `8.0.23` с license, source URL и SHA-256 manifest. Обновить loader SHA атомарно на всех поддерживаемых страницах и в deploy smoke; не перезаписывать старые rollback artifacts.
2. На всех трёх HTML-страницах (`index.html`, `catalog.html`, `about.html`) обернуть page-specific DOM в ровно один `#granit-page-content`, а sibling host объявить как `#granit-site-widget-host[data-turbo-permanent]`. Везде использовать одну widget/API конфигурацию и `data-widget-instance-id="landing-main"`; loader монтирует widget только внутрь host.
3. Установить `Turbo.session.drive = false`: обычные ссылки и формы сохраняют browser behavior. Bridge независимо перепроверяет action type, same-origin `/catalog.html`, query/fragment и `navigationId`; только после этого принимает event через `preventDefault()`, хранит один active id и вызывает программный `Turbo.visit()`.
4. На `turbo:before-render` валидировать в `newBody` ровно один page root и host, удалить incoming duplicate host и через `event.detail.render` заменить только текущий `#granit-page-content`. Синхронизировать allowlisted body class/data attributes; текущие `<body>` и live host не заменять и не перемещать.
5. Обернуть стандартный adapter закреплённой версии узким catalog-action failure adapter: успешные visits делегировать без изменений; network/timeout/content-type/HTTP/invalid-shell failure завершать с очисткой busy/progress и correlated error без `window.location`. Любой `turbo:reload` для активного `navigationId` считать ошибкой.
6. Перенести Turbo, bridge, widget loader и общий набор controller scripts в одинаковый `defer`-набор `<head>` всех страниц. Убрать runtime scripts из заменяемого page root; page-specific CSS пометить dynamic без tracked reload mismatch.
7. Перевести catalog, form, lazy-loading, portfolio и review scripts с однократного выполнения на идемпотентные controllers: init на initial/Turbo load, cleanup listeners/timers/observers/modal state перед cache/render. Повторная регистрация одного controller запрещена.
8. Расширить уже существующий `section`/`entity` deep-link flow: не создавать второй mapping; гарантировать раскрытие блока, дорендеривание target, focus, status announcement и очистку stale entity при ручной смене фильтра. После `turbo:load` controller возвращает bridge итог target/section, и только тогда bridge отправляет через `window` `site-widget:catalog-navigation-result(status=success)`. Missing entity остаётся в корректном section с сообщением об актуальных вариантах.
9. Bridge отражает `site-widget:layout-change` в data attributes постоянного `<html>` и восстанавливает их после lifecycle. Добавить desktop safe area/reflow только для открытого normal/wide widget. На mobile свернутый launcher и выбранная карточка не перекрываются; hero и каталог сохраняют доступный viewport.
10. Обновить catalog build/smoke так, чтобы frontend `entity_links` оставались точной производной backend snapshot. Price fields выводить только после отдельной owner-reviewed публикации.
11. Исправить workflow checks так, чтобы все page/parser/path/hash assertions проверяли одинаковый runtime set и один новый widget SHA, а не одновременно текущие `7f72ff4` и устаревший `2982de0`.

Проверка:

- `python3 scripts/smoke-catalog.py` рядом с актуальным checkout `granit-operations`;
- `python3 scripts/smoke-catalog.py --ci` в isolated landing checkout;
- `node --check catalog.js` и `node --check site-navigation.js`;
- локальный preview: `python3 -m http.server 4174 --bind 127.0.0.1`;
- `NODE_OPTIONS=--max-old-space-size=512 node .github/scripts/w0-browser-smoke.mjs`;
- checksum/license/manifest assertions для Turbo `8.0.23` и нового widget runtime;
- custom render smoke: `<body>` и widget element сохраняют строгую identity, `disconnectedCallback` не вызывается;
- head/runtime smoke: три страницы используют один instance id, tracked signatures совпадают, controllers не регистрируются повторно;
- spoofed custom event с external/неизвестным href не вызывает visit или hard navigation;
- direct-load smoke для `/`, `/catalog.html`, `/about.html` и отсутствующего route `404`.

Коммиты:

- `feat(site): preserve widget across catalog visits`
- `test(site): cover persistent catalog navigation`

## Срез 7. Сквозной browser и paired staging smoke

Репозитории: все три, без смешивания исходников между PR

Работа:

1. Расширить landing Playwright smoke desktop и mobile сценариями с реальным vendored widget: click item/section action, URL/page update, target focus/highlight и Back/Forward.
2. Сохранить JS-ссылку на widget element до visit и проверить строгую DOM identity после visit; отдельно зафиксировать, что `disconnectedCallback` не вызван и pending request не abortился.
3. Проверить messages, draft, open/minimized state и scroll до/после перехода; на mobile launcher `Вернуться в диалог` возвращает тот же разговор без history fetch.
4. Смоделировать Turbo fetch/render failure: URL и document не заменяются, widget остаётся жив, action получает retry, hard reload отсутствует.
5. Развернуть на paired staging точные backend, widget и landing commit SHA с `AI_WIDGET_RICH_ACTIONS_ENABLED=false`. Проверить обычный send/history, deferrals, manager-visible dialogue и отсутствие actions даже у capable client.
6. Включить flag только на staging и отправить реальный multi-turn сценарий issue `#13`: перейти по item и section action, проверить stored `public_actions`, history и idempotent replay.
7. При включённом и выключенном flag проверить старый client без capability: форма ответа всегда остаётся прежней и проходит exact-key parser `7f72ff4`. Production rollout и публикация реальных price records остаются отдельными подтверждаемыми шагами.

Проверка:

- `npm test && npm run typecheck && npm run build` в `granit-operations`;
- `npm run release:validate` в `business-ai-web-widget/packages/site-widget`;
- оба режима `scripts/smoke-catalog.py` и browser smoke в `landing-granit-static`;
- screenshots на desktop/mobile и layout assertions: target не закрыт panel/launcher, текст и controls не пересекаются;
- network/lifecycle assertions: нет document reload, второго widget loader, повторного history GET или abort текущего POST;
- ручная запись точных SHA, flag state, catalog version/content hash и результата каждого smoke в issue `#13`.

## Порядок PR и rollout

1. Смержить `granit-operations#12`, подтвердить integration heads двух frontend-репозиториев и создать три чистые implementation branches.
2. Открыть backend PR в `main` после срезов 1–4 с optional contract и flag по умолчанию `false`.
3. На зафиксированном backend contract открыть stacked widget PR в `fix/widget-staging-response-contract` либо уже обновлённый `main`, выпустить immutable runtime artifact из точного commit SHA.
4. Открыть stacked landing PR в `codex/site-widget-v1.0.0-rc` либо уже обновлённый `main` с exact widget/Turbo artifacts и permanent-navigation smoke.
5. Развернуть три точных SHA на staging, выполнить срез 7 и приложить результат к issue `#13`.
6. Включить rich actions только на staging, повторить paired smoke и затем отдельно согласовать production enablement.
7. Реальные price records публиковать отдельным reviewed data commit после подтверждения amount, currency, unit, includes/excludes, installation и validity.

Rollback выполняется независимо: выключить backend flag возвращает text-only reply; landing может вернуть предыдущий exact widget artifact; catalog URLs и старый widget остаются совместимыми. Миграцию с deferrals не откатывать разрушительно — код может перестать её использовать, сохранив данные.

## Финальный критерий готовности

Работа завершена только когда диалог issue `#13` проходит последовательно без повторного вопроса, цены и actions подтверждены snapshot, widget остаётся тем же DOM node при успешном и неуспешном переходе, mobile возвращает тот же разговор, а результаты проверены на согласованных SHA всех трёх репозиториев. Зелёные unit tests одного backend без paired browser smoke не считаются завершением задачи.
