# ADR-007: Timeline Event Input Boundary

Status: accepted for P2-2 refactor slice
Date: 2026-05-26
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P2-2

## Context

`ops-api` uses timeline events as manager-visible evidence for lead creation, inbound messages, manager takeover, manager Telegram replies, notification enqueue and Telegram delivery state. Before this slice, the centralized timeline builders lived in `apps/api/src/modules/timeline/timeline-events.ts`, but their input types imported conversation repository shared types:

Было:

```text
modules/timeline/timeline-events.ts
  -> modules/conversations/repositories/lead-conversation-types.ts
     -> conversation repository enums/errors
```

This made the evidence builder module depend on a repository contract file even though it only needs neutral string unions for event inputs and metadata construction.

The source of truth remains:

- `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- `docs/adr/README.md`
- `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`

## Decision

Make timeline input ownership local to `modules/timeline`:

```text
modules/timeline/timeline-event-inputs.ts
  -> neutral input DTOs and local string unions for timeline builders

modules/timeline/timeline-events.ts
  -> TIMELINE_EVENT_TYPES
  -> centralized timeline event builders
  -> metadata shape construction
```

Стало:

```text
conversation repositories / delivery repositories
  -> modules/timeline/timeline-events.ts
     -> modules/timeline/timeline-event-inputs.ts
```

`modules/timeline` no longer imports broad conversation repository contract files or delivery service implementation types. Callers still pass the same values structurally, but timeline owns the evidence input contract it needs.

Preserved deliberately:

- timeline event names;
- metadata keys and values;
- manager-visible timeline payload shape;
- centralized event builders in `timeline-events.ts`;
- public API request/response contracts;
- DB schema and migrations;
- env variable names;
- npm scripts;
- runtime topology;
- Telegram AI outbound policy.

`ops-api` remains one Fastify service. This decision changes only internal TypeScript dependency direction and does not introduce another process, network boundary, queue framework, event bus, DI container or generic repository abstraction.

Postgres remains the single source of truth for leads, conversations, manager takeover state, reply contexts, delivery rows and timeline evidence. Timeline builders create rows to persist; they do not become an event bus or a separate truth store.

## Consequences

Future timeline evidence changes can be reviewed inside the timeline module without reopening conversation repository contracts or delivery service implementation types. This makes the evidence boundary easier to protect while preserving the existing persistence flow.

The tradeoff is one additional local type file under `modules/timeline`. That is acceptable because it is a neutral DTO boundary, not a new runtime abstraction.

The boundary test now checks that `modules/timeline` keeps neutral input types, centralized builders and no imports from conversation repository contracts or service implementation modules.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep importing `lead-conversation-types.ts` from timeline | Rejected because P2-2 explicitly removes unnecessary dependency from timeline evidence builders to repository contract files. |
| Move timeline event names into conversation or delivery modules | Rejected because timeline event builders must stay centralized and shared by conversation and delivery persistence. |
| Let each repository construct raw timeline metadata inline | Rejected because event names and metadata shapes would become duplicated and easier to drift. |
| Add a domain event bus for timeline evidence | Rejected as broader than the problem; persistence still happens directly through existing Postgres repositories. |
| Split `ops-api` into multiple services | Rejected because the product still needs one Fastify backend with one Postgres source of truth. |
| Add a DI container or generic repository abstraction | Rejected because a local type boundary is enough for this slice. |

## Checks Run

- `npm run typecheck` - passed; local timeline input types remain structurally compatible with existing conversation and delivery callers.
- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; boundary tests now protect neutral timeline inputs and centralized builders.
- `npx vitest run apps/api/test/public-intake.test.ts` - passed; public intake, manager-visible timeline payloads and existing HTTP scenarios still pass.
- `npx vitest run apps/api/test/telegram-delivery-service.test.ts` - passed; delivery failure/status semantics still compile and pass through the centralized timeline builders.

## Remaining Risk

- This ADR is not production approval. No production deploy, staging smoke or live Telegram delivery run was part of P2-2.
- The local timeline unions must be updated intentionally if product-level status/channel values expand later. The boundary test prevents accidental dependency back to broad repository files, not semantic drift by itself.

## Owner Impact

The owner gets a narrower and safer evidence boundary: future work can change repository contracts, Telegram delivery services or manager workflow types without accidentally making `modules/timeline` depend on those broader modules.

Review should focus on preserving event names and metadata shape whenever timeline input DTOs change.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P2-2 is an internal refactor without production rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
