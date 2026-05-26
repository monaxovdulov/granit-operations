# ADR-008: Public Widget AI Reply Generator Boundary

Status: accepted for P2-3 refactor slice
Date: 2026-05-26
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P2-3

## Context

`ops-api` accepts public website widget messages, persists them as lead/conversation truth, and may show an AI reply only after the inbound message is saved. Before this slice, the intake use case directly constructed the AI service:

Было:

```text
PublicWidgetIntakeService
  -> validates public widget contract
  -> persists accepted widget message
  -> knows WidgetAiProvider / modelName options
  -> constructs WidgetAiService
  -> asks AI service for a reply
  -> persists AI reply before exposing it to the widget response
```

This mixed the public intake sequencing responsibility with AI dependency assembly. The behavioral risk was that future AI provider/model work could accidentally touch the use case that protects public response compatibility and the rule that widget inbound must persist before AI generation.

The source of truth remains:

- `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- `docs/adr/README.md`
- `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`

## Decision

Make public widget intake depend on a narrow reply generator port:

```text
apps/api/src/modules/intake/ports/public-widget-ai-reply-generator.ts
  -> PublicWidgetAiReplyGenerator
  -> PublicWidgetAiReplyResult
  -> public AI disclosure constants used by the widget response
```

Стало:

```text
app-context.ts
  -> builds WidgetAiService from enabled/provider/modelName assembly options
  -> passes PublicWidgetAiReplyGenerator into PublicWidgetIntakeService

PublicWidgetIntakeService
  -> validates public widget contract
  -> persists accepted widget message
  -> checks AI enabled + replyGenerator availability
  -> calls only PublicWidgetAiReplyGenerator
  -> persists AI reply before exposing it to the widget response

WidgetAiService
  -> implements PublicWidgetAiReplyGenerator
  -> owns prompt/model/policy behavior and provider interaction
```

The public widget use case no longer imports `WidgetAiService`, `WidgetAiProvider`, OpenAI adapter classes, provider details or model assembly fields. Missing AI configuration is still handled at the use-case level as the same `missing_openai_config` fallback because no reply generator is passed when enabled AI has no provider.

`ops-api` remains one Fastify service. This decision changes only internal TypeScript dependency assembly; it does not add a process, network boundary, queue framework, event bus, DI container, generic repository abstraction or runtime topology.

Postgres remains the single source of truth for leads, conversations, widget sessions, manager takeover state and persisted AI replies. AI output is not shown to the widget unless `saveSiteWidgetAiMessage` confirms persistence.

The following were deliberately not changed:

- public widget request/response contract;
- widget route paths or HTTP statuses;
- widget persistence sequencing;
- AI prompt text;
- AI model selection;
- AI safety/policy rules;
- OpenAI adapter behavior;
- DB schema or migrations;
- env variable names;
- npm scripts;
- runtime topology.

## Consequences

`PublicWidgetIntakeService` is now easier to review as a public contract/persistence-sequencing use case. Future provider/model assembly changes live in `app-context.ts` and the AI module instead of the intake use case.

The boundary test now protects against reintroducing `WidgetAiService`, `WidgetAiProvider`, provider fields or `modelName` into the public widget intake use case.

The tradeoff is one additional local port file under `modules/intake/ports`. This is acceptable because it is a narrow dependency contract, not a new runtime abstraction.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep constructing `WidgetAiService` inside `PublicWidgetIntakeService` | Rejected because P2-3 explicitly targets narrower coupling to the AI layer and no provider details in the intake use case. |
| Move prompt/model/policy logic into the intake use case | Rejected as out of scope and unsafe: prompt, model and policy behavior must not change in this slice. |
| Change public widget response builders or response shape | Rejected because the response contract must stay stable and existing builders were already clear enough. |
| Add a DI container for service assembly | Rejected because local factory-style assembly in `app-context.ts` is enough for this modular monolith. |
| Split `ops-api` into multiple services or AI microservice | Rejected because the product still needs one Fastify backend with one Postgres source of truth. |
| Add an event bus or queue for widget AI generation | Rejected as broader than the slice; the current behavior remains synchronous after inbound persistence. |

## Checks Run

- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; protects the new narrow AI reply generator boundary and existing module boundaries.
- `npx vitest run apps/api/test/public-intake.test.ts` - passed; public widget behavior is unchanged, including persist-before-AI, fallback responses, unsafe model output handling, manager takeover blocking and public response shape.
- `npm run typecheck` - passed; API and manager TypeScript contracts still compile after moving AI assembly out of the use case.

## Remaining Risk

- This ADR is not production approval. No production deploy, staging smoke or real OpenAI call was part of P2-3.
- The public intake tests use a fake provider/generator path. They prove the use-case sequencing and fallback behavior, not external provider availability.

## Owner Impact

The owner gets a safer widget AI surface: public intake remains focused on accepting and saving customer messages, while AI provider/model changes are isolated to assembly and AI service code.

Review for future widget AI work should first check that inbound persistence still happens before generation and that AI replies are not exposed unless their outbound message is persisted.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P2-3 is an internal refactor without production rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
