# Task: Telegram manager reply worker/scheduler

ID: `TELEGRAM-MANAGER-REPLY-WORKER`
Repo: `granit-operations`
Slice: Telegram outbound delivery after controlled staging smoke
Owner/agent: Codex
Status: `accepted after local checks and controlled staging worker smoke; not production approval`

Owner permission captured in task prompt:

- long-running staging worker is allowed for this task;
- no real clients and no real managers currently depend on this Telegram path;
- this is not production approval.

## Цель

Сделать автоматическую доставку уже разрешенных ответов менеджера в Telegram вместо ручного запуска `npm run deliver:telegram:once`.

Текущий доказанный путь:

```text
manager reply -> conversation_messages.sender_role='manager' -> message_deliveries.pending -> ручной sender -> Telegram customer
```

Нужный следующий путь:

```text
manager reply -> message_deliveries.pending/retrying -> worker tick -> Telegram sendMessage -> sent/retrying/failed/blocked
```

## Scope

- Добавить long-running `deliver:telegram:worker` поверх существующего sender/repository.
- Использовать Postgres `message_deliveries` как очередь.
- Claim pending/retrying deliveries атомарно, с lock/limit pattern вроде `FOR UPDATE SKIP LOCKED`.
- Настроить batch size, poll interval, max attempts и backoff через env с безопасными defaults.
- Писать те же статусы, которые уже видит manager panel: `sent`, `retrying`, `failed`, `blocked_no_destination`.
- Добавить graceful shutdown по `SIGTERM`/`SIGINT`.
- Добавить Docker Compose service только disabled/gated по env или отдельному profile для staging.
- Провести controlled staging smoke: менеджер отвечает, worker сам доставляет сообщение клиенту без ручного `deliver:telegram:once`.

## Out Of Scope

- Telegram AI outbound.
- Sender для `manager_notification_outbox`.
- Production rollout.
- Secrets rotation/deploy automation.
- Превращение Telegram в отдельную CRM.

## Acceptance Criteria

- `npm run deliver:telegram:worker` запускает worker и останавливается корректно.
- Existing `npm run deliver:telegram:once` остается рабочим для ручного smoke/debug.
- Worker отправляет только manager-authored messages, которые уже лежат в `message_deliveries`.
- AI-authored Telegram replies остаются заблокированы через текущий outbound gate.
- Retry policy ограничена и не может бесконечно слать один delivery.
- Staging evidence содержит DB before/after, worker logs without secrets, Telegram receipt confirmation and explicit note that AI outbound is still blocked.

## Files Touched

- `apps/api/src/config.ts`
- `apps/api/src/repositories/telegram-delivery-repository.ts`
- `apps/api/src/scripts/deliver-telegram-pending-once.ts`
- `apps/api/src/scripts/deliver-telegram-worker.ts`
- `apps/api/src/services/telegram-delivery-service.ts`
- `apps/api/src/services/telegram-delivery-worker.ts`
- `apps/api/test/telegram-delivery-service.test.ts`
- `apps/api/test/telegram-delivery-worker.test.ts`
- `package.json`
- `docs/ENVIRONMENT.md`
- `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- `docs/adr/README.md`
- `docs/adr/ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md`
- `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`

No repo-local compose/service file was added because this repo has no compose/deploy profile pattern. The staging smoke used the existing external `/srv/botops` runtime explicitly and did not create a persistent worker service.

## Checks Run

- `npm test -- apps/api/test/telegram-delivery-service.test.ts` - passed, 4 tests.
- `npm test -- apps/api/test/telegram-delivery-worker.test.ts` - passed, 3 tests.
- `npm run typecheck` - passed.
- `npm run smoke:api` - passed, 36 tests.
- `npm test` - passed, 50 tests.
- `git diff --check` - passed.
- Staging `docker compose --env-file /srv/botops/.env.runtime -f /srv/botops/compose.yml build ops-api` - passed; image build ran `npm run build`.
- Staging `docker compose --env-file /srv/botops/.env.runtime -f /srv/botops/compose.yml up -d ops-api` - passed; healthcheck returned `ok`.
- Controlled staging worker smoke - passed:
  - before worker: fake manager-authored row `message_deliveries.status='pending'`, `attempt_count=0`, no provider message id;
  - worker logs: `claimed=1`, `sent=1`, then graceful `SIGTERM` shutdown;
  - after worker: `message_deliveries.status='sent'`, `attempt_count=1`, provider message id present on delivery and conversation message, `provider_sent_at` present, timeline event `conversation.delivery_sent`.

## Evidence Links

- `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- `docs/adr/ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md`

## Blockers

- Production rollout remains blocked. This task only proves explicit staged worker execution.
- Need supervised production service/scheduler decision before any always-on production worker.
- Need backup/restore/rollback proof, G01-G17 and explicit production owner sign-off.
- Need separate decision and implementation for `manager_notification_outbox` sender.
- Telegram AI outbound remains blocked.

## Next Action

Review this evidence and decide separately whether/when to add a supervised production worker/service. Until then, operational fallback remains:

```bash
npm run deliver:telegram:once
```
