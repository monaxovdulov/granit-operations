# Evidence: Telegram manager reply supervised scheduler

Status: local implementation evidence; not production approval
Date: 2026-05-22
Repo: `granit-operations`
Slice: `TELEGRAM-MANAGER-REPLY-WORKER-SUPERVISED-SCHEDULER`
Task link: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`

## What Changed

Runtime model:

```text
systemd timer -> npm run deliver:telegram:once -> Postgres advisory lock -> message_deliveries -> Telegram Bot API -> delivery status
```

Implementation facts:

- One-shot command takes a session-level Postgres advisory lock before claiming deliveries.
- Lock busy logs `telegram_delivery_lock_busy` and exits `0`.
- `message_deliveries.status` now allows `processing` and `uncertain`.
- Claim changes eligible `pending/retrying` rows to `processing`.
- Provider timeout, process `SIGTERM`/`SIGINT`, or network-unknown provider failure records `uncertain`.
- `uncertain` rows are not auto-claimed for retry.
- Telegram Bot API `fetch` receives an `AbortSignal`.
- Retryable known Telegram errors still use bounded `retrying -> failed` behavior.
- Systemd templates are in `deploy/systemd/`.
- Stop/rollback runbook is in `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`.

## Commands And Checks

| Check | Result | Notes |
|---|---|---|
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed, 12 tests | Covers success, bounded retry, provider timeout, provider `AbortSignal`, `uncertain`, pre-provider abort, stale `processing`, worker signal propagation |
| `npm run typecheck` | passed | API and manager TypeScript |
| `npm run smoke:api` | passed, 36 tests | Existing manager/API smoke including Telegram AI outbound block regression |
| `npm test` | passed, 55 tests | Full local Vitest suite |
| `systemd-analyze verify deploy/systemd/granit-telegram-delivery-once.service deploy/systemd/granit-telegram-delivery-once.timer` | passed | Unit/timer syntax verification only; service was not installed or started |
| `git diff --check` | passed | No whitespace errors |

## Runtime Artifacts

Service/timer names:

- `granit-telegram-delivery-once.service`
- `granit-telegram-delivery-once.timer`

Env names added:

- `TELEGRAM_DELIVERY_PROVIDER_TIMEOUT_MS`
- `TELEGRAM_DELIVERY_PROCESSING_STALE_MS`

Existing env names reused:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID`
- `TELEGRAM_DELIVERY_BATCH_SIZE`
- `TELEGRAM_DELIVERY_MAX_ATTEMPTS`
- `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS`

No token, DB URL, webhook secret, raw private chat id, or private customer data is recorded here.

## Known Boundaries

- This is not Telegram AI outbound.
- This is not a sender for `manager_notification_outbox`.
- This does not process Telegram media.
- This does not add `pg-boss`, Graphile Worker, BullMQ, Redis, or a new queue framework.
- This does not change AI business logic.
- This is not production approval.

## Staging / Production Gate

Repo-local implementation is complete, but installing/enabling the timer in a runtime host is a separate supervised operation. Before owner production approval, capture sanitized evidence for:

- `systemctl status granit-telegram-delivery-once.timer`;
- one-shot logs for lock acquired and lock busy;
- DB before/after for `pending`, `processing`, `sent`, `retrying`, `failed`, `blocked`, `uncertain`;
- provider timeout/cancel path;
- stop timer first, then stop service;
- restart behavior;
- no secret logs;
- Telegram receipt persisted for a manager-authored test delivery.
