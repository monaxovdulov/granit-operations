# Runbook: Telegram manager reply supervised scheduler

Status: repo runbook for supervised staging/production-candidate operation; not production approval

## Runtime

```text
systemd timer -> granit-telegram-delivery-once.service -> docker compose run ops-api npm run deliver:telegram:once
```

Repo templates:

- `deploy/systemd/granit-telegram-delivery-once.service`
- `deploy/systemd/granit-telegram-delivery-once.timer`

Required runtime env names are documented in `docs/ENVIRONMENT.md`. Do not print secret values in logs or evidence.

## Install / Enable

Preferred system-level install for production-candidate hosts:

```bash
sudo install -m 0644 deploy/systemd/granit-telegram-delivery-once.service /etc/systemd/system/granit-telegram-delivery-once.service
sudo install -m 0644 deploy/systemd/granit-telegram-delivery-once.timer /etc/systemd/system/granit-telegram-delivery-once.timer
sudo systemctl daemon-reload
sudo systemctl enable --now granit-telegram-delivery-once.timer
systemctl status granit-telegram-delivery-once.timer
```

Rootless staging install, used for the 2026-05-22 supervised smoke on `giorno.aeza.network`:

```bash
mkdir -p ~/.config/systemd/user
install -m 0644 deploy/systemd/granit-telegram-delivery-once.service ~/.config/systemd/user/granit-telegram-delivery-once.service
install -m 0644 deploy/systemd/granit-telegram-delivery-once.timer ~/.config/systemd/user/granit-telegram-delivery-once.timer
systemd-analyze --user verify ~/.config/systemd/user/granit-telegram-delivery-once.service ~/.config/systemd/user/granit-telegram-delivery-once.timer
systemctl --user daemon-reload
systemctl --user enable --now granit-telegram-delivery-once.timer
systemctl --user status granit-telegram-delivery-once.timer
systemctl --user list-timers 'granit-telegram-delivery-once*' --all
```

Use the rootless path only when the runtime user owns `/srv/botops`, is in the `docker` group, and linger is enabled. Otherwise use the system-level install.

Expected service behavior:

- lock acquired -> process one bounded batch;
- lock busy -> log `telegram_delivery_lock_busy` and exit `0`;
- provider timeout/cancel/network-unknown -> delivery status `uncertain`;
- `uncertain` is not auto-retried.

## Stop

System-level:

```bash
sudo systemctl stop granit-telegram-delivery-once.timer
sudo systemctl stop granit-telegram-delivery-once.service
systemctl list-timers 'granit-telegram-delivery-once*'
journalctl -u granit-telegram-delivery-once.service -n 100 --no-pager
```

Rootless staging:

```bash
systemctl --user stop granit-telegram-delivery-once.timer
systemctl --user stop granit-telegram-delivery-once.service
systemctl --user list-timers 'granit-telegram-delivery-once*' --all --no-pager
journalctl --user -u granit-telegram-delivery-once.service -n 100 --no-pager
```

Stop timer first. Do not delete delivery rows. Do not reset `uncertain` rows to `pending` without a manual decision, because Telegram may already have accepted the message.

## Restart / No-Resend Check

```bash
systemctl --user start granit-telegram-delivery-once.timer
journalctl --user -u granit-telegram-delivery-once.service --since '10 minutes ago' --no-pager
```

Expected after restart with no eligible deliveries:

- one-shot exits `0`;
- log has `telegram_delivery_lock_acquired`;
- log has `telegram_delivery_once_finished` with `claimed=0`;
- previous `sent` delivery remains `sent` and `attempt_count` does not increase.

## DB Checks

Use sanitized output only.

```sql
SELECT status, count(*), min(created_at) AS oldest_created_at, min(updated_at) AS oldest_updated_at
FROM message_deliveries
WHERE channel = 'telegram'
  AND provider = 'telegram_bot'
GROUP BY status
ORDER BY status;

SELECT id, status, attempt_count, updated_at, provider_message_id IS NOT NULL AS has_provider_message_id
FROM message_deliveries
WHERE channel = 'telegram'
  AND provider = 'telegram_bot'
  AND status IN ('pending', 'retrying', 'processing', 'uncertain', 'failed')
ORDER BY updated_at
LIMIT 20;
```

Watch conditions:

- oldest `pending`/`retrying` age too high;
- `failed` increased;
- `uncertain > 0`;
- no successful `telegram_delivery_once_finished` event in the expected window;
- repeated Telegram `429` or `5xx` provider failures.

## Uncertain Delivery Policy

`uncertain` means the sender cannot prove whether Telegram accepted the manager-authored reply. This usually comes from provider timeout, process cancel, network-unknown failure, or stale `processing` state. Treat it as an operator decision, not as a normal retry state.

Hard rules:

- `uncertain` is never auto-retried.
- Do not reset `uncertain` to `pending` or `retrying` just to make the scheduler pick it up.
- Keep the original `message_deliveries` row as evidence.
- Resolve the operator decision through a separate `lead_timeline_events` entry and a release/evidence note.
- Owner decision is required before any manual resend when the Telegram receipt cannot be verified, a real customer may receive a duplicate, the message content is disputed, or a manual DB operation is considered.

Find `uncertain` rows with sanitized output:

```sql
SELECT
  md.id AS delivery_id,
  c.lead_id,
  c.public_conversation_id,
  cm.public_message_id,
  md.attempt_count,
  md.updated_at,
  md.provider_message_id IS NOT NULL AS has_provider_message_id,
  left(coalesce(md.last_error, ''), 160) AS last_error_preview
FROM message_deliveries md
JOIN conversation_messages cm ON cm.id = md.conversation_message_id
JOIN conversations c ON c.id = cm.conversation_id
JOIN channel_identities ci ON ci.id = cm.channel_identity_id
WHERE md.channel = 'telegram'
  AND md.provider = 'telegram_bot'
  AND md.status = 'uncertain'
  AND cm.direction = 'outbound'
  AND cm.sender_role = 'manager'
  AND ci.channel = 'telegram'
  AND ci.provider = 'telegram_bot'
ORDER BY md.updated_at
LIMIT 20;
```

