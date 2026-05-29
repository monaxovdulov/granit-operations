# Evidence: Telegram manager notification sender

Status: repo-local once sender implemented; not deployed; not scheduled; not production approval
Date: 2026-05-29
Repo: `granit-operations`
Slice: `STAGING-GO-LIVE-READINESS` task 6
Task link: `docs/tasks/STAGING_GO_LIVE_READINESS_RU.md`

## What Changed

Runtime model:

```text
npm run deliver:manager-notifications:once
  -> Postgres advisory lock
  -> manager_notification_outbox
  -> manager Telegram binding destination
  -> Telegram Bot API sendMessage
  -> manager_notification_outbox status + lead timeline evidence
```

Implementation facts:

- Added an isolated manager notification sender service and Postgres outbox repository.
- The sender source queue is `manager_notification_outbox`, not `message_deliveries`.
- The sender resolves the manager Telegram destination through the stored binding id; it does not log raw destinations.
- No Telegram provider call happens in the webhook path.
- `blocked_no_destination` is recorded before provider send when the manager destination is missing or inactive.
- Successful sends record `sent`, `provider_message_id`, incremented `attempt_count`, cleared `last_error`, and `updated_at`.
- Provider errors use bounded `retrying -> failed` behavior.
- Timeline evidence uses `manager.notification_sent`, `manager.notification_retrying`, `manager.notification_failed`, and `manager.notification_blocked`.
- The one-shot script uses a separate advisory lock from the customer reply delivery sender.
- The existing Telegram Bot API provider and timeout pattern are reused.
- No DB schema or migration was added; existing outbox status values already cover this sender.

## Entry Point

Command:

```text
npm run deliver:manager-notifications:once
```

The command requires the existing DB and Telegram bot environment names already used by the Telegram path:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID`
- `TELEGRAM_DELIVERY_BATCH_SIZE`
- `TELEGRAM_DELIVERY_MAX_ATTEMPTS`
- `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS`
- `TELEGRAM_DELIVERY_PROVIDER_TIMEOUT_MS`

No values are recorded here.

## Boundary Proof

This sender is not:

- production approval;
- staging deploy;
- a worker/scheduler/systemd rollout;
- Telegram AI outbound;
- Mastra work;
- AI handoff expansion;
- customer reply delivery;
- a sender for `message_deliveries`;
- a direct Telegram webhook send path.

Focused test coverage includes a source-level guard that the new sender does not reference `messageDeliveries`, `message_deliveries`, `PostgresTelegramDeliveryRepository`, or `TelegramMessageDeliveryService`.

## Checks

| Check | Result | Notes |
|---|---|---|
| `npm test -- apps/api/test/manager-notification-sender.test.ts` | passed, 4 tests | Covers pending -> sent, missing destination -> blocked, retrying -> failed after max attempts, and no `message_deliveries` coupling |
| `npm test -- apps/api/test/manager-notification-sender.test.ts apps/api/test/telegram-delivery-service.test.ts` | passed, 13 tests | Focused notification sender tests plus existing customer delivery sender regression tests |
| `npm test` | passed, 84 tests | Full local Vitest suite |
| `npm run typecheck` | passed | API and manager TypeScript |
| `npm run smoke:api` | passed, 44 tests | Existing public/API smoke including Telegram inbound and AI outbound block regressions |
| `git diff --check` | passed | No whitespace errors |

## Known Boundaries

- No scheduler/systemd unit was added.
- No staging or production deploy was performed.
- No secret or env value was changed.
- No public contract changed.
- No existing `message_deliveries.status='uncertain'` row was read or modified.
- Notification duplicate risk is bounded by the once sender advisory lock and retry budget; a persistent scheduler remains a separate approval.
