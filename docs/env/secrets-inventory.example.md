# Secrets Inventory Example

Status: example only

Do not put secret values in this file.

Use this document to track required environment variable names and ownership.

| Name | Purpose | Scope | Status |
|---|---|---|---|
| `DATABASE_URL` | Operations Postgres connection | server only | future |
| `SESSION_SECRET` | Manager auth/session signing | server only | future |
| `PUBLIC_INTAKE_ALLOWED_ORIGINS` | Allowed public site origins | server only | future |
| `PUBLIC_INTAKE_CONTRACT_VERSION` | Published intake contract version | server/client config | future |
| `OPENAI_API_KEY` | OpenAI model access for later AI slices | server only | deferred |
| `TELEGRAM_BOT_TOKEN` | Telegram adapter token | server only | deferred |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook validation | server only | deferred |
| `URGENT_NOTIFICATION_DESTINATION` | Working-phone or owner-DM destination | server only | blocked until confirmed |
| `BACKUP_STORAGE_URL` | Backup storage target | server only | future |

Production urgent notifications are disabled until destinations are confirmed, test delivery passes, and delivery audit exists.
