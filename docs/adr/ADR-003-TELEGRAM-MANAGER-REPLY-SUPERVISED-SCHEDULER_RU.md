# ADR-003: Telegram Manager Reply Supervised Scheduler

Status: implemented as production-candidate runtime shape; not production approval
Date: 2026-05-22
Repo scope: `granit-operations`
Related slice/task: `TELEGRAM-MANAGER-REPLY-WORKER-SUPERVISED-SCHEDULER`

## Context

ADR-002 accepted an explicit staging worker for manager-authored Telegram replies, but production still needed a supervised runtime model that can be stopped, observed, and kept singleton.

The repo currently has one real background job type in this area: delivery of already-authorized manager replies from `message_deliveries` to Telegram customers. Telegram AI outbound, manager notification outbox sending, and media processing remain separate blocked scopes.

## Decision

Use a supervised one-shot scheduler instead of a long-running production worker or queue framework:

```text
systemd timer -> npm run deliver:telegram:once -> Postgres advisory lock -> message_deliveries -> Telegram Bot API -> delivery status
```

Runtime decisions:

- `systemd` owns periodic launch and stop/restart behavior.
- The one-shot command uses a session-level Postgres advisory lock; lock busy exits `0` without processing.
- `message_deliveries` remains the source of truth and gains `processing` and `uncertain`.
- Telegram provider calls have a per-call timeout and receive the process `AbortSignal`.
- `uncertain` rows are not auto-retried because a provider timeout/cancel/network-unknown may have delivered the Telegram message.
- `pg-boss`, Graphile Worker, BullMQ, Redis, and notification sender work are not introduced in this slice.

## Consequences

- There is at most one active Telegram manager reply delivery run per database advisory lock.
- A stuck provider call has a bounded timeout, and systemd stop can abort the fetch.
- Crashes or stale `processing` rows become visible as `uncertain` instead of being silently retried.
- Delivery remains manager-authored only; AI-authored Telegram outbound is still blocked by existing boundaries.
- Production enablement still requires owner sign-off, supervised smoke evidence, rollback review, and environment installation outside this repo.

## Links

- Task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Runbook: `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`
- Systemd templates: `deploy/systemd/granit-telegram-delivery-once.service`, `deploy/systemd/granit-telegram-delivery-once.timer`
- Previous worker ADR: `docs/adr/ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md`
