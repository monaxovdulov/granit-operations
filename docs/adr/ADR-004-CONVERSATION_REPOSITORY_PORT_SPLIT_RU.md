# ADR-004: Conversation Repository Port Split

Status: accepted for P1-1 refactor slice
Date: 2026-05-25
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P1-1

## Context

`ops-api` already stores public intake, conversation messages, manager lead state, manager Telegram binding/reply context and delivery evidence in Postgres. The implementation was intentionally left in `PostgresIntakeRepository`, but the contract file `apps/api/src/modules/conversations/repositories/intake-repository.ts` exposed all DTOs, errors and repository ports from one broad module.

Было:

```text
use cases / timeline / routes
  -> conversations/repositories/intake-repository.ts
  -> broad aggregate DTOs + ports + shared enums/errors
```

This made it easy for new code to depend on the aggregate repository interface when it only needed one responsibility.

## Decision

Split the conversation repository contracts by existing responsibility while keeping the aggregate compatibility entrypoint:

```text
shared enums/errors
  -> lead-conversation-types.ts

public intake persistence
  -> public-intake-repository.ts

conversation message persistence
  -> conversation-message-repository.ts

manager lead read/mutation port
  -> manager-lead-repository.ts

manager Telegram binding/reply port
  -> manager-telegram-repository.ts

aggregate compatibility
  -> intake-repository.ts extends the narrow ports and re-exports them
```

Стало:

```text
public intake use cases -> public-intake-repository.ts
manager lead use cases -> manager-lead-repository.ts
manager Telegram use cases -> manager-telegram-repository.ts
Telegram inbound use cases -> conversation-message + manager-lead + manager-telegram ports
timeline builders -> lead-conversation-types.ts
composition/Postgres aggregate -> intake-repository.ts
legacy compatibility -> apps/api/src/repositories/intake-repository.ts
```

`ops-api` remains one Fastify service. This slice only clarifies TypeScript boundaries inside the modular monolith; it does not introduce another process, service boundary, queue framework, HTTP hop or deploy topology.

Postgres remains the source of truth. Lead state, conversations, manager Telegram reply context, notification outbox, delivery rows and timeline evidence still live in the existing database tables and are still persisted by the existing Postgres repository behavior.

The following were deliberately not changed:

- public API request/response contracts;
- DB schema or migrations;
- env variable names;
- npm scripts;
- runtime topology;
- Telegram outbound policy;
- `PostgresIntakeRepository` persistence behavior;
- compatibility exports under `apps/api/src/repositories/*`.

## Consequences

New code can import a narrow repository port without importing the aggregate compatibility file. Existing callers that still use `IntakeRepository` continue to compile because the aggregate interface remains in place.

The module boundary is easier to protect with tests: `modular-boundaries.test.ts` now checks that narrow contract files exist, internal use cases use them, and the legacy repository export remains available.

The tradeoff is that contract definitions now span several files. That is acceptable here because the split follows existing responsibilities and does not add a runtime abstraction or a new repository implementation.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep one broad `intake-repository.ts` contract file | New code would keep depending on the aggregate port even when it only needs public intake, manager leads or Telegram binding behavior. |
| Move Postgres behavior while splitting contracts | Rejected for P1-1 scope; behavior movement belongs to later slices and would increase regression risk. |
| Split `ops-api` into multiple services | Rejected because this is a first-release modular monolith; the operational risk is inside contract/module boundaries, not network/service isolation. |
| Add an event bus, queue framework, DI container or generic repository layer | Rejected as broader than the concrete problem; the current need is typed boundary clarity, not a new runtime framework. |
| Remove legacy compatibility exports now | Rejected because compatibility exports are explicitly required for this release phase. |

## Checks Run

- `npm run typecheck` - passed; the repository contract split does not break TypeScript contracts in API or manager workspace.
- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; the boundary test now protects the narrow port layout and compatibility export.
- `npx vitest run apps/api/test/public-intake.test.ts` - passed; public intake behavior still compiles and existing scenario tests pass against the compatibility repository contract.

## Remaining Risk

- This ADR does not prove production readiness because no production deploy, staging smoke or database migration was part of P1-1.
- `PostgresIntakeRepository` is still a thick implementation by design. Later slices may move behavior out, but this slice only made the port boundaries explicit.

## Owner Impact

The owner gets a lower-risk base for future Telegram, manager workflow and widget AI work: agents can now depend on the specific port they need, while the single service and Postgres truth model stay unchanged.

Review should focus on whether future code imports the narrow module it actually needs instead of returning to the aggregate `IntakeRepository` by default.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P1-1 has no runtime or production rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
