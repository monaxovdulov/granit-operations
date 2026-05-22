# Task: Telegram manager reply supervised scheduler

ID: `TELEGRAM-MANAGER-REPLY-WORKER-SUPERVISED-SCHEDULER`
Repo: `granit-operations`
Slice: production-safe supervised delivery for manager-authored Telegram replies
Owner/agent: owner decision + Codex implementation/staging smoke
Status: `supervised staging smoke passed; not production approval`

## Короткий Вывод

Для первого production candidate выбираем не long-running worker и не внешнюю queue-систему, а более простой и контролируемый вариант:

```text
systemd timer -> one-shot deliver:telegram command -> Postgres advisory lock -> message_deliveries -> Telegram Bot API -> delivery status
```

Это решение относится только к доставке уже разрешенных ответов менеджера клиенту в Telegram. Оно не включает Telegram AI outbound и не включает sender для `manager_notification_outbox`.

## Почему Нужен Worker/Scheduler Вообще

Worker/scheduler нужен, потому что отправка в Telegram - это внешнее действие с риском. Нельзя надежно делать это прямо в webhook или в API-запросе менеджера.

Правильная модель:

```text
manager reply
  -> сохраняем conversation_message в Postgres
  -> создаем message_deliveries.pending
  -> отдельный delivery process отправляет в Telegram
  -> записывает sent/retrying/failed/blocked/uncertain
```

Главный принцип:

```text
Сначала запись в нашу БД.
Потом внешняя доставка.
Потом запись результата доставки.
```

Так manager UI и future Telegram manager bot видят честный статус доставки, а не скрытую отправку наружу.

## ADR Decision

Для первого production candidate:

- не запускать long-running `deliver:telegram:worker` в production;
- не внедрять `pg-boss`, Graphile Worker, BullMQ, Redis или другую job queue на этом этапе;
- запускать one-shot command через `systemd timer` с интервалом 30-60 секунд;
- внутри one-shot команды брать Postgres advisory lock;
- если lock занят, команда должна быстро завершиться без работы;
- `message_deliveries` остается source of truth для delivery state;
- Telegram delivery остается `at-least-once`, пока нет отдельной explicit uncertain/idempotency model;
- production launch остается заблокирован до production release bundle, backup/restore/rollback, monitoring/watch policy and explicit owner sign-off.

Почему так:

- сейчас есть один реальный job type: `telegram manager reply delivery`;
- полноценная queue-платформа сейчас преждевременна;
- `systemd timer + one-shot + Postgres lock` проще выключить, понять, проверить и откатить;
- scheduler отвечает только за запуск, а не за безопасность доставки.

## Что Scheduler НЕ Решает

`systemd timer` сам по себе не защищает от:

- double send;
- зависшего Telegram provider call;
- двух пересекающихся запусков без lock;
- retry loop;
- secret leakage в logs;
- stuck `pending/retrying`;
- rollback после частично выполненной отправки.

Поэтому runtime scheduler обязателен, но недостаточен.

## Required Hardening Before Production

### 1. Provider Timeout

Telegram Bot API `fetch` должен иметь timeout.

Зачем:

- one-shot command не должен зависать навсегда;
- `systemd` должен иметь предсказуемый верхний предел run time;
- provider/network stall не должен блокировать следующие запуски.

### 2. AbortSignal до Telegram fetch

Shutdown/cancel signal должен доходить до provider call.

Зачем:

- `SIGTERM` / systemd stop должны реально прерывать ожидание Telegram;
- deploy/restart не должен ждать неизвестно сколько.

### 3. Postgres Advisory Lock

One-shot command должен брать singleton lock на уровне Postgres.

Ожидаемое поведение:

```text
start command
  -> try advisory lock
  -> if lock busy: log and exit 0
  -> if lock acquired: process batch
  -> release lock on DB session end
```

Зачем:

- не допустить двух активных delivery runs;
- сделать operational answer простым: active run is 0 or 1;
- не полагаться только на `FOR UPDATE SKIP LOCKED` как на operational singleton.

### 4. Bounded Retry Policy

Retry должен быть ограничен.

Уже есть `TELEGRAM_DELIVERY_MAX_ATTEMPTS`, но production task должна проверить:

- attempt count увеличивается во всех ожидаемых failure paths;
- retrying rows становятся eligible только после backoff;
- exhausted retry budget переводит delivery в `failed`;
- tight loop невозможен.

### 5. Clear Status Model

Нужна понятная модель статусов:

```text
pending
processing
sent
retrying
failed
blocked_no_destination / blocked
uncertain
```

Смысл:

