# Evidence: Telegram manager reply worker

Status: accepted after local checks and controlled staging worker smoke; not production approval
Date: 2026-05-21
Repo: `granit-operations`
Slice: `TELEGRAM-MANAGER-REPLY-WORKER`
Task link: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`

## Что Проверяли

- `npm run deliver:telegram:worker` запускает long-running loop поверх существующего `TelegramMessageDeliveryService`.
- Worker берет только `message_deliveries` для Telegram Bot API, где исходное сообщение `conversation_messages.direction='outbound'` и `sender_role='manager'`.
- Claim остается Postgres-backed: `FOR UPDATE OF message_deliveries SKIP LOCKED`.
- `pending` rows eligible immediately; `retrying` rows eligible only after `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS`.
- Batch size, poll interval, max attempts and retry backoff читаются из env с безопасными defaults.
- `SIGTERM`/`SIGINT` приводят к graceful shutdown после текущего batch/sleep.
- Ручной `npm run deliver:telegram:once` остается тем же sender path и использует те же env defaults.
- Telegram AI outbound остается заблокирован; worker не включает AI replies и не трогает `manager_notification_outbox`.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm test -- apps/api/test/telegram-delivery-service.test.ts` | passed, 4 tests | Existing sender tests plus claim config assertion |
| `npm test -- apps/api/test/telegram-delivery-worker.test.ts` | passed, 3 tests | Poll loop, error backoff/redaction, abort stop |
| `npm run typecheck` | passed | API and manager TypeScript |
| `npm run smoke:api` | passed, 36 tests | Includes Telegram AI outbound block regression |
| `npm test` | passed, 50 tests | Full local suite |
| Staging `docker compose ... build ops-api` | passed | Build ran `npm run build` inside image |
| Staging `docker compose ... up -d ops-api` | passed | API restarted; healthcheck returned `ok` |
| Staging explicit worker smoke | passed | One fake manager-authored delivery sent by worker |

## Staging Worker Smoke

Scope:

- staging runtime under `/srv/botops`;
- existing test Telegram bot/runtime env, without printing secret values;
- one existing Telegram test customer identity;
- one fake manager-authored staging row;
- no real clients and no real managers on this Telegram path per owner assumption;
- no production rollout, no persistent worker service, no notification sender, no Telegram AI outbound.

DB before worker, sanitized:

| Field | Value |
|---|---|
| `delivery_id` | `164f51d6-5de1-4660-9fc5-b25e9414a176` |
| `message_deliveries.status` | `pending` |
| `attempt_count` | `0` |
| `provider_message_id_present` | `false` |
| `public_conversation_id` | `aa822e11-a9af-4fb9-8aa7-36bf2252aef2` |
| `public_message_id` | `1f4117bf-a8f1-4f25-bbbb-4b20e7309e5a` |
| `external_chat_id` | redacted, suffix `5601` |
| body | `Telegram worker smoke 2026-05-21T2135Z` |

Sanitized worker logs:

```json
{"level":"info","event":"telegram_delivery_worker_started","batch_size":5,"poll_interval_ms":1000,"error_backoff_ms":1000}
{"level":"info","event":"telegram_delivery_worker_tick","claimed":1,"sent":1,"retrying":0,"failed":0,"blocked":0}
{"level":"info","event":"telegram_delivery_worker_tick","claimed":0,"sent":0,"retrying":0,"failed":0,"blocked":0}
{"level":"info","event":"telegram_delivery_worker_shutdown_requested","reason":"SIGTERM"}
{"level":"info","event":"telegram_delivery_worker_stopped","reason":"SIGTERM"}
```

DB after worker, sanitized:

| Field | Value |
|---|---|
| `message_deliveries.status` | `sent` |
| `attempt_count` | `1` |
| `last_error_is_null` | `true` |
| `message_deliveries.provider_message_id_present` | `true` |
| `conversation_messages.provider_message_id_present` | `true` |
| `conversation_messages.provider_sent_at_present` | `true` |
| timeline event | `conversation.delivery_sent` |
| timeline `delivery_status` | `sent` |

Telegram receipt confirmation:

- Telegram Bot API accepted the worker `sendMessage` call and returned a `message_id`.
- That Telegram receipt was persisted as `provider_message_id` on both `message_deliveries` and `conversation_messages`.
- No bot token, DB URL, webhook secret or raw private chat id is recorded in this evidence.

## Rollback / Stop

- Current worker stop: send `SIGTERM` or `SIGINT`; the script logs `telegram_delivery_worker_shutdown_requested` and `telegram_delivery_worker_stopped`.
- There is no persistent worker service/profile in this repo and no staging compose worker service was added. Stop/rollback for this smoke is therefore simply not running `npm run deliver:telegram:worker`.
- Staging API was rebuilt/restarted to include this code. To revert staging runtime, deploy the previous approved repo revision/image and restart `ops-api`.
- The fake staging row is left as evidence. If it later clutters manager views, close/archive the test lead through the manager UI rather than deleting production-like evidence rows.

## Blockers / Watch Items

- This is not production approval.
- Production still needs supervised worker/service decision, backup/restore/rollback evidence, G01-G17 gates and explicit owner sign-off.
- `manager_notification_outbox` sender remains out of scope and not implemented.
- Telegram AI outbound remains blocked.
- No repo-local compose/deploy profile exists, so no disabled staging worker service was added to the repository.

## Sign-Off

- Owner: permission captured in task prompt for long-running staging worker only.
- Developer/release owner: Codex.
- Date: 2026-05-21.
