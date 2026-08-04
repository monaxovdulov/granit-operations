# Environment

Status: names only, no secrets

Do not put secret values in this repo.

Future environment/config names:

| Name | Purpose | Scope | Status |
|---|---|---|---|
| `DATABASE_URL` | Operations Postgres connection | server only | S01 API runtime |
| `DATABASE_SEARCH_PATH` | Optional comma-separated PostgreSQL schema search path | server only | Staging compatibility; `grounded,public` isolates grounded tables from legacy experiments |
| `SESSION_SECRET` | Manager auth/session signing | server only | S02 runtime |
| `YANDEX_OAUTH_CLIENT_ID` | Yandex ID OAuth app client id | server only | S02 runtime |
| `YANDEX_OAUTH_CLIENT_SECRET` | Yandex ID OAuth app client secret | server only | S02 runtime |
| `YANDEX_OAUTH_REDIRECT_URI` | Yandex ID OAuth callback URL, for example `https://manager.botops.ru/auth/yandex/callback` | server only | S02 runtime |
| `MANAGER_AUTH_ALLOWED_ORIGINS` | Allowed manager UI origins | server only | S02 planned |
| `PUBLIC_INTAKE_ALLOWED_ORIGINS` | Comma-separated exact HTTP(S) origins allowed to call public intake endpoints through CORS; empty means no browser CORS allowlist | server only | Public intake CORS runtime |
| `PUBLIC_INTAKE_CONTRACT_VERSION` | Published intake contract version | server/client config | documented as `site_form.v1` |
| `AI_WIDGET_ENABLED` | Enables website widget AI replies only after S05 checks/staging smoke | server only | S05 runtime, default `false` |
| `AI_WIDGET_GROUNDED_MODE` | Selects `off`, `shadow`, or `enforce`; missing/unknown values fail closed to `off`, and unknown values emit a sanitized startup error without logging the env value | server only | Grounded consultant runtime |
| `OPENAI_API_KEY` | OpenAI Responses API access for website widget AI | server only | S05 runtime when AI enabled |
| `OPENAI_MODEL` | OpenAI model for website widget AI, default `gpt-5.5` | server only | S05 runtime |
| `OPENAI_VERIFIER_MODEL` | Independent semantic verifier model; defaults to `OPENAI_MODEL` | server only | Grounded consultant runtime |
| `AI_WIDGET_GENERATOR_TIMEOUT_MS` | Generator request timeout, default `10000`, clamped `3000..25000` | server only | Grounded consultant runtime |
| `AI_WIDGET_VERIFIER_TIMEOUT_MS` | Semantic verifier request timeout, default `6000`, clamped `3000..20000` | server only | Grounded consultant runtime |
| `AI_WIDGET_DEADLINE_MS` | Shared generator/verifier/repair turn budget, default `18000`, clamped `5000..30000` | server only | Grounded consultant runtime |
| `AI_WIDGET_JOB_WORKER_ENABLED` | Enables durable `site_widget.v2` AI-job processing; default `false` | server only | Async widget rollout |
| `AI_WIDGET_JOB_POLL_INTERVAL_MS` | Idle worker poll interval, default `250`, clamped `50..5000` | server only | Async widget worker |
| `AI_WIDGET_JOB_LEASE_MS` | Job claim lease, default `45000`, clamped `5000..120000` | server only | Async widget worker |
| `AI_WIDGET_JOB_RETRY_BACKOFF_MS` | Unexpected worker-failure retry backoff, default `1500`, clamped `0..60000` | server only | Async widget worker |
| `AI_WIDGET_JOB_MAX_ATTEMPTS` | Durable job attempt budget, default `3`, clamped `1..10` | server only | Async widget worker |
| `AI_WIDGET_EVAL_LIVE` | Explicitly authorizes paid live model evals when exactly `true`; does not enable customer traffic | server only | Local/staging eval runtime |
| `TELEGRAM_BOT_ENABLED` | Enables Telegram webhook adapter; default must remain `false` outside tested environments | server only | Telegram inbound + manager mini-panel runtime, default `false` |
| `TELEGRAM_BOT_TOKEN` | Telegram adapter token; used only by the separate delivery sender, never by the webhook for direct business sends | server only | Telegram delivery sender runtime |
| `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID` | Stable app-owned provider account id for Telegram bot identity/idempotency | server only | Telegram inbound + manager binding runtime |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook validation through `x-telegram-bot-api-secret-token` | server only | Telegram inbound + manager binding runtime |
| `PUBLIC_MANAGER_BASE_URL` | Public base URL for manager-panel links stored in Telegram notification outbox metadata | server only | Telegram manager notification outbox metadata |
| `TELEGRAM_DELIVERY_BATCH_SIZE` | Max `message_deliveries` rows claimed by one Telegram delivery batch, default `10`, clamped `1..100` | server only | Explicit Telegram delivery worker/one-shot runtime |
| `TELEGRAM_DELIVERY_POLL_INTERVAL_MS` | Long-running Telegram delivery worker delay between ticks, default `5000`, clamped `250..600000` | server only | Explicit Telegram delivery worker runtime |
| `TELEGRAM_DELIVERY_MAX_ATTEMPTS` | Max Telegram delivery attempts before `failed`, default `3`, clamped `1..20` | server only | Telegram delivery worker/one-shot runtime |
| `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS` | Minimum age for `retrying` Telegram deliveries before they are claimed again, default `60000`, clamped `0..86400000`; also used by the worker after unexpected tick errors | server only | Telegram delivery worker/one-shot runtime |
| `TELEGRAM_DELIVERY_PROVIDER_TIMEOUT_MS` | Per Telegram Bot API `sendMessage` timeout, default `15000`, clamped `1000..120000`; timeout records `uncertain` because provider result is unknown | server only | Supervised Telegram delivery one-shot runtime |
| `TELEGRAM_DELIVERY_PROCESSING_STALE_MS` | Age after which old `message_deliveries.processing` rows are marked `uncertain`, default `300000`, clamped `60000..86400000`; `uncertain` is not auto-retried | server only | Supervised Telegram delivery one-shot runtime |
| `URGENT_NOTIFICATION_DESTINATION` | Working-phone or owner-DM destination | server only | blocked until confirmed |
| `BACKUP_STORAGE_URL` | Backup storage target | server only | future |

Production urgent notifications are disabled until destinations are confirmed, test delivery passes, and delivery audit exists.

Existing detail: `docs/env/secrets-inventory.example.md`.

Manager auth detail: `docs/MANAGER_AUTH_YANDEX_RU.md`.