- `pending` - еще не брали в работу;
- `processing` - command начал attempt;
- `sent` - Telegram receipt записан;
- `retrying` - была retryable ошибка, можно повторить позже;
- `failed` - retry budget exhausted или non-retryable failure;
- `blocked_no_destination` / `blocked` - отправлять нельзя;
- `uncertain` - command начал внешнюю отправку, но результат неизвестен.

Важно:

```text
uncertain rows must not be automatically retried by default.
```

Почему: если Telegram уже отправил сообщение, автоматический retry может дать клиенту дубль.

Если schema change для `processing/uncertain` откладывается, в ADR/evidence нужно честно записать:

```text
Delivery remains at-least-once; crash after Telegram send and before DB sent record can cause duplicate customer message.
```

Для production предпочтительно не замалчивать этот риск, а сделать его visible через `uncertain`.

### 6. No Secret Logs

Logs/evidence не должны содержать:

- `TELEGRAM_BOT_TOKEN`;
- `DATABASE_URL`;
- raw private chat id;
- webhook secret;
- private customer data beyond sanitized evidence.

Нужно проверить не только happy path, но и provider/DB error logs.

### 7. Stop/Rollback Runbook

Нужен отдельный runbook:

Stop:

```text
1. Stop systemd timer first.
2. Stop any active one-shot service run if needed.
3. Verify no new runs start.
4. Inspect pending/retrying/processing/uncertain counts.
5. Preserve evidence rows.
```

Rollback:

```text
1. Stop timer first.
2. Inspect latest delivery state.
3. Deploy previous approved revision/image.
4. Restart API if needed.
5. Do not delete sent/evidence rows.
6. Do not blindly reset uncertain/retrying rows to pending.
```

Почему: Telegram send is external and cannot be undone.

### 8. Supervised Staging Smoke

Нужен новый smoke именно supervised режима, не ручного terminal run.

Проверки:

- `systemd timer` запускает one-shot command;
- lock prevents overlapping run;
- fake manager-authored `pending` delivery becomes `sent`;
- `sent` row is not re-sent after restart;
- stop/restart works;
- provider timeout path is tested or simulated;
- crash/unknown result behavior is tested or documented;
- logs contain no secrets;
- DB before/after captured;
- Telegram receipt persisted;
- evidence explicitly says this is not production approval.

## Runtime Profile

Worker/scheduler disabled by default. Production/staging включение только через явный runtime profile.

