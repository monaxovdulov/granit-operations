# Task: Telegram outbound delivery sender path

Status: accepted after controlled staging smoke for manual manager-reply sender; not production approval
Repo: `granit-operations`
Slice: Telegram delivery sender after inbound + manager mini-panel
Owner/agent: Codex

Acceleration assumption, 2026-05-21: requester stated that there are currently no real clients and no real managers depending on this Telegram path. Controlled staging Bot API smoke used test/private Telegram accounts and fake staging rows, while keeping production, worker/scheduler, notification sender and Telegram AI outbound blocked.

## Status Clarification 2026-05-21

- Local sender implementation evidence is reviewed.
- Controlled staging smoke for the manual `npm run deliver:telegram:once` path passed and is recorded in `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`.
- Acceptance is limited to manager-authored replies already persisted in `message_deliveries`; it is not approval for Telegram AI outbound or an automated production worker.
- The next separate task is `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`.

## Коротко Для Человека

Что это: отдельный отправщик, который берет уже сохраненный ответ менеджера и доставляет его клиенту в Telegram.

Зачем: чтобы webhook не отправлял сообщения напрямую и чтобы каждая отправка была видна в Postgres: статус, попытки, ошибка или внешний Telegram `message_id`.

Где руками смотреть: manager UI badge у исходящего сообщения, таблица `message_deliveries`, timeline события `conversation.delivery_*`.

Чего это не делает: не включает Telegram AI outbound, не запускает production worker и не отправляет уведомления менеджерам.

## Цель

Сделать минимальный безопасный путь, в котором уже созданные `message_deliveries.status='pending'` для Telegram-ответов менеджера можно отправить через Telegram Bot API только из отдельного sender-а, с записью попыток, ошибок, внешнего message id и manager-visible delivery status.

## Scope

- Отдельный `TelegramMessageDeliveryService` для обработки `pending/retrying` доставок.
- `TelegramBotApiDeliveryProvider`, который формирует `sendMessage` payload из сохраненной delivery row: `chat_id` клиента и текст сохраненного исходящего сообщения.
- `PostgresTelegramDeliveryRepository`, который:
  - забирает delivery rows через `FOR UPDATE SKIP LOCKED`;
  - помечает взятые rows как `retrying` на время попытки;
  - пишет `sent`, `retrying`, `failed` или `blocked_no_destination`;
  - сохраняет внешний Telegram `message_id`;
  - пишет timeline events для доставки.
- Ручной локальный entrypoint `npm run deliver:telegram:once`; автозапуск worker/scheduler не добавлялся.
- Manager read model и веб-панель показывают delivery status у исходящих сообщений.
- Тесты на success payload, retryable failure, exhausted retry budget и blocked destination.
- Safe hardening после review: sender lock ограничен `message_deliveries`, Drizzle schema выровнена с partial indexes/FK из миграций, viewer Telegram text reply блокируется, UI tooltip показывает внешний Telegram message id.
- Safe sender audit follow-up: manager binding/actions are private-chat only and actor lookup also checks Telegram `external_user_id`.

## Out Of Scope

- Production/deploy/secrets changes.
- Автозапущенный production worker/scheduler.
- Telegram AI outbound.
- Отправщик `manager_notification_outbox`.
- Автозапущенный worker/scheduler и его отдельный staging smoke; manual sender smoke уже записан в evidence.
- Backup/restore/rollback и production approval.

## Files Touched

- `apps/api/src/services/telegram-delivery-service.ts`
- `apps/api/src/repositories/telegram-delivery-repository.ts`
- `apps/api/src/scripts/deliver-telegram-pending-once.ts`
- `apps/api/src/services/telegram-bot-service.ts`
- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `apps/api/test/telegram-delivery-service.test.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/manager/src/App.tsx`
- `apps/manager/src/types.ts`
- `packages/db/src/schema.ts`
- `package.json`
- `docs/ENVIRONMENT.md`
- `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_TRANSFORM_GIST_RU.md`

## Checks Run

- `npm run typecheck`
- `npm test -- apps/api/test/telegram-delivery-service.test.ts`
- Full post-change checks are recorded in the evidence doc.

## Blockers

- Telegram AI outbound remains blocked by `TelegramOutboundBlockedError`.
- Production remains blocked until operational worker/scheduler decision/proof, notification outbox sender, backup/restore/rollback, G01-G17 and explicit owner sign-off; manual staging delivery smoke is not production approval.

## Evidence

- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- Local smoke/staging prep checklist: `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`
- Следующий task pack: `docs/tasks/TELEGRAM_SAFE_SENDER_NEXT_TASK_PACK_RU.md`
- Следующий worker task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
