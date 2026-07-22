# Дизайн: единый conversation scope между страницами website widget

Дата: 2026-07-22

Статус: одобрено владельцем для реализации и staging-only проверки

Связанный issue: `granit-operations#19`

## Проблема

Главная страница preview landing использует `widgetInstanceId=landing-main`, а каталог —
`widgetInstanceId=landing-catalog`. Текущий session store включает этот идентификатор в ключ
`sw:<widgetInstanceId>:public_session_id`. Поэтому переход по grounded catalog action меняет
namespace сессии, хотя обе страницы принадлежат одному customer journey и одному origin.

Backend history и conversation state при этом корректны. Ошибка находится в выборе browser
session identity: catalog widget не читает public session, созданную на главной странице.

## Цель

Сохранить один `public_session_id`, transcript, authoritative timestamps, delivery markers и
`manager_pending` / `manager_active` state при переходах main → catalog → main и reload любой
страницы, не смешивая уже существующие backend conversations.

Production deploy не входит в scope. Исправление сначала проходит source tests, landing smoke и
staging verification.

## Выбранная модель

Отделить identity UI-инстанса от identity разговора:

- `widgetInstanceId` продолжает идентифицировать конкретный mount и остаётся источником
  `source.widget_instance_id` в public request;
- новый `conversationScopeId` определяет namespace только для `public_session_id`;
- новый `legacyConversationScopeIds` задаёт упорядоченные предыдущие namespace для одноразового
  безопасного восстановления canonical session;
- open state и panel size по-прежнему хранятся по `widgetInstanceId` и не объединяются между
  страницами.

Core widget не содержит названий конкретных страниц, landing-проектов или CMS. Все scope IDs
передаются через обычную программную, element-attribute или loader-data конфигурацию.

## Конфигурация текущего landing

| Страница | `widgetInstanceId` | `conversationScopeId` | `legacyConversationScopeIds` |
|---|---|---|---|
| `/` | `landing-main` | `landing-customer` | `landing-main`, `landing-catalog` |
| `/catalog.html` | `landing-catalog` | `landing-customer` | `landing-main`, `landing-catalog` |

Одинаковый порядок legacy scopes на всех страницах является частью контракта и проверяется
static smoke.

## Алгоритм session store

`createSessionStore` получает отдельные параметры UI scope и conversation scope. Все значения
нормализуются как непустые строки; пустой conversation scope откатывается к `widgetInstanceId`
для обратной совместимости.

При `getPublicSessionId()`:

1. Прочитать canonical key `sw:<conversationScopeId>:public_session_id`.
2. Если canonical value является валидным backend UUID, зафиксировать migration marker и вернуть
   UUID. Legacy keys не влияют на результат.
3. Если canonical value отсутствует или невалидно, но migration marker уже установлен, вернуть
   пустую строку и не обращаться к legacy scopes.
4. Иначе проверить legacy scopes строго в переданном порядке.
5. Первый валидный UUID записать в canonical key, установить migration marker и вернуть UUID.
6. Если валидных значений нет, вернуть пустую строку без marker: это позволяет более поздней
   legacy session мигрировать после временного rollback на старый runtime.

Marker хранится под versioned key `sw:<conversationScopeId>:legacy_session_migration_v1` со
значением `complete`. Версия в имени позволяет будущей независимой миграции не переиспользовать
старую семантику.

`setPublicSessionId()` записывает canonical key и migration marker. `clearPublicSessionId()`
удаляет canonical key, но оставляет marker, поэтому явная очистка не может воскресить старую
legacy session. Legacy keys не удаляются и не переписываются: это сохраняет безопасный rollback
и исключает необратимую потерю истории.

Если `landing-main` и `landing-catalog` содержат разные валидные sessions, canonical key
отсутствует, а список aliases задан как выше, детерминированно выбирается `landing-main`.
Разговоры не объединяются, backend messages не копируются, проигравший legacy key остаётся на
месте. После создания canonical key он имеет безусловный приоритет на обеих страницах.

Duplicate aliases, canonical scope в legacy-массиве и пустые значения удаляются при
нормализации с сохранением первого порядка.

## Public configuration contract

Новые настройки добавляются во все поддерживаемые входы:

- TypeScript `SiteWidgetConfig` / `MountSiteWidgetOptions`;
- Web Component attributes;
- loader `data-*` attributes;
- JSON config parsing и generated declarations.

`legacyConversationScopeIds` является массивом в программной/JSON конфигурации и разделённой
запятыми строкой в HTML/loader attributes. Точные HTML attributes:
`conversation-scope-id` и `legacy-conversation-scope-ids`; loader использует соответственно
`data-conversation-scope-id` и `data-legacy-conversation-scope-ids`. Scope IDs используются
только как локальные namespace и не выдаются как public session identifiers.

