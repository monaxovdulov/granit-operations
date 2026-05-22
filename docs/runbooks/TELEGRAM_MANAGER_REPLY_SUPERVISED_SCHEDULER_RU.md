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
