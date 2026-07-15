# Environment

Status: names only, no secrets

Do not put secret values in this repo.

Future environment/config names:

| Name | Purpose | Scope | Status |
|---|---|---|---|
| `DATABASE_URL` | Operations Postgres connection | server only | S01 API runtime |
| `SESSION_SECRET` | Manager auth/session signing | server only | S02 runtime |
| `YANDEX_OAUTH_CLIENT_ID` | Yandex ID OAuth app client id | server only | S02 runtime |
| `YANDEX_OAUTH_CLIENT_SECRET` | Yandex ID OAuth app client secret | server only | S02 runtime |
| `YANDEX_OAUTH_REDIRECT_URI` | Yandex ID OAuth callback URL, for example `https://manager.botops.ru/auth/yandex/callback` | server only | S02 runtime |
| `MANAGER_AUTH_ALLOWED_ORIGINS` | Allowed manager UI origins | server only | S02 planned |
| `PUBLIC_INTAKE_ALLOWED_ORIGINS` | Allowed public site origins | server only | future |
| `PUBLIC_INTAKE_CONTRACT_VERSION` | Published intake contract version | server/client config | documented as `site_form.v1` |
| `AI_WIDGET_ENABLED` | Enables website widget AI replies only after S05 checks/staging smoke | server only | S05 runtime, default `false` |
| `AI_RUNTIME_MODE` | Selects exact `direct_openai` or `mastra_openai_api`; default is frozen direct rollback | server only | M3 staging-only selection after exact-SHA G6 approval |
| `DEPLOYMENT_TIER` | Exact `local`, `test`, `staging`, `production` or `unknown`; Mastra OpenAI mode is valid only for staging | server only | M1 runtime guard, default `unknown` |
| `OPENAI_API_KEY` | OpenAI Responses API access; injected only at the selected server-side provider boundary | server only | S05 direct rollback or G6-approved M3 Mastra staging boundary; never client-side |
| `OPENAI_MODEL` | OpenAI model for website widget AI, default `gpt-5.5` | server only | S05 runtime |
| `MASTRA_OPENAI_MODEL` | Exact first-slice Mastra model, only `gpt-5.6-sol` | server only | G6-approved M3 staging profile |
| `MASTRA_OPENAI_REASONING_EFFORT` | Exact first-slice reasoning effort, only `medium` | server only | G6-approved M3 staging profile |
| `AI_TRACE_EXPORT_ENABLED` | External AI trace export switch; first slice accepts only `false` | server only | P3/M1 guard, default `false` |
| `MASTRA_TELEMETRY_DISABLED` | Required exact `true` before the real Mastra module can be imported | server only | M1 network opt-out |
| `MASTRA_AUTO_REFRESH_PROVIDERS` | Required exact `false` to forbid background provider-registry refresh | server only | M1 network opt-out |
| `MASTRA_LICENSE_KEY` | Mastra enterprise license key name | server only | forbidden in the Apache-core first slice |
| `MASTRA_EE_LICENSE` | Alternate Mastra enterprise license name | server only | forbidden in the Apache-core first slice |
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
