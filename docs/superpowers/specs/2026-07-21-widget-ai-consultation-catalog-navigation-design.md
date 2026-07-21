# Дизайн: живой AI-консультант, цены из каталога и постоянная навигация виджета

Дата: 2026-07-21

Статус: согласован владельцем, ожидает проверки перед implementation plan

Основной issue: GitHub `monaxovdulov/granit-operations#13`

Затронутые репозитории:

- `monaxovdulov/granit-operations` — AI runtime, каталог знаний, public API, persistence и history;
- `monaxovdulov/business-ai-web-widget` — browser widget, rich actions и navigation events;
- `monaxovdulov/landing-granit-static` — текущий customer-facing сайт, каталог и soft navigation.

## 1. Контекст

Staging AI уже сохраняет и отправляет проверенные ответы, но реальный клиентский диалог показал слабое поведение:

- клиенту задаются профессиональные вопросы, в которых он не обязан разбираться;
- ответы `не знаю` и `не определился` не меняют состояние разговора;
- незаполненный слот снова выбирается как следующий вопрос;
- app-owned renderer ведёт клиента по фиксированной очереди `тип -> материал -> размер -> город -> кладбище`;
- виджет обещает расчёт, хотя числовых published price records в текущем snapshot нет;
- AI может получить `frontend.url` из каталога, но public reply поддерживает только обычный текст;
- backend URL использует `section`/`entity`, а текущий `catalog.js` читает другие параметры и не умеет найти backend entity;
- текущий browser widget хранит public session id, open state и размер панели, но не восстанавливает rich message state;
- widget подключён не на всех страницах текущего лендинга, поэтому обычный переход на `catalog.html` уничтожает его DOM.

Пример провального сценария из issue `#13` включает несколько ответов `не знаю`, затем цикл вопроса о кладбище. Дизайн должен исправлять класс проблемы, а не одну фразу.

## 2. Цели

1. Сделать AI консультантом, который помогает неопытному клиенту выбрать исходный вариант, а не проводит жёсткую анкету.
2. Запоминать, что конкретный параметр пока неизвестен, и не повторять тот же вопрос.
3. Разрешить проверенные формулировки `от N ₽`, только когда в published catalog есть подходящая действующая price record.
4. Показывать в AI-сообщении безопасные ссылки на конкретную позицию или раздел каталога.
5. Выполнять настоящий soft navigation: при переходе сайт меняет страницу и URL, но тот же DOM-экземпляр виджета не размонтируется и не мигает.
6. Сохранить backward compatibility для старых browser widget clients.
7. Покрыть согласованный живой диалог, цены, ссылки и DOM persistence автоматическими регрессиями.

## 3. Не входит в scope

- назначение неподтверждённых цен или коммерческих условий;
- автоматическое открытие product modal поверх открытого чата;
- полный перенос статического сайта на SPA framework;
- использование HTML сайта или памяти модели как неявного источника бизнес-истины;
- изменение юридического смысла AI disclosure без отдельного owner/compliance решения;
- production rollout до paired staging smoke.

Disclosure не считается частью текста AI-ответа. Widget должен уметь дедуплицировать одну и ту же disclosure version и не повторять длинную системную приписку под каждым сообщением. Полное скрытие disclosure остаётся отдельным решением.

## 4. Выбранный подход

Используется Turbo Drive с постоянным widget host:

- статические HTML-страницы и их прямые URL сохраняются;
- на каждой customer-facing странице присутствует host с одинаковым уникальным `id` и `data-turbo-permanent`;
- widget монтируется внутрь host один раз;
- catalog navigation action из Shadow DOM создаёт composed custom event;
- landing bridge вызывает `Turbo.visit()`;
- Turbo меняет страницу и browser history, сохраняя permanent host и его дочерний widget;
- page-specific JavaScript работает через повторяемый lifecycle, а не только через `DOMContentLoaded`.

Собственный PJAX router отклонён из-за необходимости вручную реализовывать navigation history, cache, head/body reconciliation, focus, scroll и error handling. Полная SPA-миграция отклонена как несоразмерная текущей задаче.

