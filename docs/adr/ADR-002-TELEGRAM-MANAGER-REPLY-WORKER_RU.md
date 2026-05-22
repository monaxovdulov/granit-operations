# ADR-002: Telegram Manager Reply Worker

Status: accepted for explicit staging use; not production approval
Date: 2026-05-21
Repo scope: `granit-operations`
Related slice/task: `TELEGRAM-MANAGER-REPLY-WORKER`

## Context

The accepted manual sender path already delivers manager-authored Telegram replies from `message_deliveries` through a separate sender, not from the webhook.

The next operational gap was automatic delivery of already-authorized manager replies without manually running `npm run deliver:telegram:once`. Owner permission was captured for a long-running staging worker, with no real clients/managers depending on this Telegram path. This still does not approve production.

## Decision

Add an explicit long-running command:

```bash
npm run deliver:telegram:worker
```

The worker:

- reuses `TelegramMessageDeliveryService`;
- uses the existing Postgres `message_deliveries` queue and `FOR UPDATE OF message_deliveries SKIP LOCKED` claim semantics;
- only claims Telegram Bot API rows whose `conversation_messages.sender_role='manager'` and `direction='outbound'`;
- keeps `npm run deliver:telegram:once` as the manual one-batch fallback;
- reads batch size, poll interval, max attempts and retry backoff from env;
- treats `retrying` rows as eligible only after retry backoff;
- handles `SIGTERM` and `SIGINT` gracefully;
- is disabled by default because it runs only when the command is explicitly started.

No repo-local compose worker service/profile was added because this repository does not contain a deploy/compose pattern. Staging smoke used the existing external staging runtime directly and did not create a persistent worker service.

## Consequences

- Webhook behavior remains unchanged and still does not call Telegram `sendMessage`.
- Telegram AI outbound remains blocked; adding a worker does not authorize AI-authored Telegram messages.
- A runaway retry loop is avoided by the `retrying.updated_at` backoff gate.
- Staging can run the worker explicitly for controlled smoke/debug without changing production DNS, production secrets or production rollout.
- Production-supervised scheduling is handled separately by ADR-003. ADR-002 remains the evidence for the explicit staging worker, not production approval.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Cron-like repeated `deliver:telegram:once` | Harder to test graceful stop and less direct for a future supervised worker. |
| Send directly from Telegram webhook | Violates the persisted-state-first boundary and hides delivery state from Postgres/manager UI. |
| Add a repo-local compose worker service now | No repo-local compose/deploy pattern exists; adding one would be broader than this task. |
| Claim all outbound Telegram rows | Rejected because this worker is only for manager-authored replies; AI outbound must remain blocked. |

## Owner Impact

The owner gets a staged operational path for manager replies:

```text
manager reply -> message_deliveries.pending/retrying -> explicit worker tick -> Telegram sendMessage -> sent/retrying/failed/blocked
```

The owner should not treat this as a production launch. Until a separate production decision exists, the safe fallback is still the manual one-shot sender:

```bash
npm run deliver:telegram:once
```

## Links

- Task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- Evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- Supervised scheduler ADR: `docs/adr/ADR-003-TELEGRAM-MANAGER-REPLY-SUPERVISED-SCHEDULER_RU.md`
- Sender task: `docs/tasks/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- Sender evidence: `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- Architecture: `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
