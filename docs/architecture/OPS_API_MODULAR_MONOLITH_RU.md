# Ops API Modular Monolith

Дата: 2026-05-23
Статус: implemented locally, not deployed

## Короткая карта

`ops-api` остается одним backend service и продолжает работать с одним Postgres source of truth. Изменение только в кодовой организации: HTTP routes, use-cases, repositories, provider adapters и timeline helpers теперь разложены по доменным модулям внутри `apps/api/src/modules`.

Бизнес-смысл: новые работы вокруг notification sender, AI handoff, production readiness и будущих каналов должны иметь понятную точку входа и не должны случайно задеть доставку менеджерских Telegram-ответов, takeover, timeline evidence или запрет Telegram AI outbound.

## Было

Код `ops-api` был сгруппирован по техническим папкам:

- `routes`;
- `services`;
- `repositories`;
- `auth`.

Это работало, но границы были неочевидны: Telegram webhook, Telegram delivery, manager actions, widget AI и timeline events жили рядом как технические файлы. Агенту или разработчику было проще случайно связать inbound webhook с outbound delivery или добавить новое timeline-событие вручную в одном месте, забыв про второе.

## Стало

Основные границы теперь видны по дереву:

```text
apps/api/src/modules/
  ai/                 # website widget AI provider and reply generation
  auth/               # manager auth, sessions, Yandex ID, auth routes
  conversations/      # conversation repository port and Postgres implementation
  delivery/           # Telegram message_deliveries sender, worker, advisory lock
  intake/             # public site form/widget intake routes and use-cases
  manager/            # manager-facing lead and Telegram binding use-cases/routes
  telegram/inbound/   # Telegram webhook update handling only
  timeline/           # owner-readable event names and metadata builders
```

`apps/api/src/app-context.ts` собирает runtime dependencies в одном месте. `apps/api/src/app.ts` по-прежнему создает один Fastify app, но routes получают use-case объекты, а не ходят напрямую в DB implementation.

Старые пути `apps/api/src/routes/*`, `services/*`, `repositories/*`, `auth/*` оставлены как compatibility exports. Это снижает риск для тестов, скриптов и будущих небольших PR, но новый код должен идти через `modules/*`.

## Важные границы

- `telegram/inbound` отвечает за webhook, команды `/start` и `/cancel`, manager binding, callback actions и сохранение входящих Telegram-сообщений.
- `delivery` отвечает за `message_deliveries`, Telegram `sendMessage`, retry/failed/uncertain states и worker/scheduler path.
- Inbound module не импортирует delivery module и не содержит provider `sendMessage`.
- Delivery module не импортирует webhook/inbound module.
- `timeline` централизует имена событий и metadata builders для delivery, takeover, manual contact, manager queued reply и future `conversation.delivery_uncertain_resolution`.

## Что не менялось

- Runtime topology: один `ops-api` process.
- DB schema и migrations.
- Public API endpoints и response contracts.
- Env names.
- npm scripts и systemd/runbook topology.
- Telegram AI outbound policy: AI-authored Telegram outbound остается blocked.
- `manager_notification_outbox` sender не реализован в этом refactor.

## Проверочный смысл

Добавлен focused boundary test `apps/api/test/modular-boundaries.test.ts`. Он не проверяет бизнес-сценарий сам по себе, а защищает архитектурное правило: webhook не должен получить прямой Telegram provider send path, delivery не должен зависеть от webhook, timeline delivery uncertainty должен идти через централизованные helpers.