Существующие consumers без новых полей сохраняют прежнее поведение: conversation scope равен
`widgetInstanceId`, миграция не выполняется.

## Компонент и изменение конфигурации

Widget создаёт session store из `widgetInstanceId`, storage mode, `conversationScopeId` и legacy
scopes при boot. Изменение любого из этих session-boundary полей инвалидирует активный polling,
пересоздаёт store и загружает session нового canonical scope. Transport contract и backend
request schema не меняются.

`source.widget_instance_id` остаётся page-specific. Backend получает прежнюю observability
информацию о месте mount, но `public_session_id` продолжает один conversation.

## Версионирование и доставка

Source widget получает следующий patch release после `1.1.2`. Его owning repository выполняет
полный check/test/build/browser/package verification и собирает content-addressed runtime из
точного source commit.

Landing vendor-ит только проверенные `loader.js`, `site-widget.esm.js` и manifest под полным
source commit, затем переключает обе страницы на этот immutable path. Предыдущий runtime и
legacy keys сохраняются как rollback.

Dirty checkout `business-ai-web-widget/main` с чужими staged removals не используется. Работа
ведётся в существующем чистом worktree ветки `agent/widget-issues-14-17`, который содержит
актуальный source runtime `1.1.2`. Landing меняется в соответствующем чистом worktree той же
ветки, откуда уже выполняется staging-only deploy.

## Regression coverage

### Source widget

- отсутствие новых настроек сохраняет key по `widgetInstanceId`;
- canonical session побеждает любые legacy sessions;
- main-only и catalog-only legacy session мигрируют в canonical key;
- конфликт двух legacy UUID всегда выбирает первый alias и не удаляет второй;
- invalid UUID не мигрирует и не блокирует следующий валидный alias;
- `set` / `clear` изменяют только canonical key и marker, явный clear не воскрешает legacy session;
- отсутствие canonical и legacy sessions не ставит marker и допускает будущую rollback migration;
- open state и panel size остаются page-specific;
- loader, element attributes и programmatic config дают одинаковую нормализованную конфигурацию;
- runtime change conversation scope считается session-boundary change;
- существующие request, history polling и manager-state tests остаются зелёными.

### Landing static smoke

- на main и catalog установлен один и тот же `conversationScopeId`;
- обе страницы имеют один и тот же ordered legacy alias list;
- `widgetInstanceId` остаётся разным и ожидаемым;
- loader и ESM берутся из одного exact content-addressed source commit;
- manifest и SHA-256 runtime файлов совпадают.

### Landing browser smoke

Browser harness выполняет реальную навигацию:

1. Открывает main, отправляет сообщение и получает persisted history с catalog action.
2. Проверяет canonical session key, transcript, timestamps и delivery markers.
3. Переходит по action на точную catalog card.
4. Открывает widget и проверяет тот же session ID/history и terminal conversation state.
5. Перезагружает catalog и проверяет отсутствие нового POST/AI job.
6. Возвращается на main и повторно проверяет тот же transcript.

Отдельные browser cases покрывают main-only migration, catalog-only migration и conflict policy.
Все API calls перехватываются deterministic fixture; неожиданные внешние запросы блокируются.

## Staging verification

После успешных локальных проверок landing branch разворачивается только на
`https://preview.granitkr.ru`. Read-only/browser smoke подтверждает main → exact catalog card →
main, reload обеих страниц, один `public_session_id`, один transcript и сохранение manager state.

Staging evidence фиксирует exact source/landing commits, CI результаты, sanitized session
observations и rollback runtime. Production остаётся без изменений до отдельного явного
подтверждения.

## Ошибки и rollback

- Недоступный `localStorage` сохраняет существующий memory fallback; cross-page continuity в
  таком browser режиме не обещается.
- Невалидный canonical key удаляется по существующей безопасной политике. Legacy recovery после
  этого возможен только до установленного marker; после явного canonical выбора или clear старые
  keys больше не могут воскресить разговор.
- Ошибка history fetch не создаёт новую session и не повторяет POST; UI использует существующий
  bounded polling/error flow.
- Frontend rollback выполняется возвратом предыдущего content-addressed runtime. Поскольку legacy
  keys не удалены, предыдущая версия может продолжить свою прежнюю page-specific session.

## Вне scope

- изменение backend contract, database schema или AI runtime;
- объединение, перенос или удаление backend conversations;
- origin-wide неявный глобальный session key;
- production deploy;
- несвязанный рефакторинг виджета или лендинга.
