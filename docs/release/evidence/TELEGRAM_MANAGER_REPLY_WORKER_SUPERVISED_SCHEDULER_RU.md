# Evidence: Telegram manager reply supervised scheduler

Status: supervised staging smoke passed; post-sign-off staging enablement check passed; not production approval
Date: 2026-05-22; post-sign-off check 2026-05-29
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
| `systemd-analyze verify deploy/systemd/granit-telegram-delivery-once.service deploy/systemd/granit-telegram-delivery-once.timer` | passed | System-level unit/timer syntax |
| `systemd-analyze --user verify ~/.config/systemd/user/granit-telegram-delivery-once.service ~/.config/systemd/user/granit-telegram-delivery-once.timer` | passed | User-level staging install syntax |
| `git diff --check` | passed | No whitespace errors |
| staging `docker compose ... build ops-api` | passed | Image build ran `npm run build` |
| staging `docker compose ... up -d ops-api` | passed | API restarted; `/health` returned `ok` |
| staging `psql -f packages/db/migrations/0009_telegram_delivery_processing_uncertain.sql` | passed | `message_deliveries.status` now allows `processing` and `uncertain` |
| staging supervised timer smoke | passed | User systemd timer launched one-shot; one fake manager-authored delivery became `sent` |
| post-sign-off staging enablement check | passed | Rootless timer verified, stopped timer-first, restarted, advisory lock busy exited `0`, no resend after restart, no secret/chat-id journal findings |

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

## Supervised Staging Smoke

Runtime host:

- host: `giorno.aeza.network`;
- runtime root: `/srv/botops`;
- compose stack: `granit-staging`;
- install mode used for this smoke: `systemctl --user` for `devuser`, with linger enabled.

Why user systemd: passwordless `sudo` was not available in this Codex session, while staging already runs the stack as `devuser` and `devuser` is in the `docker` group. The production-candidate runbook still keeps the system-level install path for hosts where root install is available.

Staging DB migration:

- before migration, `message_deliveries_status_check` allowed `pending`, `sent`, `failed`, `retrying`, `blocked_no_destination`, `blocked`;
- after migration, it also allows `processing` and `uncertain`;
- DB status counts before smoke: `sent=2`;
- final DB status counts after smoke: `sent=3`, `uncertain=1`.

Lock busy proof:

```text
held Postgres advisory lock (1196573006, 1413960241)
systemd one-shot result: success, ExecMainStatus=0
log event: telegram_delivery_lock_busy
```

Timeout/cancel/unknown-result proof:

- fake staging delivery `6f75fb2e-1c17-47a8-b314-eefffa2f6b47` was inserted as old `processing`;
- one-shot marked it `uncertain`;
- `attempt_count=1`;
- `last_error` present;
- `provider_message_id` absent;
- log event: `telegram_delivery_once_finished` with `claimed=0`, `sent=0`, `uncertain=1`.

Timer delivery proof:

- fake staging delivery `eee85dc1-3efe-467d-a6e6-6c3378e64138` started as `pending`;
- `granit-telegram-delivery-once.timer` started the service without a manual terminal sender run;
- one-shot log result: `claimed=1`, `sent=1`, `retrying=0`, `failed=0`, `blocked=0`, `uncertain=0`;
- DB after timer run: `status='sent'`, `attempt_count=1`, `last_error IS NULL`, provider receipt present.

Stop/restart proof:

- stopped timer first, then service;
- `systemctl --user list-timers 'granit-telegram-delivery-once*'` showed `0 timers listed`;
- restarted timer;
- next one-shot result was `claimed=0`, `sent=0`, `uncertain=0`;
- the already sent delivery stayed `sent` with `attempt_count=1`, so restart did not re-send it.

Final staging runtime state:

