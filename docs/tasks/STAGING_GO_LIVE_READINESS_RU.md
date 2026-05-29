# Task: STAGING-GO-LIVE-READINESS - Боевое включение на staging

Status: in_progress; backup/restore proof deferred by owner on 2026-05-29 because there are currently no customers; task 2 rollback documented; task 3 manual `uncertain` runbook documented; task 4 readiness bundle signed off by owner for task 5 only; task 5 supervised staging enablement is authorized but blocked in this session by missing staging SSH public-key access; server-agent handoff created; production and real-customer staging traffic remain blocked
Created: 2026-05-29
Repo: `granit-operations`
Slice: staging go-live readiness after Telegram manager reply worker and AI-S07
Owner/agent: owner decision + Codex implementation later

## Цель

Явная цель следующего блока: боевое включение на staging.

Под "боевым включением на staging" понимается production-like staging path: staging использует реальные app-owned сценарии сохранения заявок, диалогов, manager takeover, manager-authored Telegram delivery и operator runbooks, но без production traffic и без production approval.

Update 2026-05-29: владелец подтвердил, что клиентов сейчас нет, поэтому live backup/restore proof для staging DB можно отложить. Это снижает срочность task 1, но не является evidence, не разрешает production и не разрешает включать реальные customer-facing staging paths без возврата к backup/restore proof.

Progress update 2026-05-29: task 2 partial Telegram delivery rollback is documented in `docs/BACKUP_RESTORE_ROLLBACK.md`. Task 3 manual `message_deliveries.status='uncertain'` handling is documented in `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`.

Progress update 2026-05-29: task 4 readiness bundle is drafted below as a docs-only owner sign-off gate. No SSH, staging runtime, DB, sender, AI handoff, Mastra, notification sender, Telegram AI outbound, deploy, migration, or secret operation is part of this task.

Owner sign-off update 2026-05-29: owner approved moving to task 5 after clarifying that the allowed flow is only `Telegram customer -> Telegram bot -> manager reply -> Telegram bot -> same Telegram customer`. This is not approval for `website/widget customer -> Telegram reply`, manager Telegram notifications, production, AI-authored Telegram outbound, notification sender, AI handoff expansion, Mastra, DB changes, secret changes, or public contract changes.

Task 5 attempt update 2026-05-29: this session verified the repo-local scheduler templates and focused delivery tests, but could not perform staging runtime enablement because `devuser@giorno.aeza.network` rejected the available local SSH keys with `Permission denied (publickey)`. The host key was not previously present locally and was accepted with `StrictHostKeyChecking=accept-new`. No staging runtime, DB, env, secret, sender, notification, AI, Mastra, deploy, migration, public contract, production, or real-customer traffic change was performed. Server-agent handoff: `https://github.com/monaxovdulov/ai-homebase/issues/40`.

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

Status: documented in `docs/BACKUP_RESTORE_ROLLBACK.md`; not backup/restore proof and not production approval.

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

Status: documented in `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`; not production approval.

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

Status: signed off by owner on 2026-05-29 for task 5 only; no runtime enablement performed in this docs task.

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

#### Owner Summary

This bundle is a staging readiness gate, not an execution log.

It allows the owner to decide whether the next task may start supervised staging enablement for the already-proven manager-authored Telegram reply path:

```text
manager reply -> Postgres conversation_message -> message_deliveries -> supervised one-shot -> Telegram Bot API -> sent/retrying/failed/blocked/uncertain
```

It does not approve production, customer-facing staging traffic with real customers, Telegram AI outbound, notification sender work, AI handoff expansion, Mastra, DB changes, secrets changes, or direct provider sends from webhook/API request handlers.

Backup/restore proof remains deferred only under the current owner assumption that there are no customers in this staging Telegram path. If real customers or production-like customer traffic are introduced, task 1 must be completed before sign-off is used.

#### Evidence Map

Core staging path:

| Area | Current evidence | Owner-readable meaning |
|---|---|---|
| Public site form intake | `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` | Site form can persist a lead before returning public success; manager can see it. |
| Manager auth/session | `docs/release/evidence/S02_MANAGER_AUTH_YANDEX_RU.md` | Manager data is behind Yandex ID plus operations allowlist/session checks. |
| Manager UI | `docs/release/evidence/S03_MANAGER_UI_MANTINE_RU.md` | Protected manager UI shell and APIs were checked on staging. |
| Manager lifecycle/history | `docs/release/evidence/S03_MIN_LIFECYCLE_RU.md` | Minimal statuses and timeline history work through protected manager API. |
| Website widget persistence | `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md` | Widget messages persist before public success and are manager-visible. |
| Website safe AI / takeover | `docs/release/evidence/S05_WEBSITE_SAFE_AI_RU.md`, `docs/release/evidence/S06_MANAGER_TAKEOVER_RU.md` | Website AI is guarded by policy, disabled default/config gates, and manager takeover stop-AI behavior. |
| Channel-neutral conversation foundation | `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` | Widget and Telegram share app-owned conversation/message/takeover state. |

