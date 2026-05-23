# Task: MODULAR-MONOLITH-REFACTOR - Разделить `ops-api` на доменные модули без микросервисов

Status: implemented locally, not deployed
Created: 2026-05-23
Repo: `granit-operations`
Slice: architecture/refactor
Owner/agent: owner decision + Codex implementation

## Цель

Сделать `ops-api` понятным modular monolith: один runtime и один Postgres source of truth остаются, но кодовые границы между intake, conversations, manager workflows, AI, Telegram inbound, delivery и audit становятся явными.

Бизнес-смысл: новые функции вроде notification sender, AI handoff, production readiness и будущих каналов не должны случайно ломать доставку ответов менеджера, takeover, timeline evidence или запрет Telegram AI outbound.

## Scope

- Зафиксировать целевую структуру модулей внутри `apps/api/src/modules` или близкого repo-style варианта.
- Разделить ответственности без изменения runtime topology:
  - `intake` - публичные заявки и входящие сообщения;
  - `conversations` - диалоги, сообщения, takeover, manager reply queueing;
  - `manager` - manager-facing use cases/read models;
  - `auth` - manager users, sessions, roles, Yandex ID;
  - `telegram/inbound` - webhook updates, manager binding/actions, private-chat rules;
  - `delivery` - `message_deliveries`, Telegram sender/worker, `uncertain` policy hooks;
  - `ai` - website widget AI, fallback, send-time gates, future handoff boundary;
  - `timeline` - owner-readable events and evidence metadata helpers.
- Ввести use-case слой между routes/services и repositories, чтобы routes не знали DB details, а repositories не знали HTTP/provider details.
- Оставить текущие публичные контракты, DB schema, migrations, env names, scripts and systemd templates без behavioral changes.
- Разнести Telegram inbound и Telegram delivery так, чтобы webhook не мог случайно вызвать `sendMessage`, а delivery не зависел от webhook route.
- Централизовать timeline event names/metadata builders для delivery, takeover, manual contact and future `uncertain` resolution.
- Добавить focused regression tests на сохранение текущего поведения после refactor.

## Acceptance

- `ops-api` по-прежнему запускается как один backend service.
- `npm run typecheck`, `npm run smoke:api`, focused Telegram delivery tests and `npm test` pass.
- Existing staging-proven behavior remains unchanged:
  - website/site-form intake persists leads;
  - widget messages persist before AI;
  - manager auth/session and manager UI API contracts remain compatible;
  - Telegram webhook remains disabled-by-default and secret-protected;
  - manager-authored Telegram replies still create `message_deliveries.pending`;
  - worker/scheduler still claims only `pending/retrying`, not `uncertain`;
  - Telegram AI outbound remains blocked;
  - `manager_notification_outbox` sender is not implemented in this refactor.
- No production deploy, no DB migration, no queue framework migration and no public API break.
- Architecture docs or task evidence explain the new module boundaries in owner-readable language.

## Out Of Scope

- Splitting into microservices.
- New database per subsystem.
- Redis, BullMQ, pg-boss, Graphile Worker, Kafka or event-bus migration.
- Production approval or deploy.
- Telegram AI outbound enablement.
- `manager_notification_outbox` sender implementation.
- WhatsApp/MAX/call tracking or omnichannel CRM expansion.
- UI redesign.
- Business logic changes to lead statuses, takeover policy, delivery retry policy or AI policy.

## Implementation Notes

Runtime topology did not change: `apps/api/src/app.ts` still builds one Fastify service, and scripts still use the same npm entrypoints/env names. The refactor added `apps/api/src/app-context.ts` and domain folders under `apps/api/src/modules`.

Module map:

- `modules/intake` - public site form/widget routes and intake use-cases.
- `modules/conversations` - current conversation repository port and Postgres implementation.
- `modules/manager` - manager-facing lead and Telegram binding use-cases/routes.
- `modules/auth` - manager auth, sessions, Yandex ID and auth routes.
- `modules/telegram/inbound` - Telegram webhook updates, manager binding/actions and private-chat rules.
- `modules/delivery` - `message_deliveries`, Telegram sender/provider, worker and advisory lock.
- `modules/ai` - website widget AI provider and reply generation.
- `modules/timeline` - centralized owner-readable event names and metadata builders.

Compatibility exports remain under the old `auth`, `routes`, `services` and `repositories` paths so existing tests/imports do not break. New code should use `modules/*`.

## Files Touched

- `apps/api/src/app.ts`
- `apps/api/src/app-context.ts`
- `apps/api/src/index.ts`
- `apps/api/src/modules/**`
- `apps/api/src/auth/**`
- `apps/api/src/routes/**`
- `apps/api/src/services/**`
- `apps/api/src/repositories/**`
- `apps/api/src/scripts/**`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/modular-boundaries.test.ts`
- `docs/architecture/OPS_API_MODULAR_MONOLITH_RU.md`
- `docs/release/evidence/MODULAR_MONOLITH_REFACTOR_RU.md`
- `docs/tasks/MODULAR_MONOLITH_REFACTOR_RU.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| baseline `npm run typecheck` | passed | Captured before code movement |
| baseline `npm run smoke:api` | passed, 36 tests | Captured before code movement |
| baseline `npm test` | passed, 55 tests | Captured before code movement |
| post-refactor `npm run typecheck` | passed | API and manager TS contracts compile |
| post-refactor `npm run smoke:api` | passed, 36 tests | Public intake/API smoke still passes |
| post-refactor focused Telegram delivery tests | passed, 12 tests | Delivery service and worker behavior still passes |
| post-refactor `npm test` | passed, 59 tests | Existing tests plus boundary tests passed |
| post-refactor `git diff --check` | passed | No whitespace errors |

## Evidence Links

- Current project status: `docs/PROJECT_STATUS_RU.md`
- Telegram manager boundaries: `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- Ops API modular monolith architecture: `docs/architecture/OPS_API_MODULAR_MONOLITH_RU.md`
- Local refactor evidence: `docs/release/evidence/MODULAR_MONOLITH_REFACTOR_RU.md`
- Supervised scheduler runbook: `docs/runbooks/TELEGRAM_MANAGER_REPLY_SUPERVISED_SCHEDULER_RU.md`
- Telegram supervised scheduler evidence: `docs/release/evidence/TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md`

## Blockers

- Production deploy was not requested and was not performed.
- Staging deploy was not performed.
- Real Telegram provider calls were not performed.
- There are unrelated pre-existing dirty docs in the worktree; this refactor did not revert them.

## Completed Implementation Order

1. Captured baseline checks and current module map.
2. Added module folders and moved code with compatibility exports, without behavior changes.
3. Added use-case layer around manager, manager Telegram binding and Telegram inbound paths.
4. Centralized timeline event constants/builders.
5. Separated Telegram inbound module from delivery module.
6. Added focused modular boundary tests.
7. Ran checks and updated architecture/evidence docs.

## Next Action

Review the module boundaries and compatibility exports, then decide whether to remove old compatibility paths in a later cleanup PR or keep them as stable aliases for one release cycle.