Turbo поставляется как локально закреплённый и воспроизводимый asset, а не загружается с внешнего CDN во время работы сайта.

## 5. Клиентское поведение AI

### 5.1 Consult-first вместо анкеты

AI должен:

- задавать не больше одного вопроса за ход;
- спрашивать в первую очередь факты, которые клиент обычно знает;
- после фразы `я не разбираюсь` объяснять выбор простыми словами;
- предлагать обратимую базовую гипотезу вместо следующей профессиональной классификации;
- явно говорить, что исходный вариант можно изменить;
- после достаточного минимума либо дать проверенный ориентир и варианты, либо передать менеджеру содержательную заявку.

Текущая фиксированная очередь `monumentType -> material -> size -> city -> cemetery` перестаёт быть правилом поведения. Следующий вопрос выбирается из ещё полезных кандидатов после исключения known и deferred slots. Приоритет зависит от пользы для текущего ответа, вероятности того, что клиент знает ответ, и признаков раздражения/неуверенности в последних сообщениях. После двух deferrals подряд AI перестаёт перебирать характеристики и предлагает catalog choices или manager-assisted calculation.

Plan normalization может ограничить `action`, `intent` и допустимый requested slot, но не должен безусловно заменять уже проверенную живую реплику одной общей строкой. Если model question согласуется с финальным normalized plan и прошёл verifier, формулировка сохраняется. Если requested slot изменился или ответ противоречит состоянию разговора, app-owned renderer использует context-aware вариант, учитывающий recent messages и deferrals; один `calculationQuestion(slot)` для всех ситуаций не является допустимым финальным UX.

Пример направления:

```text
Клиент: Не знаю, у меня дед.
AI: Понял, памятник для дедушки. Для предварительного подбора возьмём
базовый вариант на одного человека, а форму и размер можно изменить позже.
В каком городе планируется установка?
```

### 5.2 Состояние `unknown_for_now`

Ответы наподобие `не знаю`, `не определился`, `пока не выбрал` не сохраняются как строковое значение слота.

Добавляется явная deferral-модель:

- `conversation_slot_deferrals` хранит `conversation_id`, `slot_name`, source message, evidence quote/offsets и timestamps;
- уникальная запись на пару `conversation_id + slot_name` означает `unknown_for_now`;
- turn input получает `deferredSlots` отдельно от `knownSlots`;
- grounded decision может вернуть `deferredSlotUpdates` только с точным visitor-message evidence;
- verifier проверяет evidence и связь с последним заданным вопросом;
- deterministic next-slot selection исключает deferred slots;
- при последующем подтверждённом slot value deferral удаляется автоматически;
- manager read model показывает `пока не определено`, не выдавая это за значение клиента.

Deferral действует до появления значения или manager correction. AI не должен самовольно возвращаться к deferred slot в этой же автоматической консультации.

### 5.3 Правила цены

Числовая цена разрешена только из published, действующей на момент хода price record.

Price record содержит как минимум:

```text
kind: price
priceType: from | fixed
amountMinor: positive integer
currency: RUB
unitLabel: string
appliesToRecordIds: stable catalog record ids
includes: reviewed string list
excludes: reviewed string list
installation: included | excluded | unspecified
validFrom / validUntil
provenance and owner approval
```

Правила рендера:

- `priceType=from` разрешает `от N ₽`;
- `priceType=fixed` разрешает назвать опубликованную каталожную цену, но не объявлять её финальной сметой заказа;
- `installation=included` разрешает сказать, что установка входит;
- `installation=excluded` разрешает сказать, что установка считается отдельно;
- `installation=unspecified` запрещает связывать названную сумму с установкой;
- при отсутствии числовой price record используется `цена по запросу`, без выдуманного диапазона;
- final quote и обязательные коммерческие условия по-прежнему подтверждает менеджер.

Текущий snapshot не содержит числовых published price records. До их появления production-like ответы не должны называть суммы; автоматические тесты цены используют reviewed fixtures.