Telegram manager-reply safety:

| Area | Current evidence | Owner-readable meaning |
|---|---|---|
| Telegram inbound + mini-panel | `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md` | Telegram inbound, manager binding, takeover, and pending manager replies were reviewed; webhook does not send provider messages. |
| Manual delivery sender | `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md` | Separate sender delivers already-persisted manager replies and records delivery status. |
| Explicit worker | `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md` | Controlled staging worker smoke passed for manager-authored replies only. |
| Supervised scheduler | `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md` | User systemd timer + one-shot + advisory lock smoke passed; not production approval. |
| Partial delivery rollback | `docs/BACKUP_RESTORE_ROLLBACK.md` | `sent`/`uncertain` rows are preserved as evidence; Telegram sends are not treated as reversible. |
| Manual `uncertain` policy | `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md` | `uncertain` is handled by operator decision and timeline evidence, not blind retry/reset. |

Decision records:

| ADR | Decision |
|---|---|
| `docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md` | `manager.botops.ru` is the accepted staging manager domain. |
| `docs/adr/ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md` | Explicit worker is accepted for controlled staging use, not production. |
| `docs/adr/ADR-003-TELEGRAM-MANAGER-REPLY-SUPERVISED-SCHEDULER_RU.md` | Production-candidate shape is supervised one-shot scheduler + Postgres advisory lock; still not production approval. |

#### Staging Paths In This Bundle

Paths that have supporting evidence and may be part of the staging picture after owner sign-off:

| Path | Readiness status | Enablement rule |
|---|---|---|
| Public site form intake `site_form.v1` | Accepted staging evidence exists. | Keep within the already documented public contract; no contract change in this task. |
| Protected manager login/UI/status history | Accepted staging evidence exists. | Keep manager data behind session/allowlist; keep staging noindex behavior. |
| Website widget persistence | Staging evidence exists. | Persist first; public response must remain safe and non-internal. |
| Website safe AI replies | Evidence exists, default/config gated. | Do not change AI config in this task; no production AI approval. |
| Manager takeover / stop-AI gate | Evidence exists. | Keep manager takeover as app-owned state; no text-only handoff. |
| Telegram inbound and manager mini-panel | Prep evidence exists; Telegram path uses app-owned state. | Webhook must not call Telegram `sendMessage`; no notification sender in this path. |
| Manager-authored Telegram reply delivery | Sender/worker/scheduler evidence exists. | Only already-persisted manager replies may be delivered; task 5 must enable supervised staging explicitly after sign-off. |

Explicitly disabled or blocked:

- production deploy or production traffic;
- customer-facing staging traffic with real customers until backup/restore proof is completed;
- Telegram AI outbound;
- notification sender for `manager_notification_outbox`;
- AI handoff expansion or manager-visible handoff redesign;
- Mastra runtime, Mastra Studio, traces/evals rollout;
- direct Telegram Bot API calls from webhook, manager API request handlers, shell resend workarounds, or AI code;
- new DB schema/migration/env/secret changes inside this readiness task;
- public contract changes;
- raw logs, DB URLs, tokens, private chat ids, customer PII, or secret values in evidence.

#### Env Inventory Without Values

Owner/operator must verify names only. Do not paste values into docs, chat, logs, issues, or evidence.

Core API/manager:

- `DATABASE_URL`
- `SESSION_SECRET`
- `YANDEX_OAUTH_CLIENT_ID`
- `YANDEX_OAUTH_CLIENT_SECRET`
- `YANDEX_OAUTH_REDIRECT_URI`
- `MANAGER_AUTH_ALLOWED_ORIGINS`

Public intake/widget:

- `PUBLIC_INTAKE_ALLOWED_ORIGINS`
- `PUBLIC_INTAKE_CONTRACT_VERSION`
- `AI_WIDGET_ENABLED`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Telegram inbound/delivery:

- `TELEGRAM_BOT_ENABLED`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `PUBLIC_MANAGER_BASE_URL`
- `TELEGRAM_DELIVERY_BATCH_SIZE`
- `TELEGRAM_DELIVERY_MAX_ATTEMPTS`
- `TELEGRAM_DELIVERY_RETRY_BACKOFF_MS`
- `TELEGRAM_DELIVERY_PROVIDER_TIMEOUT_MS`
- `TELEGRAM_DELIVERY_PROCESSING_STALE_MS`

Explicitly not enabled by this bundle:

- `URGENT_NOTIFICATION_DESTINATION` remains blocked until notification sender scope is approved.
- `BACKUP_STORAGE_URL` remains future/deferred until backup/restore proof is actually implemented and evidenced.

#### Stop / Rollback Summary

Canonical procedure is in `docs/BACKUP_RESTORE_ROLLBACK.md` and `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`.

Owner-readable stop order:

