# Evidence: Telegram inbound + manager mini-panel

Date: 2026-05-20
Repo: `granit-operations`
Status: local implementation evidence, not production approval

Acceleration assumption, 2026-05-21: requester stated that there are currently no real clients and no real managers depending on this Telegram path. Controlled staging smoke can move faster with test bot/private chats and fake staging rows. This is still not production approval.

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

## Remaining Blockers

- Production worker/scheduler decision for delivery sender.
- Sender for `manager_notification_outbox`.
- Staging webhook/sender smoke with real Telegram delivery evidence; under the no-real-clients/no-real-managers assumption this can be the next accelerated controlled test.
- Backup/restore/rollback evidence.
- Production G01-G17 and explicit owner sign-off.