For one delivery, inspect the manager-visible context without printing private chat ids:

```sql
SELECT
  md.id AS delivery_id,
  md.status,
  md.attempt_count,
  md.updated_at,
  md.provider_message_id IS NOT NULL AS has_provider_message_id,
  c.public_conversation_id,
  cm.public_message_id,
  left(cm.body, 240) AS message_preview,
  left(coalesce(md.last_error, ''), 240) AS last_error_preview
FROM message_deliveries md
JOIN conversation_messages cm ON cm.id = md.conversation_message_id
JOIN conversations c ON c.id = cm.conversation_id
WHERE md.id = '<delivery-id>'::uuid
  AND md.status = 'uncertain';
```

Operator decision tree:

1. Check the manager UI timeline and message delivery badge for the same `public_conversation_id` / `public_message_id`.
2. Check Telegram receipt directly in the relevant test/customer chat when access is available: message is visible, timestamp matches the attempt window, and text matches the manager reply.
3. Check journal around `md.updated_at` for `telegram_delivery_once_finished`, provider timeout/cancel/network failure, or stale `processing` evidence. Do not store raw private chat ids or secret values in evidence.
4. If the Telegram message is confirmed delivered, choose `no_op_delivered`; leave the row `uncertain` and record the decision.
5. If receipt cannot be verified and duplicate risk is unacceptable, choose `no_op_owner_declined_duplicate_risk`; leave the row `uncertain` and record the owner decision.
6. If the owner accepts duplicate risk and the customer still needs the reply, send a new manager-authored reply through the existing manager reply path. Do not call Telegram Bot API directly and do not mutate the old `uncertain` row into a retry.
7. If facts are incomplete or the decision affects a real customer, stop and capture owner decision before doing anything irreversible.

Manual timeline resolution template:

```sql
WITH target_delivery AS (
  SELECT
    md.id AS delivery_id,
    c.lead_id,
    c.public_conversation_id,
    cm.public_message_id
  FROM message_deliveries md
  JOIN conversation_messages cm ON cm.id = md.conversation_message_id
  JOIN conversations c ON c.id = cm.conversation_id
  WHERE md.id = '<delivery-id>'::uuid
    AND md.status = 'uncertain'
),
inserted AS (
  INSERT INTO lead_timeline_events (
    lead_id,
    event_type,
    summary,
    metadata,
    created_at
  )
  SELECT
    lead_id,
    'conversation.delivery_uncertain_resolution',
    'Telegram uncertain delivery manually resolved',
    jsonb_build_object(
      'delivery_id', delivery_id,
      'public_conversation_id', public_conversation_id,
      'public_message_id', public_message_id,
      'decision', '<no_op_delivered|no_op_owner_declined_duplicate_risk|manual_resend_new_manager_reply|owner_escalation_required>',
      'receipt_check', '<telegram_message_found|telegram_message_not_found|cannot_verify>',
      'operator', '<operator-name-or-role>',
      'owner_decision', '<owner-name-or-decision-ref>',
      'duplicate_risk', '<accepted|declined|not_applicable>',
      'evidence_doc', 'docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md'
    ),
    now()
  FROM target_delivery
  RETURNING id
)
SELECT id AS timeline_event_id
FROM inserted;
```

After the insert, confirm that the decision is visible in the lead timeline:

```sql
SELECT event_type, summary, metadata, created_at
FROM lead_timeline_events
WHERE event_type = 'conversation.delivery_uncertain_resolution'
ORDER BY created_at DESC
LIMIT 5;
```

Owner-readable evidence for each resolved `uncertain` delivery must include:

- sanitized `delivery_id`, `public_conversation_id`, `public_message_id`, `attempt_count`, and `updated_at`;
- the selected decision from the allowed set in the timeline template;
- receipt check result, operator name/role, owner decision reference when required, and duplicate-risk outcome;
- `timeline_event_id` for `conversation.delivery_uncertain_resolution`;
- statement that the original `message_deliveries.status='uncertain'` row was preserved;
- statement that no blind auto-retry/reset, direct Bot API resend, fake provider receipt, notification sender work, Telegram AI outbound, staging deploy, or production deploy was performed as part of the resolution.

Do not include raw private chat ids, secret values, provider tokens, or unnecessary customer PII in the evidence note.

Prohibited actions:

- delete `message_deliveries`, `conversation_messages`, or timeline rows to hide `uncertain`;
- fake `provider_message_id` or `provider_sent_at`;
- direct Telegram Bot API resend from shell or webhook code;
- reset `uncertain` to `pending`, `retrying`, or `sent` without a separate implementation and evidence slice;
- enable Telegram AI outbound;
- add or start a `manager_notification_outbox` sender as part of this procedure;
- treat this runbook as production approval or perform production deploy without explicit owner sign-off.

## Rollback

System-level:

```bash
sudo systemctl stop granit-telegram-delivery-once.timer
sudo systemctl stop granit-telegram-delivery-once.service
```

Rootless staging:

```bash
systemctl --user stop granit-telegram-delivery-once.timer
systemctl --user stop granit-telegram-delivery-once.service
```

Then inspect DB state and deploy the previous approved API revision/image. Preserve sent/evidence rows. Do not blindly rewrite `processing`, `retrying`, or `uncertain`; resolve them with an owner-visible note in release evidence.