1. Stop Telegram delivery scheduler timer first.
2. Stop active one-shot service second if it is running.
3. Confirm no new scheduler runs will start.
4. Capture sanitized delivery counts, not secrets or private chat ids.
5. Roll back code to the previous approved API revision/image only after the delivery scheduler is stopped.
6. Preserve `message_deliveries`, `conversation_messages`, `conversations`, `channel_identities`, `leads`, and `lead_timeline_events`.
7. Do not rewrite `sent` rows; they prove Telegram accepted the send.
8. Do not reset `uncertain` rows; use the manual `uncertain` runbook and record owner-visible timeline evidence.
9. Confirm no duplicate send happened after restart/rollback.
10. Record a short owner-readable evidence note with sanitized counts, decision, and remaining risk.

If public intake or widget intake fails, public UI must show retry/fallback contact guidance instead of success until persistence is proven again.

#### Known Limitations

- Backup/restore proof is deferred, not passed.
- This bundle is not production approval and does not satisfy production G01-G17 gates.
- Monitoring/watch policy for production approval is still incomplete.
- Existing `uncertain` rows, if any, require the runbook decision path before they can be considered resolved.
- Telegram media processing, notification sender, Telegram AI outbound, AI handoff expansion, Mastra, and production AI remain outside this staging bundle.
- A dirty working tree is a release blocker; docs-only readiness changes must be reviewed separately from runtime changes.
- Customer-facing staging with real customers requires returning to backup/restore proof before relying on this sign-off.

#### Staging Sign-Off

Owner sign-off was captured in chat on 2026-05-29 after scope clarification.

Before sign-off, owner must confirm:

- task 2 rollback procedure is understood and acceptable for partial Telegram delivery;
- task 3 `uncertain` runbook is understood and acceptable for unknown Telegram delivery results;
- backup/restore proof is either completed or explicitly deferred because there are still no customers in this staging Telegram path;
- task 5 may start only the supervised staging enablement for manager-authored Telegram replies;
- notification sender, AI handoff expansion, Mastra, Telegram AI outbound, production deploy, DB changes, secret changes, and public contract changes remain blocked.

Sign-off record:

```text
Owner: project owner, confirmed in chat
Date: 2026-05-29
Decision: approved for next task only
Approved scope: supervised staging enablement for manager-authored Telegram replies only
Allowed customer flow: Telegram customer -> Telegram bot -> manager reply -> Telegram bot -> same Telegram customer
Not approved: website/widget customer -> Telegram reply, manager Telegram notifications, production, real-customer staging traffic, Telegram AI outbound, notification sender, AI handoff expansion, Mastra, DB changes, secret changes, public contract changes
Backup/restore proof: deferred only while there are no customers in this staging Telegram path
Notes: task 5 may verify/start supervised scheduler only for already-persisted manager-authored Telegram replies; this sign-off is not production approval.
```

### 5. Supervised staging enablement

Status: authorized by owner for the narrow manager-authored Telegram reply path, but blocked in this session by missing SSH public-key access to `devuser@giorno.aeza.network`; server-agent handoff pending in `https://github.com/monaxovdulov/ai-homebase/issues/40`. No staging runtime enablement was performed from this session.

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
- `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `git diff --check` | passed | Documentation-only readiness bundle update |
| `git diff --check` | passed | Documentation-only owner sign-off update |
| `systemd-analyze verify deploy/systemd/granit-telegram-delivery-once.service deploy/systemd/granit-telegram-delivery-once.timer` | passed | Repo-local scheduler unit/timer syntax before task 5 handoff |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed, 12 tests | Focused Telegram delivery service/worker tests before task 5 handoff |
| `git diff --check` | passed | Task 5 attempt / handoff documentation update |

## Evidence Links

- `docs/tasks/TELEGRAM_POST_SUPERVISED_SCHEDULER_NEXT_TASKS_RU.md`
- `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- `docs/BACKUP_RESTORE_ROLLBACK.md`
- `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`
- `https://github.com/monaxovdulov/ai-homebase/issues/40`

## Blockers

- Staging go-live with customer-facing traffic remains blocked until backup/restore proof, partial-send rollback procedure, `uncertain` runbook and readiness bundle are accepted.
- Task 4 readiness bundle is signed off only for task 5 supervised staging enablement of manager-authored Telegram replies.
- Task 5 runtime enablement is blocked in this session because the available local SSH keys are not authorized for `devuser@giorno.aeza.network`; server-agent handoff is queued in `https://github.com/monaxovdulov/ai-homebase/issues/40`.
- Backup/restore proof is explicitly deferred only while there are no customers and no production approval.
- Production remains blocked after staging go-live until separate production gates, backup/restore/rollback evidence and explicit owner sign-off.

## Next Action

Continue task 5 from an environment with authorized staging SSH access, using the server-agent handoff in `https://github.com/monaxovdulov/ai-homebase/issues/40`, only for manager-authored Telegram replies in the Telegram-bot customer channel. Return to task 1 before real customers, production-like customer traffic, or production approval. Do not start notification sender, AI handoff expansion, Mastra or Telegram AI outbound before the staging safety path is accepted.