## 6. Catalog suggestion и публичное действие

### 6.1 Выход модели

Grounded decision получает необязательное поле максимум из трёх элементов:

```json
{
  "catalogSuggestions": [
    { "recordId": "ent_...", "target": "item" },
    { "recordId": "ent_...", "target": "section" }
  ]
}
```

Модель не возвращает `href`, HTML, Markdown или финальную подпись ссылки.

Suggestion принимается, только если:

- record находится в `selectedRecords` того же хода;
- record published и действует на время хода;
- catalog version/revision совпадают со snapshot;
- для выбранного target существует валидная app-owned frontend destination;
- semantic verification завершилась pass;
- suggestion согласуется с финальным текстом и не был сделан нерелевантным plan normalization.

Если app-owned renderer заменил model reply, исходные model suggestions сбрасываются. Renderer может добавить только собственные детерминированные suggestions из того же verified snapshot.

### 6.2 Публичный contract

`site_widget.v1` расширяется необязательным backward-compatible полем `reply.actions`:

```json
{
  "type": "catalog_navigation",
  "target": "item",
  "label": "Посмотреть модель «Арфа»",
  "href": "/catalog.html?section=pamyatniki&entity=ent_...#catalog-list",
  "catalog_version": "granit-cha.catalog....",
  "record_id": "ent_..."
}
```

Ограничения:

- максимум три actions;
- `target` только `item | section`;
- label строится приложением и ограничивается по длине;
- href только относительный same-origin path;
- разрешены только `/catalog.html`, allowlisted query keys и allowlisted fragment;
- external origin, protocol-relative URL, JavaScript URL, encoded path escape и неизвестные параметры отклоняются;
- старый client продолжает использовать `reply.text` и игнорирует optional `actions`.

Actions сохраняются в outbound `conversation_messages.metadata.public_actions`. Idempotency replay возвращает ранее сохранённые actions, а не пересобирает их по новой версии каталога.

History response добавляет optional `actions` к каждому публичному сообщению. В history попадают только public action fields; verifier/internal provenance остаются серверными.

## 7. Единая идентичность каталога

Runtime-сопоставление по названию, артикулу или позиции в массиве запрещено.

Канонический reviewed catalog source должен генерировать оба артефакта:

- backend AI snapshot;
- frontend `catalog-data.json` или детерминированный mapping artifact для него.

Каждый frontend item получает `catalog_entity_id`, совпадающий с backend `record.id`. Category получает стабильный `sectionSlug`.

Канонические URL:

```text
section: /catalog.html?section=<sectionSlug>#catalog-list
item:    /catalog.html?section=<sectionSlug>&entity=<catalogEntityId>#catalog-list
```

`catalog.js`:

1. читает `section` и находит категорию по slug;
2. читает `entity` и находит item по `catalog_entity_id`;
3. применяет раздел/подраздел;
4. увеличивает visible count, если item находился за текущей пагинацией;
5. рендерит, прокручивает и фокусирует карточку;
6. добавляет краткую выбранную подсветку и доступное status announcement;
7. не открывает product modal автоматически;
8. при ручной смене фильтров очищает устаревший `entity` из URL.

Если entity больше не published или отсутствует во frontend artifact, каталог открывает section и сообщает, что показаны актуальные варианты.

## 8. Browser widget

Widget message model поддерживает отдельный массив actions. Текст продолжает выводиться как текст через Lit binding; raw HTML не интерпретируется.

Catalog action рендерится как доступная ссылка/команда с понятной подписью. При активации:

1. widget создаёт `navigationId`;
2. предотвращает обычную anchor navigation;
3. отправляет bubbling, composed, cancelable event `site-widget:catalog-navigate`;
4. event detail содержит только проверенные public action fields и `navigationId`;
5. landing bridge принимает событие, сигнализирует обработку и вызывает Turbo;
6. landing возвращает success/error event с тем же `navigationId`;
7. при ошибке widget оставляет текущую страницу и показывает возле action `Не удалось открыть каталог. Повторить`.

