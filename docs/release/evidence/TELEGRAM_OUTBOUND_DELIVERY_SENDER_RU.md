# Evidence: Telegram outbound delivery sender path

Date: 2026-05-21
Repo: `granit-operations`
Status: local implementation evidence, not staging smoke and not production approval

Acceleration assumption, 2026-05-21: requester stated that there are currently no real clients and no real managers depending on this Telegram path. This lowers staging smoke blast radius and makes controlled Bot API smoke the preferred next step. It does not approve production, worker/scheduler, notification sender or Telegram AI outbound.

## What Was Verified

- Webhook path still does not call Telegram provider send methods.
- Manager Telegram reply remains persisted first as `conversation_messages.sender_role='manager'` plus `message_deliveries.status='pending'`.
- Delivery sender is separate from webhook: it claims `pending/retrying` Telegram deliveries and only then calls Telegram Bot API `sendMessage`.
- Sender transforms stored state into payload `{ chat_id, text }`, using the customer Telegram chat id from `channel_identities` and the saved outbound message body from Postgres.
- Successful send records:
  - `message_deliveries.status='sent'`;
  - incremented `attempt_count`;
  - external Telegram `provider_message_id`;
  - `conversation_messages.provider_message_id/provider_sent_at`;
  - timeline event `conversation.delivery_sent`.
- Retryable provider errors record `retrying` until `maxAttempts` is reached, then `failed`.
- Missing customer destination records `blocked_no_destination` without calling the provider.
- Manager read model and manager UI expose delivery status, attempts, last error and provider message id for outbound messages.
- Sender claim uses `FOR UPDATE OF message_deliveries SKIP LOCKED` so the sender coordinates on the delivery row, not the webhook.
- Drizzle schema now mirrors Telegram partial indexes/FK from migrations for active manager bindings, pending reply contexts and manager notification binding reference.
- Bound manager users with role `viewer` are blocked from Telegram text replies, even if a stale reply context exists.
- Manager binding/actions are private-chat only, and actor lookup requires matching Telegram `external_user_id`.
- Telegram AI outbound remains blocked; this slice only proves manager-authored Telegram reply delivery.

## Commands

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts` | passed, 4 tests |
| `npm test -- apps/api/test/manager-auth.test.ts` | passed, 7 tests |
| `npm run smoke:api` | passed, 36 API smoke tests |
| `npm test` | passed, 47 tests |
| `npm run build` | passed, manager Vite build completed |
| `git diff --check` in `granit-operations` | passed |
| `git diff --check` in `granit-plan-app` | passed |
| `node docs/task-board/scripts/build-task-board.mjs` in `granit-plan-app` | passed |

## Local Evidence

- New service test covers success payload, retryable failure, exhausted retry budget and blocked destination.
- Existing Telegram mini-panel smoke test now expects pending delivery status to be manager-visible after a manager reply is queued.
- Existing Telegram webhook/manager smoke now covers blocked text reply from a bound `viewer`.
- Safe sender audit regression covers non-private `/start <token>` being ignored without consuming the token.
- Manager UI tooltip includes attempt count, last error and external Telegram message id when present.
- Manual sender entrypoint exists as `npm run deliver:telegram:once`, but it was not run against real Telegram because this task explicitly avoids production/deploy/secrets changes.
- Local manual smoke and staging Bot API smoke prep checklist: `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`

## Safety Notes

- `TELEGRAM_BOT_TOKEN` is used only by `TelegramBotApiDeliveryProvider` in the separate sender path.
- `apps/api/src/routes/telegram.ts` and `apps/api/src/services/telegram-bot-service.ts` remain webhook/normalization code and do not call `sendMessage`, `forwardMessage` or `copyMessage`.
- The sender does not enable Telegram AI outbound.
- No production env, deploy, webhook registration or secret values were changed.
- Telegram remains an adapter over Postgres operations state, not a separate CRM.

## Remaining Blockers

- Staging smoke with real Telegram Bot API delivery and external message id evidence; under the no-real-clients/no-real-managers assumption this should be the next controlled test.
- Operational decision for scheduled/daemonized worker execution.
- Sender for `manager_notification_outbox`.
- Backup/restore/rollback evidence.
- Production G01-G17 and explicit owner sign-off.

## Russian Transformation Gist

- Gist: https://gist.github.com/monaxovdulov/6c0f607dc2782c0def51962341d0af8e
- Source copy in repo: `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_TRANSFORM_GIST_RU.md`
