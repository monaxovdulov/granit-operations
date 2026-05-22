# Task: Telegram inbound + manager mini-panel

Status: reviewed locally; prep accepted for staging acceleration; not production approval
Repo: `granit-operations`
Slice: Telegram adapter after P0 channel-neutral foundation
Owner/agent: Codex

Acceleration assumption, 2026-05-21: requester stated that there are currently no real clients and no real managers depending on this Telegram path. Controlled staging smoke can move faster with test bot/private chats and fake staging rows; this does not approve production or Telegram AI outbound.

## Status Clarification 2026-05-21

- Local implementation checks are reviewed and accepted as prep for accelerated controlled staging verification.
- Follow-up sender evidence confirms the webhook stays free of direct `sendMessage`, `forwardMessage` and `copyMessage`, and manager binding/actions are private-chat only.
- This status depends on the merged P0 channel-neutral foundation and supports follow-up Telegram delivery slices.
- This is not production approval and does not approve Telegram AI outbound, notification sender or production worker/scheduler.

## Коротко Для Человека

Что это: Telegram как входной канал и маленький пульт менеджера поверх общей панели.

Зачем: клиент пишет в Telegram, а система сохраняет это как обычную заявку/диалог в Postgres. Менеджер может привязать свой Telegram, взять диалог и подготовить ответ.

Где руками смотреть: `POST /telegram/webhook`, manager binding в `/manager/me`, диалог в manager UI, таблицы `channel_identities`, `conversations`, `conversation_messages`.

Чего это не делает: webhook не отправляет клиенту сообщения напрямую, Telegram не становится отдельной CRM, AI в Telegram не отвечает.

## Цель

Добавить Telegram как тонкий channel adapter поверх общего `lead` / `conversation` / `conversation_messages` контура и дать менеджеру минимальный Telegram UI: привязка личного чата, уведомления `needs_manager`, takeover и ответ клиенту только после takeover.

## Scope

- Disabled-by-default webhook `POST /telegram/webhook`.
- Secret validation through `x-telegram-bot-api-secret-token`.
- Customer Telegram updates normalize into `acceptInboundMessage`.
- Manager `/start <token>` binds Telegram chat to authenticated manager token from web panel.
- `Взять диалог` and `Ответить` callback actions reuse common takeover and pending reply context.
- Manager text reply after context creates outbound `conversation_messages.sender_role='manager'` and pending `message_deliveries` row.
- Manager notifications are queued in `manager_notification_outbox`; webhook does not call Telegram provider send methods.
- Manager binding/actions are limited to private Telegram chats; non-private updates are ignored.

## Out Of Scope

- Telegram delivery worker/sender.
- Telegram AI outbound.
- Production enablement.
- Assignment/routing beyond active owner/manager Telegram bindings.

## Files Touched

- `packages/db/migrations/0007_telegram_manager_mini_panel.sql`
- `packages/db/src/schema.ts`
- `apps/api/src/config.ts`
- `apps/api/src/app.ts`
- `apps/api/src/index.ts`
- `apps/api/src/routes/telegram.ts`
- `apps/api/src/routes/manager-auth.ts`
- `apps/api/src/services/telegram-bot-service.ts`
- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/manager-auth.test.ts`
- `apps/manager/src/*`
- `docs/ENVIRONMENT.md`
- `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`

## Checks Run

- `npm run typecheck`
- `npm run smoke:api`
- `npm test`
- `npm run build`

## Evidence Links

- Implementation evidence: `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- Safe sender audit/staging follow-up: `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`
- P0 foundation evidence: `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`

## Blockers

- Production stays blocked until worker/scheduler decision, notification sender scope, backup/restore/rollback, G01-G17, and explicit owner sign-off; manual staging delivery smoke is not production approval.
- Telegram AI outbound remains blocked.
- Следующий task pack: `docs/tasks/TELEGRAM_SAFE_SENDER_NEXT_TASK_PACK_RU.md`
