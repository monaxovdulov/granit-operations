# Task: STAGING-GO-LIVE-READINESS - Боевое включение на staging

Status: in_progress; backup/restore proof deferred by owner on 2026-05-29 because there are currently no customers; production/staging customer traffic remains blocked
Created: 2026-05-29
Repo: `granit-operations`
Slice: staging go-live readiness after Telegram manager reply worker and AI-S07
Owner/agent: owner decision + Codex implementation later

## Цель

Явная цель следующего блока: боевое включение на staging.

Под "боевым включением на staging" понимается production-like staging path: staging использует реальные app-owned сценарии сохранения заявок, диалогов, manager takeover, manager-authored Telegram delivery и operator runbooks, но без production traffic и без production approval.

Update 2026-05-29: владелец подтвердил, что клиентов сейчас нет, поэтому live backup/restore proof для staging DB можно отложить. Это снижает срочность task 1, но не является evidence, не разрешает production и не разрешает включать реальные customer-facing staging paths без возврата к backup/restore proof.

Это не разрешает:

- production deploy;
- Telegram AI outbound;
- Mastra runtime;
- изменение public contracts, DB schema, migrations, env names или production config без отдельной задачи;
- отправку уведомлений менеджерам из `manager_notification_outbox` внутри Telegram customer-reply sender;
- ответы AI по ценам, срокам, гарантиям, договорам, скидкам, наличию, оплате или legal темам.

## Очередность

### 1. Backup / restore proof для staging DB - deferred now

Бизнес-смысл: если staging enablement или обновление пойдет плохо, заявки, клиенты, диалоги и история не должны потеряться.

Сделать:

- создать резервную копию staging Postgres;
- восстановить ее в отдельное тестовое место;
- проверить, что заявки, диалоги, сообщения, takeover state, `message_deliveries` и timeline events на месте;
- записать owner-readable evidence без secrets и customer PII.

Acceptance:

- restore smoke доказал, что manager-visible state не потерян;
- evidence содержит команды/шаги, что проверялось и что не проверялось;
- production approval не подразумевается.

Current deferral:

- deferred on 2026-05-29 by owner because there are currently no customers;
- not accepted and not counted as restore evidence;
- must be completed before real customer traffic, production-like staging sign-off, or production approval.

### 2. Rollback после частичной Telegram delivery

Бизнес-смысл: Telegram send нельзя "откатить" как код. Если часть сообщений уже ушла клиенту, система не должна потерять факт отправки или отправить дубль.

Сделать:

- описать rollback procedure для случая, когда deploy/worker сломался после части `sent`;
- явно запретить удалять или перезаписывать `sent` rows;
- сохранить правило для `uncertain`: не переводить blindly обратно в `pending`;
- описать kill switch/stop order для staging worker/timer.

Acceptance:

- rollback procedure не предлагает обратимо "откатить" внешний Telegram send;
- `sent` и `uncertain` считаются delivery evidence;
- после rollback не появляется автоматический дубль клиенту.

### 3. Manual `uncertain` delivery runbook

Бизнес-смысл: если система не уверена, принял ли Telegram сообщение, оператор должен проверить факт вручную и записать решение.

Сделать:

- описать DB query для поиска `message_deliveries.status='uncertain'`;
- описать, что оператор проверяет в Telegram и manager history;
- описать decision tree: `no-op`, manual resend, owner decision;
- записывать решение в timeline event `conversation.delivery_uncertain_resolution`;
- оставить original `uncertain` row как evidence.

Acceptance:

- `uncertain` не auto-retry и не reset без проверки;
- procedure предотвращает случайный дубль клиенту;
- решение видно владельцу/менеджеру как evidence.

### 4. Staging go-live readiness bundle

Бизнес-смысл: владелец должен одним документом понять, что включается на staging, какие риски остаются, как выключить и кто отвечает.

Сделать:

- собрать ссылки на task docs, ADR, runbooks and evidence;
- перечислить enabled staging paths и explicitly disabled paths;
- добавить env inventory without values;
- добавить stop/rollback steps;
- добавить known limitations;
- добавить explicit staging sign-off section.

Acceptance:

- документ разделяет staging go-live и production approval;
- владелец видит, что именно включается и что остается заблокировано;
- backup/restore/rollback and `uncertain` evidence linked before sign-off.

### 5. Supervised staging enablement

Бизнес-смысл: после доказанных safety procedures staging должен работать не как ручной эксперимент, а как управляемый staging runtime.

Сделать:

- использовать уже принятое controlled staging worker smoke evidence;
- подтвердить, какой staging service/timer/worker profile включается;
- проверить stop timer first, then service;
- проверить no-overlap advisory lock behavior;
- проверить, что `sent` не переотправляется после restart;
- записать before/after status counts по `pending`, `processing`, `sent`, `retrying`, `failed`, `blocked`, `uncertain`.

Acceptance:

- staging worker/scheduler включен только после sign-off из readiness bundle;
- no-secret logs;
- Telegram AI outbound and notification sender remain disabled.

### 6. Manager notification sender

Бизнес-смысл: менеджер должен получать уведомление, когда клиент написал, но это другой поток, не customer reply delivery.

Сделать отдельно после staging safety path:

- читать только `manager_notification_outbox`;
- не отправлять из Telegram webhook напрямую;
- поддержать bounded retry/status/evidence;
- не смешивать с `message_deliveries` customer reply sender.

Acceptance:

- notification sender не может отправить ответ клиенту;
- no destination -> `blocked_no_destination`;
- provider errors пишутся в notification outbox status;
- Telegram AI outbound остается blocked.

### 7. AI handoff policy / manager-visible handoff

Бизнес-смысл: AI не должен делать вид, что передал диалог менеджеру, если app-owned state and manager-visible item не созданы.

Сделать отдельно:

- решить режимы `manager_queue_only` и `company_contact_plus_queue`;
- запретить AI придумывать контакты или давать личные контакты менеджеров;
- сделать manager handoff manager-visible state, not text-only;
- сохранить stop-AI behavior after handoff;
- добавить focused tests/evals.

Acceptance:

- handoff создает app-owned manager-visible reason/state;
- AI auto-replies останавливаются после handoff;
- price/deadline/warranty/contract/discount/availability/payment/legal remain blocked/fallback.

## Out Of Scope

- Production approval.
- Production traffic.
- Telegram AI outbound.
- Mastra runtime or Mastra Studio.
- Notification sender before safety gates.
- Public contract changes.
- Production DB schema/config/env changes.
- Secrets rotation.

## Files Touched

- `docs/tasks/STAGING_GO_LIVE_READINESS_RU.md`
- `docs/BACKUP_RESTORE_ROLLBACK.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `git diff --check` | passed | Documentation-only defer/rollback update |

## Evidence Links

- `docs/tasks/TELEGRAM_POST_SUPERVISED_SCHEDULER_NEXT_TASKS_RU.md`
- `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- `docs/BACKUP_RESTORE_ROLLBACK.md`

## Blockers

- Staging go-live with customer-facing traffic remains blocked until backup/restore proof, partial-send rollback procedure, `uncertain` runbook and readiness bundle are accepted.
- Backup/restore proof is explicitly deferred only while there are no customers and no production approval.
- Production remains blocked after staging go-live until separate production gates, backup/restore/rollback evidence and explicit owner sign-off.

## Next Action

Continue with docs-only task 2/3: partial Telegram delivery rollback procedure and manual `uncertain` handling. Return to task 1 before real customers, production-like staging sign-off, or production approval. Do not start notification sender, AI handoff expansion, Mastra or Telegram AI outbound before the staging safety path is accepted.
