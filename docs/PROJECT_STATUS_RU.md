# granit-operations - Статус Репозитория

Обновлено: 2026-08-04T22:00:00Z

Этот репозиторий отвечает за рабочую систему бизнеса: intake API, Postgres operational state, manager backend/panel, AI workflows, Telegram delivery, observability/evals.

## Карта Репозиториев

- `granit-operations` — backend/API, Postgres operational state, manager panel, AI runtime, send gate, CORS and observability/evals.
- `monaxovdulov/landing-granit-static` (`/home/devuser/ai-projects/landing-granit-static`) — текущий customer-facing лендинг и browser form/widget integration для staging smoke с заказчиками.
- `monaxovdulov/business-ai-web-widget` — source repo для текущего browser widget runtime; staging baseline использует `@monaxovdulov/site-widget@1.1.4` из `c44f99637e097a47b3c53099c95d7e8e01701ad8`.
- `granit-site-cms` — не текущий источник customer-facing лендинга для AI/widget rollout; считать отдельным Astro/CMS baseline/future CMS path, пока новая ADR/task явно не изменит это.

Актуальное правило зафиксировано в `docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`.

## Главный Статус

`granit-operations` сейчас не production-ready, но основной staging путь сильно продвинулся дальше старого S04.

Что уже доказано:

1. S01: сайтовая форма принимает обращение, сохраняет заявку в Postgres, менеджер видит ее.
2. S02/S03: менеджерский вход через Яндекс ID, русская панель, карточка заявки, статусы и история прошли staging checks.
3. S04/S05/S06: website widget baseline сохраняет сообщение до AI, имеет safe AI fallback и takeover/send-time gate для website path.
4. P0: channel-neutral conversation foundation merged; widget и Telegram используют общий контур заявка / conversation / message / takeover.
5. Telegram inbound + manager mini-panel reviewed locally; Telegram не становится отдельной CRM.
6. Telegram outbound delivery sender accepted after controlled staging smoke for manager-authored replies.
7. Telegram manager reply worker accepted after local checks and controlled staging worker smoke.
8. Telegram supervised scheduler passed staging smoke as `systemctl --user` timer + one-shot + Postgres advisory lock: migration applied, lock busy/uncertain/stop/restart/no-resend checked.
9. AI roadmap PR0a-PR2 реализовал real PostgreSQL harness, canonical AI
   migrations, bounded hotfixes, turn identity/commit fence и latest-wins fresh
   context на app-owned durable queue. Direct runtime остаётся default; Mastra
   ограничен bounded staging adapter ролью.

Что это означает: путь "менеджер написал ответ -> Postgres delivery state -> Telegram sendMessage -> sent/retrying/failed/blocked status" проверен для manager-authored replies. Это не approval для Telegram AI outbound и не production approval.

## Текущая Стадия

| Область | Статус | Доказательство |
|---|---|---|
| Public intake / S01 | `accepted for staging acceleration` | `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` |
| Manager auth/UI/status history / S02-S03 | `accepted for staging acceleration` | `docs/release/evidence/S02_MANAGER_AUTH_YANDEX_RU.md`, `docs/release/evidence/S03_MANAGER_UI_MANTINE_RU.md`, `docs/release/evidence/S03_MIN_LIFECYCLE_RU.md` |
| Website widget baseline / S04-S06 | `audited/staging evidence` | `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md`, `docs/release/evidence/S05_WEBSITE_SAFE_AI_RU.md`, `docs/release/evidence/S06_MANAGER_TAKEOVER_RU.md` |
| Customer-facing staging feature baseline | `accepted as current feature baseline; smoke pending` | `docs/release/evidence/STAGING_FEATURE_BASELINE_20260803_RU.md` |
| AI refactor PR0a-PR2 | `PR0a-PR1 accepted; PR2 merged with independent evidence gap recorded` | `docs/tasks/AI_REF_PR2_LATEST_WINS_FRESH_TURN_RU.md` |
| P0 channel-neutral conversation | `merged into main` | `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` |
| Telegram inbound + manager mini-panel | `reviewed locally; staging prep accepted` | `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md` |
| Telegram manual delivery sender | `accepted after controlled staging smoke` | `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md` |
| Telegram manager reply worker | `accepted after controlled staging worker smoke` | `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md` |
| Telegram supervised delivery scheduler | `supervised staging smoke passed; not production approval` | `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md` |

## Что Делать Дальше

1. Не включать Telegram AI outbound. Текущий scheduler проверяет только ответы менеджера.
2. Не включать `manager_notification_outbox` sender внутри этого решения; это отдельный scope.
3. Закрыть независимую evidence для PR2, затем выполнять PR3
   `ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn` по repo-local roadmap.
4. Production остается заблокирован до G01-G17, backup/restore, rollback evidence, monitoring/watch policy and explicit owner sign-off.

## Блокеры

| Блокер | Статус | Что делать |
|---|---|---|
| Production rollout | `blocked` | Собрать release evidence bundle, backup/restore, rollback and sign-off |
| Supervised Telegram scheduler runtime | `staging smoke passed; production approval blocked` | Собрать production release bundle, backup/restore, rollback and owner sign-off |
| Telegram AI outbound | `blocked` | Не включать до neutral AI boundary, separate AI-authored evidence, notification scope and production gates |
| Notification sender | `separate scope` | Не смешивать с manager reply worker |
| AI degradation/review/eval state | `P1 before AI production` | Добавить app-owned quality events, handoff/degradation visibility, review labels and eval cases |
| Dirty working tree | `release blocker` | Разделить текущие изменения на reviewable commits before any release |

## Главные Ссылки

- Task records: `docs/tasks/README.md`
- Evidence records: `docs/release/evidence/README.md`
- Current staging feature baseline: `docs/release/evidence/STAGING_FEATURE_BASELINE_20260803_RU.md`
- Telegram manager reply worker task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- Telegram manager reply worker evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_RU.md`
- Telegram supervised scheduler task: `docs/tasks/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Telegram supervised scheduler evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`
- Telegram manager boundaries: `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- Worker ADR: `docs/adr/ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md`
- Supervised scheduler ADR: `docs/adr/ADR-003-TELEGRAM-MANAGER-REPLY-SUPERVISED-SCHEDULER_RU.md`
- Supervised scheduler runbook: `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`
- Repo-local source of truth: `docs/source-of-truth.md`
- Current AI roadmap: `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`
- Repo-local authority ADR: `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`
- AI boundary Stage A task: `docs/tasks/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- AI boundary Stage A evidence: `docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
