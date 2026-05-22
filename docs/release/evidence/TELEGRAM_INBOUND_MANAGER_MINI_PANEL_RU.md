# Evidence: Telegram inbound + manager mini-panel

Date: 2026-05-20
Repo: `granit-operations`
Status: reviewed locally; prep accepted for staging acceleration; not production approval

Acceleration assumption, 2026-05-21: requester stated that there are currently no real clients and no real managers depending on this Telegram path. Controlled staging smoke can move faster with test bot/private chats and fake staging rows. This is still not production approval.

## Status Clarification 2026-05-21

- This evidence is accepted as local Telegram inbound + manager mini-panel prep on top of the merged P0 foundation.
- Follow-up sender evidence records controlled staging Bot API smoke for manager-authored delivery, but this inbound evidence itself remains prep evidence, not production approval.
- Telegram AI outbound, notification sender, production worker/scheduler, backup/restore/rollback and production gates remain blocked.

## What Was Verified

- Webhook is disabled by default.
- Enabled webhook rejects invalid `x-telegram-bot-api-secret-token`.
- Web panel can create a one-time manager Telegram bind token.
- `/start <token>` binds manager private Telegram chat as app-owned state.
- Non-private Telegram chats cannot consume manager bind tokens or enter manager action flow.
- Customer Telegram inbound persists through `acceptInboundMessage`, becomes manager-visible, and queues manager notification outbox after binding.
- Duplicate Telegram update replay does not duplicate lead/message state.
- `Ответить` is blocked before takeover.
- `Взять диалог` uses common takeover state.
- Manager reply after takeover creates outbound manager message plus pending delivery state.
- Bound `viewer` role cannot send Telegram text replies.
- Webhook source contains no direct Telegram provider send methods.

## Commands

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run smoke:api` | passed, 36 API smoke tests |
| `npm test` | passed, 47 tests |
| `npm run build` | passed, manager Vite build completed |

## Safety Notes

- `TELEGRAM_BOT_ENABLED` defaults to off.
- Telegram AI outbound remains blocked by `TelegramOutboundBlockedError`.
- Customer-visible manager replies are only persisted with pending `message_deliveries`; no provider call is made in the webhook.
- Manager-visible Telegram notifications are outbox rows; no provider call is made in the webhook.
- Safe sender audit follow-up: `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`.

## Evidence Links

- Task: `docs/tasks/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- P0 foundation evidence: `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
- Safe sender audit/staging follow-up: `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`

## Remaining Blockers

- Production worker/scheduler decision for delivery sender.
- Sender for `manager_notification_outbox`.
- Manual staging sender smoke is recorded in `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`; automated worker/scheduler evidence is still separate.
- Backup/restore/rollback evidence.
- Production G01-G17 and explicit owner sign-off.
