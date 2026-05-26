# ADR-006: Telegram Inbound Mapper Boundary

Status: accepted for P2-1 refactor slice
Date: 2026-05-26
Repo scope: `granit-operations`
Related slice/task: `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU` / P2-1

## Context

`ops-api` keeps Telegram inbound as an adapter inside the modular monolith. Before this slice, `apps/api/src/modules/telegram/inbound/telegram-bot-service.ts` did several jobs at once:

Было:

```text
TelegramBotService
  -> reads raw Telegram update
  -> parses /start, /cancel and callback data
  -> classifies text/media urgency and handoff reason
  -> maps Telegram message into AcceptInboundMessageInput
  -> chooses manager/customer path
  -> calls Telegram inbound use cases
```

That made the webhook service harder to review because provider-shape parsing and business routing were interleaved in one file. The risk was future Telegram work changing customer inbound classification, manager reply routing, callback statuses or webhook behavior together.

The source of truth remains:

- `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- `docs/adr/README.md`
- `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`

## Decision

Move pure Telegram update parsing, command/callback parsing, raw message content parsing, `telegramMessageToInbound` and handoff/urgency/content classification into:

```text
apps/api/src/modules/telegram/inbound/telegram-update-mapper.ts
```

Стало:

```text
telegram-update-mapper.ts
  -> Telegram raw update types
  -> readTelegramUpdate
  -> readStartToken / isCancelCommand / isTelegramCommand
  -> readCallbackAction
  -> telegramMessageContent
  -> classifyNeedsManagerReason
  -> telegramMessageToInbound

telegram-bot-service.ts
  -> validates Telegram service configuration through existing options
  -> routes update to message or callback flow
  -> chooses manager binding/reply/customer inbound path
  -> calls TelegramInboundUseCases
  -> maps known domain errors to existing webhook result statuses
```

The mapper is deterministic: `TelegramBotService` still owns `randomUUID()` generation and passes the generated `publicMessageId` into the mapper. This keeps ID creation at the orchestrator boundary and lets the mapper be tested without mocks.

`ops-api` remains one Fastify service. This decision changes only internal TypeScript ownership; it does not add a process, network boundary, queue framework, event bus, DI container, generic repository abstraction or runtime topology.

Postgres remains the single source of truth for leads, conversations, manager takeover state, reply context, delivery rows and timeline evidence. Telegram provider payloads, traces, prompts and mapper output are not business truth until persisted through the existing use cases/repositories.

The following were deliberately not changed:

- public API request/response contracts;
- Telegram webhook response statuses;
- Telegram commands;
- provider send behavior;
- DB schema or migrations;
- env variable names;
- npm scripts;
- runtime topology;
- Telegram AI outbound policy.

## Consequences

`TelegramBotService` is now thinner and easier to read as an adapter/orchestrator over typed use cases. The mapper/classifier behavior can be tested directly, while existing webhook tests still verify HTTP status mapping, secret validation, manager binding, manager reply context and customer inbound persistence.

Future Telegram content types or classifier changes can be reviewed in the mapper without reopening manager reply orchestration, provider send behavior or route response mapping.

The tradeoff is one additional module inside `telegram/inbound`. This is acceptable because it isolates pure provider-shape mapping and does not create a new runtime abstraction.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Keep all helper functions inside `telegram-bot-service.ts` | Rejected because P2-1 explicitly targets the thick Telegram service and because mapper/classifier behavior is easier to test in isolation. |
| Move Telegram routing into separate command handler classes | Rejected as broader than the slice; the service can stay a simple orchestrator. |
| Add new Telegram commands while extracting command parsing | Rejected as out of scope and explicitly forbidden by the task. |
| Change webhook response statuses while touching service flow | Rejected because route/webhook compatibility must stay stable. |
| Split `ops-api` into multiple services | Rejected because the product still needs one Fastify backend with one Postgres source of truth. |
| Add an event bus, queue framework, DI container or generic repository abstraction | Rejected because this refactor only needs a local pure mapper module. |
| Move provider send behavior into inbound service | Rejected because Telegram inbound must stay free of direct provider sends. |

## Checks Run

- `npx vitest run apps/api/test/telegram-inbound-mapper.test.ts` - passed; focused mapper/classifier tests cover deterministic DTO mapping, media classification, urgency/human classification, command parsing, callback parsing and raw update parsing.
- `npm run typecheck` - passed; the extracted mapper and thinner service still satisfy API and manager TypeScript contracts.
- `npx vitest run apps/api/test/modular-boundaries.test.ts` - passed; Telegram inbound remains inside the modular monolith boundaries and free of delivery provider sends.
- `npx vitest run apps/api/test/public-intake.test.ts` - passed; existing public intake and Telegram webhook scenarios still pass, including webhook statuses, manager binding, manager replies and customer inbound persistence.

## Remaining Risk

- This ADR is not production approval. No production deploy, staging smoke or real Telegram webhook call was part of P2-1.
- The mapper tests prove pure mapping/classification for representative text/media/command/callback cases, not every Telegram Bot API update shape.
- `TelegramBotService` still owns orchestration for both manager and customer paths by design. A later slice should only split that further if a concrete workflow risk appears.

## Owner Impact

The owner gets a lower-risk Telegram inbound surface: future changes to Telegram content parsing or handoff/urgency classification are isolated from manager reply orchestration and webhook status behavior.

Operationally this reduces the chance that a small Telegram parsing change accidentally touches provider sends, public API behavior, DB schema or production topology.

## Links

- Task: `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- Evidence: local acceptance checks listed in this ADR; no release/deploy evidence document was created because P2-1 is an internal refactor without production rollout.
- Source-of-truth docs: `docs/adr/README.md`, `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