На Granit landing hard-navigation fallback для catalog action не используется, потому что он разрушил бы согласованное persistent-widget поведение.

Widget loader должен быть идемпотентным и не монтировать второй custom element, если permanent host уже содержит активный widget.

При прямом открытии страницы или настоящем browser reload widget использует существующий public history endpoint:

- `404` очищает stale public session id и начинает новую сессию;
- временная network error не уничтожает существующий session id;
- восстановление возвращает text и actions;
- intro/disclosure не дублируются поверх восстановленной истории.

## 9. Landing soft navigation

На всех поддерживаемых страницах расположен один и тот же host:

```html
<div id="granit-site-widget-host" data-turbo-permanent></div>
```

Widget host находится вне заменяемого page content. Версия widget runtime и Turbo закреплены локальными manifest/checksum artifacts.

Landing navigation bridge:

- обрабатывает `site-widget:catalog-navigate` через `Turbo.visit()`;
- поддерживает browser Back/Forward без размонтирования host;
- может использовать тот же механизм для eligible same-origin HTML navigation, чтобы помощник оставался постоянным по сайту;
- не перехватывает external links, downloads, `tel:`, `mailto:`, new-tab intent и modifier-click;
- сохраняет обычное поведение hash-only links внутри текущей страницы.

Turbo используется для явно выбранных page visits и не получает неявного владения существующими form submissions. Формы сайта помечаются `data-turbo="false"` либо Drive отключается глобально с программными `Turbo.visit()` через bridge. Текущие form handlers и public intake semantics не меняются этой задачей.

Page scripts становятся lifecycle-aware:

- общая инициализация после initial load и каждого `turbo:load`;
- timers, observers, modal state и page-bound listeners очищаются до cache/render;
- catalog, form, lazy-loading и slider controllers идемпотентны;
- повторный Back/Forward не создаёт дублированных обработчиков.

При Turbo fetch/parse/render error автоматический full reload не выполняется. Текущая страница и widget остаются интактны, action получает retry state.

## 10. Responsive UX

### Desktop

- normal/wide widget остаётся открытым;
- catalog layout получает безопасную правую область или эквивалентный responsive reflow;
- target card не должен оказаться под panel;
- fullscreen panel сворачивается перед переходом, иначе каталог визуально недоступен.

### Mobile

- перед Turbo visit panel сворачивается, но custom element не удаляется;
- остаётся компактная стабильная кнопка `Вернуться в диалог` с message icon;
- draft, message list, public session id, pending request и scroll state сохраняются;
- повторное открытие показывает тот же диалог без повторного API history fetch;
- focus после перехода попадает на section heading или target card;
- widget launcher, selected card и browser controls не перекрывают друг друга.

## 11. Ошибки и безопасность

| Ситуация | Поведение |
|---|---|
| Нет published price | Не называть сумму; `цена по запросу` или manager handoff |
| Price не подтверждает installation | Не утверждать, что установка входит или не входит |
| Suggestion указывает невыбранную/неpublished record | Отбросить action до public response |
| Некорректный или внешний href | Отбросить action и записать quality event |
| Turbo navigation failed | Остаться на текущей странице, сохранить widget, показать retry |
| Entity отсутствует во frontend artifact | Открыть section и показать актуальные варианты |
| History временно недоступна после hard reload | Не очищать session id; показать безопасный retry/fallback |
| Клиент позже назвал deferred value | Сохранить value и удалить slot deferral |

Public action metadata проходит отдельную allowlist sanitization. Она не смешивается с model metadata или manager-only evidence.

## 12. География как обязательная бизнес-истина

Текущий approved business fact подтверждает работу только по Москве и Московской области. Поэтому с текущими данными AI не имеет права продолжать расчёт для Минска так, будто установка там доступна.

До публикации отдельной reviewed service-area record ожидаемый ответ после `Минск` должен честно сообщить, что доступные данные не подтверждают работу в этом регионе, и предложить manager confirmation. Если владелец подтверждает Минск, сначала обновляется published catalog knowledge, затем меняется ожидаемый eval.