- `granit-telegram-delivery-once.timer`: enabled and active under `systemctl --user`;
- latest service result: `success`, `ExecMainStatus=0`;
- `ops-api` health: `{"ok":true,"service":"granit-operations-api"}`;
- no token, DB URL, webhook secret, raw chat id, or private customer data appeared in the captured journal grep.

## Post-Sign-Off Staging Enablement Check

Date: 2026-05-29

Source: server-agent handoff `https://github.com/monaxovdulov/ai-homebase/issues/40`, sanitized report copied into `docs/tasks/STAGING_GO_LIVE_READINESS_RU.md`.

Scope:

- manager-authored Telegram replies only;
- same approved customer flow: `Telegram customer -> Telegram bot -> manager reply -> Telegram bot -> same Telegram customer`;
- not production approval.

Runtime result:

- host/session: `giorno.aeza.network` under `devuser`, `/srv/botops` available;
- rootless units exist in `~/.config/systemd/user`;
- `systemd-analyze --user verify` passed;
- stop/restart order passed: stop timer, stop service, start timer;
- final timer state: active and enabled;
- final service state: inactive after successful one-shot;
- final checked run: `2026-05-29 18:18:28 UTC`;
- one-shot after restart exited successfully with `claimed=0`.

Delivery state:

- before/final sanitized DB counts stayed `sent=3`, `uncertain=1`;
- sent fingerprint stayed unchanged: `count=3`, `attempt_sum=3`, `newest_sent_updated_at=2026-05-22 18:16:19 UTC`;
- this proves the existing `sent` rows were not re-sent by the restart check;
- existing `uncertain=1` was not changed and remains subject to the manual `uncertain` runbook.

No-overlap and log hygiene:

- advisory lock check returned `telegram_delivery_lock_busy`;
- service exited `0` while lock was held;
- supervised-window journal scan found no secret patterns, chat-id fields, or long numeric chat-id candidates;
- wider journal scan since `2026-05-22 18:16:00 UTC` found `secret_pattern_lines=0`, `chat_field_lines=0`, `long_numeric_candidate_lines=0`.

Explicitly not performed:

- production deploy or production approval;
- Telegram AI outbound;
- `manager_notification_outbox` sender;
- Mastra runtime;
- AI handoff expansion;
- DB/schema/env/secret/public-contract changes;
- real-customer staging traffic.

## Known Boundaries

- This is not Telegram AI outbound.
- This is not a sender for `manager_notification_outbox`.
- This does not process Telegram media.
- This does not add `pg-boss`, Graphile Worker, BullMQ, Redis, or a new queue framework.
- This does not change AI business logic.
- This is not production approval.

## Post-Smoke Uncertain Policy

Date: 2026-05-22

The manual handling gap for `message_deliveries.status='uncertain'` is now documented in the supervised scheduler runbook as DB/timeline manual resolution without a new UI action, without an admin script, and without delivery-code changes.

Policy summary:

- `uncertain` remains excluded from automatic retry.
- Operators must verify manager UI/timeline context, sanitized DB state, Telegram receipt when available, and journal evidence around the attempt.
- `no-op` is allowed when the Telegram receipt is confirmed or when the owner declines duplicate risk.
- Manual resend requires owner decision and accepted duplicate risk; the preferred path is a new manager-authored reply through the existing manager reply flow.
- The original `uncertain` row stays as evidence; the operator decision is recorded as a separate `conversation.delivery_uncertain_resolution` timeline event and an evidence note.
- Prohibited actions include blind status reset, direct Bot API resend, fake provider receipts, Telegram AI outbound, `manager_notification_outbox` sender work, and production deploy.

This closes the owner-readable/manual policy gap for supervised scheduler operation. It is still not production approval.

## Staging / Production Gate

Repo-local implementation, supervised staging smoke, post-sign-off staging enablement check, and `uncertain` manual policy documentation are complete. Before owner production approval or real customer traffic, still capture separate evidence for backup/restore, rollback, monitoring/watch policy, and explicit owner sign-off.