Required env names:

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID`
- `TELEGRAM_DELIVERY_BATCH_SIZE`
- `TELEGRAM_DELIVERY_MAX_ATTEMPTS`
- `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS`
- optional one-shot/provider timeout env if added

Recommended first production candidate behavior:

```text
timer interval: 30-60 seconds
batch size: conservative, e.g. 5-10
max attempts: 3
retry backoff: at least 60 seconds; production may use 2-5 minutes
```

## Observability Requirements

Нужны structured logs and DB checks for:

- worker run started;
- lock acquired / lock busy;
- claimed count;
- sent count;
- retrying count;
- failed count;
- blocked count;
- uncertain count;
- run duration;
- provider error class/status;
- timeout/cancel event.

Нужны operator queries/checks:

```text
pending count
oldest pending age
retrying count
failed count
blocked count
uncertain count
last successful run time
last failed run time
```

Minimum alert/watch conditions:

- oldest pending age too high;
- failed count increased;
- uncertain count > 0;
- no successful run within expected window;
- repeated Telegram 429/5xx.

## When To Revisit pg-boss / Graphile Worker

Не внедрять queue framework сейчас.

Пересмотреть решение, если появляется 3+ recurring/background job types или если retry/scheduling/concurrency logic начинает дублироваться.

Examples:

- `telegram-delivery`;
- `telegram-media-download`;
- `voice-transcription`;
- `image-analysis`;
- `scheduled-followup`;
- `manager-reminder`.

Тогда Postgres-backed queue вроде `pg-boss` или Graphile Worker может быть оправдана.

## AI Handoff Policy Decision Captured Separately

В обсуждении также зафиксировано будущее product/AI правило. Оно не входит в реализацию Telegram delivery scheduler, но важно для следующих AI задач.

Handoff должен быть настраиваемым между двумя безопасными режимами:

### Mode 1: `manager_queue_only`

AI пишет клиенту:

```text
Передам диалог менеджеру, он свяжется с вами.
```

Система:

- останавливает AI auto-replies for conversation;
- переводит заявку/диалог в очередь менеджера;
- пишет handoff event в timeline.

### Mode 2: `company_contact_plus_queue`

AI может дать только owner-approved официальный контакт компании:

- рабочий WhatsApp;
- рабочий телефон;
- официальный Telegram компании.

Система все равно:

- останавливает AI auto-replies;
- ставит заявку менеджеру на контроль;
- пишет факт выдачи контакта в историю.

Hard invariant:

```text
contact sharing is optional;
manager handoff is mandatory.
```

В v1 запрещено:

- AI сам придумывает контакт;
- AI выдает личный контакт конкретного менеджера;
- AI продолжает автоответы после handoff;
- AI дает контакт, но не ставит заявку менеджеру.

Это решение должно быть вынесено в отдельную AI/handoff task перед реализацией AI outbound или manager handoff automation.

## Out Of Scope

- Telegram AI outbound.
- Sender для `manager_notification_outbox`.
- Telegram media processing.
- Voice transcription.
- Image analysis.
- pg-boss / Graphile Worker migration.
- Personal manager contact sharing.
- Production approval.
- Secrets rotation.
- Full deploy platform refactor.
- Изменение бизнес-логики AI.

## Files Changed During Implementation

- `apps/api/src/scripts/deliver-telegram-pending-once.ts`
- `apps/api/src/services/telegram-delivery-service.ts`
- `apps/api/src/services/postgres-advisory-lock.ts`
- `apps/api/src/services/telegram-delivery-worker.ts`
- `apps/api/src/repositories/telegram-delivery-repository.ts`
- `apps/api/src/config.ts`
- `apps/api/test/telegram-delivery-service.test.ts`
- `apps/api/test/telegram-delivery-worker.test.ts`
- `apps/manager/src/App.tsx`
- `apps/manager/src/types.ts`
- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `packages/db/migrations/0009_telegram_delivery_processing_uncertain.sql`
- `deploy/systemd/granit-telegram-delivery-once.service`
- `deploy/systemd/granit-telegram-delivery-once.timer`
- `docs/ENVIRONMENT.md`
- `docs/adr/*`
- `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`

Do not touch unrelated dirty changes.

## Implementation Result

- One-shot `npm run deliver:telegram:once` now takes a Postgres session-level advisory lock.
- Lock busy exits `0` without claiming work.
- Provider timeout and shutdown `AbortSignal` reach Telegram `fetch`.
- `message_deliveries` supports `processing` and `uncertain`.
- `uncertain` rows are visible in API/UI and are not auto-retried.
- Systemd service/timer templates are repo-tracked but not installed/enabled by this implementation.
- No Telegram AI outbound, `manager_notification_outbox` sender, media processing, AI business logic, or queue framework was added.

## Required Checks

Local:

| Check | Result |
|---|---|
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed, 12 tests |
| `npm run typecheck` | passed |
| `npm run smoke:api` | passed, 36 tests |
| `npm test` | passed, 55 tests |
| `systemd-analyze verify deploy/systemd/granit-telegram-delivery-once.service deploy/systemd/granit-telegram-delivery-once.timer` | passed |
| `git diff --check` | passed |

Staging/supervised:

| Check | Result |
|---|---|
| staging `docker compose ... build ops-api` and `up -d ops-api` | passed |
| staging migration `0009_telegram_delivery_processing_uncertain.sql` | passed |
| rootless staging user timer install/enable | passed; timer enabled and active |
| Postgres advisory lock busy behavior | passed; service exited `0` with `telegram_delivery_lock_busy` |
| stale `processing` timeout/cancel recovery | passed; fake delivery became `uncertain` |
| timer-triggered manager-authored delivery | passed; fake pending delivery became `sent` with provider receipt |
| stop timer first, then service | passed; timer list returned `0 timers listed` |
| restart/no-resend | passed; next run claimed `0`, previous `sent` row stayed `attempt_count=1` |
| no secret logs grep | passed |

## Evidence

Created/updated:

```text
docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md
```

Evidence includes:

- exact runtime model;
- service/timer names;
- env names without values;
- DB before/after;
- sanitized logs;
- Telegram receipt confirmation;
- lock behavior proof;
- stop/rollback proof;
- known at-least-once / uncertain limitations;
- explicit statement: not Telegram AI outbound, not notification sender, not production approval unless separate production gate is signed.

## Next Action

Do not expand this scheduler into Telegram AI outbound or `manager_notification_outbox`.
The next production-readiness step is a separate release bundle:

```text
Source of truth:
- docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md
- docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md
- docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md

Required before production approval:
- backup/restore evidence;
- rollback evidence for the concrete release;
- monitoring/watch policy;
- owner-readable release bundle;
- explicit owner sign-off.
```