## 13. Проверка

### Backend и contracts

- published, draft, retired и expired catalog records;
- valid/invalid item и section destinations;
- same-origin allowlist и malicious URL cases;
- максимум три actions и backward-compatible response parsing;
- persistence/history/idempotency replay сохраняют те же actions;
- `from`, `fixed`, отсутствующая цена и все installation states;
- model suggestion сбрасывается после нерелевантной plan normalization;
- `unknown_for_now` создаётся по evidence, исключает повторный вопрос и снимается новым value.

### AI regression corpus

Добавляется multi-turn сценарий из issue `#13`:

- `я не разбираюсь` вызывает помощь и базовую гипотезу, а не новый термин;
- `не определился` по кладбищу создаёт deferral;
- следующий ход не запрашивает cemetery;
- фрагмент `с кладбищем` корректно связывается с предыдущим сообщением;
- повторное `не определился` не создаёт цикл;
- при published price fixture ответ использует точное `от N ₽` и правильный состав;
- при отсутствии price fixture числовая цена запрещена;
- item/section action соответствует selected published record;
- текущий production-like service-area fixture не утверждает обслуживание Минска.

Eval runner должен исполнять ходы последовательно и переносить slot values/deferrals между ходами. Набора независимых single-turn prompts для этой регрессии недостаточно.

### Widget

- action response mapping и history hydration;
- безопасный Lit render без raw HTML;
- composed navigation event из Shadow DOM;
- loading/success/error/retry action states;
- loader idempotency;
- mobile minimize сохраняет draft/messages/pending request.

### Landing browser tests

Playwright desktop и mobile проверяет:

- клик item/section action меняет URL и page content;
- DOM identity widget element до и после visit одинакова;
- `disconnectedCallback` не вызывается;
- pending request не abortится;
- messages, draft, open/minimized state и scroll position сохраняются;
- target item дорендерен, видим, сфокусирован и выделен;
- Back/Forward сохраняет тот же widget;
- mobile показывает `Вернуться в диалог` без перекрытия карточки;
- desktop safe area не прячет target card;
- navigation failure не вызывает hard reload.

### Paired staging smoke

Финальный smoke использует одновременно:

- staging API `granit-operations`;
- закреплённую сборку `business-ai-web-widget`;
- активный `landing-granit-static`;
- настоящий published catalog snapshot и его frontend mapping;
- фактический item и section переход;
- проверку persisted outbound metadata/history;
- проверку manager-visible диалога и обычных send gates.

## 14. Rollout и rollback

Порядок поставки:

1. canonical identity/price schema и backend optional contracts;
2. backend persistence/history и AI/eval changes;
3. новая версия browser widget с actions/events/hydration;
4. landing Turbo host, bridge и catalog deep links;
5. paired staging smoke;
6. включение rich actions после подтверждённого smoke;
7. публикация числовых price records только после owner review.

`AI_WIDGET_RICH_ACTIONS_ENABLED` по умолчанию выключен до шага 5. При rollback backend продолжает возвращать обычный text reply, а старый widget остаётся совместимым. Price claim availability определяется published price records и не включается отдельной модельной догадкой.

## 15. Acceptance criteria

1. В согласованном диалоге AI не повторяет cemetery после `не определился`.
2. AI предлагает понятный базовый вариант после `я не разбираюсь`.
3. Любая числовая цена полностью подтверждена действующей price record и корректно описывает installation scope.
4. Любая catalog action разрешена приложением из published record; модель не управляет href.
5. Item action открывает точную frontend card, section action — точный раздел.
6. При soft navigation widget DOM identity, состояние и выполняющийся запрос сохраняются.
7. Mobile transition оставляет компактный возврат к тому же диалогу.
8. History и idempotency replay возвращают исходные actions.
9. Failure cases не вызывают скрытый hard reload и не теряют диалог.
10. Backend, widget, landing browser tests и paired staging smoke проходят на согласованных версиях трёх репозиториев.
