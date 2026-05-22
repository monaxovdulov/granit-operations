# Task: TELEGRAM-POST-SUPERVISED-SCHEDULER-NEXT-TASKS - Следующие Telegram/production-readiness задачи

Status: planned; task 1 accepted after supervised staging smoke
Created: 2026-05-22
Repo: `granit-operations`
Slice: Telegram operations after supervised scheduler merge
Owner/agent: owner decision + Codex implementation later

## Цель

Зафиксировать следующий порядок работ после merge `TELEGRAM-MANAGER-REPLY-WORKER-SUPERVISED-SCHEDULER`, чтобы не смешать production-readiness, manager notification sender и будущую AI/handoff логику в один рискованный срез.

Главный принцип:

```text
Сначала доказать и уметь остановить текущий manager-authored Telegram delivery path.
Потом добавлять новые sender/job types.
AI outbound и handoff automation только отдельными задачами.
```

## Scope

### 1. Supervised staging smoke для scheduler

Status: accepted on 2026-05-22 as staging evidence, not production approval.

Проверить уже смерженный runtime:

- применить migration `0009_telegram_delivery_processing_uncertain.sql` на staging;
- установить `granit-telegram-delivery-once.service` и `granit-telegram-delivery-once.timer`;
- проверить запуск timer -> one-shot;
- проверить Postgres advisory lock busy behavior;
- проверить stop timer first, then service;
- проверить restart behavior;
- симулировать или доказать timeout/cancel path;
- записать DB before/after по `pending`, `processing`, `sent`, `retrying`, `failed`, `blocked`, `uncertain`;
- доказать no-secret logs;
- обновить supervised scheduler evidence.

Acceptance:

- timer запускает one-shot без ручного terminal run;
- lock не допускает overlapping run;
- manager-authored pending delivery доставляется один раз;
- `sent` row не переотправляется после restart;
- timeout/cancel переводит delivery в `uncertain`;
- evidence явно говорит: not production approval.

### 2. Manual policy/runbook для `uncertain`

Сделать операторскую процедуру для неясных доставок:

- как увидеть `uncertain` в DB/manager UI;
- что проверять перед ручной переотправкой;
- кто принимает решение retry/resend/no-op;
- как записывать решение в evidence/timeline;
- что запрещено делать с `uncertain`.

Acceptance:

- `uncertain` не reset-ится blindly в `pending`;
- процедура предотвращает случайный дубль клиенту;
- runbook понятен без чтения кода.

### 3. `manager_notification_outbox` sender

Отдельно реализовать отправку уведомлений менеджерам:

- читать только `manager_notification_outbox`;
- не отправлять из Telegram webhook напрямую;
- поддержать bounded retry/status/evidence;
- записывать provider receipt;
- не смешивать с customer reply delivery.

Acceptance:

- входящее Telegram-сообщение сначала сохраняется в Postgres;
- notification sender отправляет только из persisted outbox;
- no destination -> `blocked_no_destination`;
- provider errors пишутся в outbox status;
- no Telegram AI outbound.

### 4. Backup / restore / rollback proof

Закрыть production blocker для operational data:

- Postgres backup proof;
- restore smoke;
- rollback после частичной Telegram delivery;
- правило сохранения `sent`/`uncertain` rows;
- owner-readable evidence.

Acceptance:

- rollback не удаляет и не перезаписывает delivery evidence;
- restore smoke показывает, что manager-visible state не потерян;
- procedure не предлагает “откатить Telegram send” как обратимое действие.

### 5. Production readiness bundle

Собрать owner-readable bundle перед любым production sign-off:

- ссылки на Telegram task/evidence/ADR/runbook;
- env inventory without values;
- supervised smoke;
- backup/restore/rollback proof;
- known limitations;
- explicit owner sign-off section.

Acceptance:

- owner может прочитать один bundle и понять, что включается;
- bundle явно разделяет staging evidence и production approval;
- G01-G17/backup/rollback gaps не скрыты.

### 6. AI handoff policy task

Отдельно описать и потом реализовать безопасный handoff, не Telegram AI outbound:

- режим `manager_queue_only`;
- режим `company_contact_plus_queue`;
- AI не придумывает контакты;
- AI не дает личные контакты менеджеров;
- manager handoff обязателен;
- факт handoff/contact sharing виден менеджеру.

Acceptance:

- contact sharing optional, manager handoff mandatory;
- AI auto-replies останавливаются после handoff;
- timeline/evidence показывает, почему диалог ушел менеджеру;
- Telegram AI outbound по-прежнему blocked до отдельной approval.

### 7. Cleanup merged scheduler branch

После проверки, что `main` содержит merge `1a17f64`, убрать feature branch:

- delete remote `origin/codex/telegram-supervised-scheduler`;
- delete local branch after switching away from it;
- не удалять merge commit и evidence.

Acceptance:

- `main` остается source of truth;
- branch cleanup не меняет runtime/docs;
- local worktree remains clean.

## Out Of Scope

- Production approval.
- Telegram AI outbound.
- `manager_notification_outbox` sender внутри supervised scheduler task.
- Telegram media processing.
- pg-boss / Graphile Worker / BullMQ / Redis migration.
- Secrets rotation.
- Full deploy platform refactor.
- Изменение AI business logic без отдельного AI/handoff task.

## Files Touched

- `docs/tasks/TELEGRAM_POST_SUPERVISED_SCHEDULER_NEXT_TASKS_RU.md`
- `docs/tasks/README.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `git diff --check` | passed | Documentation-only task pack |

## Evidence Links

- Supervised scheduler task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Supervised scheduler evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Supervised scheduler ADR: `docs/adr/ADR-003-TELEGRAM-MANAGER-REPLY-SUPERVISED-SCHEDULER_RU.md`
- Supervised scheduler runbook: `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`
- Worker evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`

## Blockers

- Production system-level timer install/sign-off remains separate from the rootless staging timer smoke.
- `uncertain` manual policy needs owner-visible decision before production use.
- Notification sender is a separate implementation and evidence slice.
- Backup/restore/rollback proof is still required before production.
- AI handoff policy must be decided before any AI outbound expansion.

## Next Action

Continue with task 2: define the manual policy/runbook for `uncertain` rows before any production approval or notification sender work.
