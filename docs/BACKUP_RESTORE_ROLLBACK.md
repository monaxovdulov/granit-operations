# Backup Restore Rollback

Status: backup/restore proof deferred for no-customer staging on 2026-05-29; partial Telegram delivery rollback procedure documented; later required again for staging customer traffic and production approval

Backup, restore, and rollback are not implemented in S01, but staging go-live and production launch cannot happen without evidence.

Owner decision, 2026-05-29:

- there are currently no customers in the staging Telegram path;
- live staging DB backup/restore proof may be deferred for now;
- this does not count as restore evidence and does not approve production or real customer traffic;
- before customer-facing staging sign-off or production approval, run the backup/restore proof from `docs/tasks/STAGING_GO_LIVE_READINESS_RU.md`.

Current target after deferral:

- keep backup/restore proof explicitly blocked until it is actually run;
- document rollback rules that prevent duplicate Telegram sends after partial delivery;
- then reuse or harden the evidence for a later production release decision.

## Partial Telegram Delivery Rollback

Telegram delivery is partly external state. Once Telegram accepts a manager-authored message, code rollback cannot unsend it. Treat `message_deliveries.status='sent'` and `status='uncertain'` rows as delivery evidence, not as rows to rewrite.

Use this procedure when a deploy, timer, or worker fails after some Telegram deliveries may already have been processed.

### Stop Order

Stop the scheduler before changing code or inspecting data:

```bash
systemctl --user stop granit-telegram-delivery-once.timer
systemctl --user stop granit-telegram-delivery-once.service
systemctl --user list-timers 'granit-telegram-delivery-once*' --all --no-pager
```

For a system-level install, use the same order with `sudo systemctl stop ...timer` first, then `...service`.

### Sanitized State Snapshot

Record counts only; do not paste DB URLs, tokens, private chat ids, message bodies, contact names, phones, emails, or raw logs into evidence.

```sql
SELECT status, count(*) AS count
FROM message_deliveries
WHERE channel = 'telegram'
  AND provider = 'telegram_bot'
GROUP BY status
ORDER BY status;

SELECT
  status,
  attempt_count,
  count(*) AS count,
  min(updated_at) AS oldest_updated_at,
  max(updated_at) AS newest_updated_at
FROM message_deliveries
WHERE channel = 'telegram'
  AND provider = 'telegram_bot'
  AND status IN ('pending', 'processing', 'retrying', 'failed', 'blocked', 'blocked_no_destination', 'uncertain')
GROUP BY status, attempt_count
ORDER BY status, attempt_count;
```

### Roll Back Code Without Rewriting Delivery Evidence

- Deploy or restart the previous approved API revision/image only after the timer/service is stopped.
- Do not delete `message_deliveries`, `conversation_messages`, `conversations`, `channel_identities`, `leads`, or `lead_timeline_events`.
- Do not overwrite `sent` rows. They prove that a manager-authored Telegram send was accepted.
- Do not reset `uncertain` rows to `pending` or `retrying`. `uncertain` means Telegram acceptance is unknown and must go through the manual policy in `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`.
- Do not fake `provider_message_id`, `provider_sent_at`, or timeline evidence.
- Do not call Telegram Bot API directly from shell as a resend workaround.

### Restart / No-Duplicate Check

After rollback/restart, confirm the worker does not resend already accepted messages:

```sql
SELECT status, count(*) AS count
FROM message_deliveries
WHERE channel = 'telegram'
  AND provider = 'telegram_bot'
GROUP BY status
ORDER BY status;
```

Expected result:

- existing `sent` count stays at least the same and `attempt_count` for those rows does not increase;
- `uncertain` rows remain `uncertain` until manually resolved;
- only eligible `pending`/`retrying` rows can be claimed by the scheduler;
- any operator decision is recorded as a separate timeline event, not by mutating old evidence.

Future coverage:

- operations Postgres backup and restore;
- Payload content/media backup coordination with `granit-site-cms`;
- environment/config inventory;
- deploy version and immutable commit SHA;
- public intake contract version;
- rollback path that does not overwrite leads created after deploy;
- manual intake fallback if automated intake fails.

S13 will harden backup/restore/rollback. Production deploy must not happen from this scaffold.
