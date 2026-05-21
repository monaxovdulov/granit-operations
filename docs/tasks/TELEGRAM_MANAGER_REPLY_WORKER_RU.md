# Task: Telegram manager reply worker/scheduler

ID: `TELEGRAM-MANAGER-REPLY-WORKER`
Repo: `granit-operations`
Slice: Telegram outbound delivery after controlled staging smoke
Owner/agent: Codex
Status: `planned`

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

TBD by implementation agent.

Expected areas:

- `apps/api/src/scripts/`
- `apps/api/src/services/telegram-delivery-service.ts`
- `apps/api/src/repositories/telegram-delivery-repository.ts`
- `package.json`
- staging compose/service docs if explicitly approved for staging
- tests/evidence docs

## Checks Run

TBD.

Expected minimum:

- `npm run typecheck`
- `npm test -- apps/api/test/telegram-delivery-service.test.ts`
- focused worker tests
- `npm run smoke:api`
- controlled staging worker smoke

## Evidence Links

- `docs/release/evidence/TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`

## Blockers

- Need explicit owner decision before enabling a long-running staging worker.
- Need worker stop/rollback instructions before production discussion.
- Need separate decision for notification sender.

## Next Action

Implement the Postgres-backed manager-reply worker as disabled-by-default staging slice, then run one controlled staging smoke where the worker, not a manual one-shot command, delivers the manager reply.
