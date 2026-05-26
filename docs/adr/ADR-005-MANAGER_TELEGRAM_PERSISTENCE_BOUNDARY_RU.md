# ADR-005: Manager Telegram Persistence Boundary

Status: accepted for P1-2 refactor slice
Date: 2026-05-26
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P1-2

## Context

`ops-api` keeps lead truth, conversations, manager takeover state, Telegram manager reply context, delivery evidence and timeline events in Postgres. After P1-1 the TypeScript contracts were split into narrow ports, but the implementation of `ManagerTelegramRepository` still lived inside `PostgresIntakeRepository`.

Было:

```text
PostgresIntakeRepository
  -> public intake persistence
  -> conversation message persistence
  -> manager lead persistence
  -> manager Telegram bind tokens / chat binding / actor lookup
  -> manager Telegram reply context create/clear
  -> manager Telegram reply persistence
  -> message_deliveries.pending
  -> conversation.manager_message_queued timeline event
```

That kept a high-risk manager Telegram workflow inside the same thick implementation that also handles public intake and manager lead read models.

The source of truth remains the existing P1/P2 task doc and repo-local ADR policy:

- `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- `docs/adr/README.md`

## Decision

Move the `ManagerTelegramRepository` Postgres implementation into an explicit manager Telegram persistence module:

```text
ManagerTelegramRepository port
  -> postgres-manager-telegram-repository.ts
     -> manager_telegram_bind_tokens
     -> manager_telegram_bindings
     -> manager_telegram_reply_contexts
     -> conversation_messages
     -> message_deliveries
     -> lead_timeline_events
```

`PostgresIntakeRepository` stays as the aggregate compatibility facade used by the existing app composition. It delegates manager Telegram calls to `PostgresManagerTelegramRepository` and no longer owns bind-token or reply-context persistence logic.

Стало:

```text
Public intake / conversation / manager lead persistence
  -> PostgresIntakeRepository

Manager Telegram binding and reply persistence
  -> PostgresManagerTelegramRepository

Current buildAppContext aggregate compatibility
  -> PostgresIntakeRepository delegates ManagerTelegramRepository methods
```

Preserved behavior:

- bind token generation and hashing;
- manager Telegram chat binding and active binding revocation;
- manager actor lookup and binding last-seen update;
- reply context create, clear, expiry and use;
- manager Telegram reply persistence as outbound manager conversation message;
- creation of `message_deliveries` with `status = "pending"`;
- `conversation.manager_message_queued` timeline evidence via the existing builder.

`ops-api` remains one Fastify service. This decision changes only internal module ownership; it does not add a process, network boundary, queue framework, webhook sender, event bus, DI container or runtime topology.

Postgres remains the single source of truth. The slice deliberately did not change public APIs, DB schema, migrations, env variable names, npm scripts, Telegram webhook statuses, manager panel API, delivery worker behavior, notification sender behavior or Telegram AI outbound policy.

## Consequences

The manager Telegram workflow is now easier to reason about and protect because its persistence behavior has one explicit implementation file. Future changes to bind tokens, reply contexts or manager reply enqueue evidence can target that module instead of reopening the whole public intake repository.

The compatibility facade is still present, so existing application assembly and tests continue to use the current aggregate repository shape. That keeps the refactor low-risk but means the aggregate class still exposes manager Telegram methods for now.

The boundary test now checks that bind-token and reply-context table ownership is not reintroduced into `PostgresIntakeRepository`.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep the implementation inside `PostgresIntakeRepository` | Rejected because P1-2 explicitly reduces the thick repository risk around manager Telegram persistence. |
| Change `buildAppContext` to require separate repository instances immediately | Rejected for this slice because it would widen the public composition contract and force more test fixture changes without changing runtime behavior. |
| Move all conversation persistence into many repositories at once | Rejected as a broad rewrite; P1-2 only targets the manager Telegram persistence slice. |
| Split `ops-api` into multiple services | Rejected because the product still needs a modular monolith with one Fastify backend and one Postgres truth source. |
| Add an event bus, queue framework, DI container or generic repository abstraction | Rejected because the existing direct repository port is enough for this boundary and avoids first-release overengineering. |
| Implement notification sender or Telegram AI outbound while touching Telegram code | Rejected as out of scope and explicitly disallowed by the task. |

## Checks Run

- `npm run typecheck` - passed; the new repository module and aggregate facade still satisfy TypeScript contracts.
- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; the boundary test now protects the explicit manager Telegram persistence module.
- `npx vitest run apps/api/test/public-intake.test.ts` - passed; public intake, manager Telegram binding/reply scenarios and existing HTTP behavior still pass.
- `npx vitest run apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` - passed; delivery service/worker behavior remains independent from the refactor.

## Remaining Risk

- This ADR is not production approval. No production deploy, staging smoke, real Telegram webhook call or live delivery worker run was part of P1-2.
- `PostgresIntakeRepository` remains a compatibility aggregate. A later slice can split composition further if the app context needs explicit per-port repository wiring.

## Owner Impact

The owner gets a safer place for future manager Telegram work: reply context and outbound manager reply persistence can be reviewed in one focused file, while public intake and manager API behavior stay stable.

Operationally this lowers the chance that future Telegram changes accidentally affect public lead intake or delivery worker behavior.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P1-2 is an internal refactor without production rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
