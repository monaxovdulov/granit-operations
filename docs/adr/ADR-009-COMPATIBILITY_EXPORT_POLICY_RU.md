# ADR-009: Compatibility Export Policy

Status: accepted for P3-2 refactor slice
Date: 2026-05-26
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P3-2

## Context

`ops-api` is now organized around domain modules under `apps/api/src/modules`. Older technical folders still exist:

```text
apps/api/src/auth
apps/api/src/routes
apps/api/src/services
apps/api/src/repositories
```

These folders are compatibility exports for tests, scripts and any short-lived code that still imports old paths. Removing them during the thick-module refactor would create avoidable churn and could break package/test expectations unrelated to the boundary work.

Было:

```text
production code
  -> could import either modules/* or old auth/routes/services/repositories paths

legacy folders
  -> remained available as re-export shims
```

The risk was that new production code could keep extending the old technical grouping and make the modular monolith boundaries weaker again.

## Decision

Keep compatibility export files during this phase, but treat them as legacy entrypoints only:

```text
new production code
  -> apps/api/src/modules/*

compatibility exports
  -> apps/api/src/auth/*
  -> apps/api/src/routes/*
  -> apps/api/src/services/*
  -> apps/api/src/repositories/*
  -> re-export modules/* only

tests and short-lived compatibility callers
  -> may continue to use old paths while the compatibility phase is active
```

Стало:

```text
production source scan
  -> rejects imports that resolve to top-level auth/routes/services/repositories
  -> skips the compatibility export files themselves

compatibility export scan
  -> proves old export files still exist
  -> proves they still point at modules/*
```

`ops-api` remains one Fastify service. This decision only fixes import policy and test guardrails; it does not add another process, service boundary, queue framework, HTTP hop, event bus, DI container or runtime topology change.

Postgres remains the source of truth for leads, conversations, manager state, Telegram delivery rows and timeline evidence. The compatibility export policy does not move state into UI, scripts, traces, provider payloads or process memory.

The following were deliberately not changed:

- public API request/response contracts;
- DB schema or migrations;
- env variable names;
- npm scripts;
- package exports;
- runtime topology;
- old compatibility export files;
- tests that intentionally exercise old compatibility imports.

## Consequences

Future production code has one preferred direction: import from `modules/*`. The old technical folders remain available while this release phase needs them, but they should not be a place where new production dependencies accumulate.

The boundary test is intentionally stronger for production source than for tests. This preserves backward compatibility pressure in tests while discouraging new app code from using legacy paths.

The tradeoff is that removing compatibility exports later will require a separate cleanup decision. That later cleanup should first update any tests or scripts still using old paths and should not be bundled with runtime behavior changes.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Remove compatibility exports now | Rejected because P3-2 explicitly preserves old exports and must not break tests, scripts or package exports. |
| Keep compatibility exports with no guardrail | Rejected because future production code could keep importing old technical paths and weaken the module boundary. |
| Rewrite all tests to import `modules/*` now | Rejected because tests can intentionally prove compatibility remains available during this phase. |
| Add lint tooling for this single rule | Rejected because the existing focused boundary test already protects repo-local architecture rules without changing scripts or tooling. |
| Split `ops-api` into multiple services | Rejected because the current product still needs one Fastify backend with one Postgres source of truth. |
| Add an event bus, DI container or generic repository abstraction | Rejected as unrelated to the import policy problem and too broad for P3-2. |

## Checks Run

- `npm run typecheck` - passed; API and manager TypeScript contracts still compile after moving the remaining production compatibility import to `modules/*`.
- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; the boundary test proves compatibility exports still exist and production source does not import through old top-level compatibility paths.
- `npm test` - passed; the full local Vitest suite remains green, including tests that intentionally import old compatibility paths.

## Remaining Risk

- This ADR is not production approval. No production deploy or staging smoke is part of P3-2.
- Compatibility export removal is not authorized by this decision. A later slice must make that call explicitly and update callers first.

## Owner Impact

The owner gets a safer refactor baseline: new backend work should follow domain module boundaries, while older imports remain stable enough not to block unrelated tests and scripts.

Review for future API changes should reject new production imports from `apps/api/src/auth`, `routes`, `services` or `repositories` unless the change is explicitly maintaining the compatibility export itself.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P3-2 is an internal import-policy guardrail without runtime rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
