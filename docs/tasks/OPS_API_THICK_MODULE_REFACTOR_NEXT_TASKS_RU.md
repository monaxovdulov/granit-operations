# Task: OPS-API-THICK-MODULE-REFACTOR-NEXT-TASKS - Следующие безопасные refactor slices после audit толстых модулей

Status: mostly_completed; remaining cleanup deferred
Created: 2026-05-25
Last updated: 2026-06-04
Repo: `granit-operations`
Slice: architecture/refactor
Owner/agent: future Codex agents

## Цель

Разложить найденные в read-only audit толстые зоны `ops-api` на маленькие проверяемые refactor slices без broad rewrite, без изменения публичных контрактов, DB schema, migrations, env names, npm scripts или runtime topology.

Бизнес-смысл: новые работы вокруг Telegram, manager workflow, widget AI, notification sender, production readiness и будущих каналов должны меньше рисковать lead truth, takeover, delivery evidence и запретом Telegram AI outbound.

`ops-api` остается одним Fastify backend service и одним Postgres source of truth.

## Audit Map

Основная зона риска:

- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` - один файл держит persistence, lead lifecycle, conversations, manager read model, manager Telegram binding/reply context, notification enqueue, delivery enqueue and timeline evidence.
- `apps/api/src/modules/conversations/repositories/intake-repository.ts` - один contract file экспортирует слишком много DTO, ports, enums and errors для разных слоев.
- `apps/api/src/modules/telegram/inbound/telegram-bot-service.ts` - Telegram adapter одновременно парсит provider update, выбирает manager/customer path, классифицирует handoff/urgency and maps inbound DTO.

Что выглядит нормальным и не требует срочного refactor:

- Fastify routes mostly stay thin: HTTP mapping, auth check, use-case call, response/error mapping.
- `apps/api/src/app.ts` and `apps/api/src/app-context.ts` are acceptable composition roots even with many imports.
- `packages/db/src/schema.ts` is large but cohesive as DB schema source of truth.
- Compatibility exports are acceptable for one release cycle, but new code should use `modules/*`.

Best first move:

- Split repository contracts/types before moving behavior. This makes module boundaries visible with the lowest behavioral risk.

Current state as of 2026-06-04:

- The originally recommended first move has already been completed and accepted through ADR evidence.
- P1 and P2 backend boundary slices are accepted; do not restart them as new work unless a later code change reopens the same risk.
- Remaining work in this task pack is optional cleanup: manager UI decomposition and public intake test fixture split.
- New architecture smells found after this task pack should be tracked as separate focused follow-up tasks instead of being folded back into this historical refactor pack.

## Global Guardrails

- No public API contract changes.
- No DB schema or migration changes.
- No env name, npm script, systemd/runbook or runtime topology changes.
- No queue framework, event bus, DI container, CQRS, generic repository layer or microservice split.
- No Telegram AI outbound enablement.
- No WhatsApp, MAX, call tracking or omnichannel CRM expansion.
- Keep business truth in Postgres, not UI state, provider payloads, traces or prompt text.
- Keep routes as protocol adapters.
- Keep provider `fetch` and SDK details inside adapters.
- Keep raw Fastify `request/reply` out of non-route code.
- Preserve compatibility exports unless a separate task explicitly removes them.

## Mandatory ADR Policy

Every refactor slice in this task pack that changes module boundaries or dependency direction must leave an explicit ADR under `docs/adr`.

The ADR is part of acceptance, not optional evidence. A slice is not accepted if it only changes code/tests and does not record the decision.

ADR requirements:

- use the repo ADR template referenced in `docs/adr/README.md`;
- name the concrete boundary decision, not a vague "architecture cleanup";
- show "before -> after" dependency direction;
- state why `ops-api` remains one Fastify service and one Postgres source of truth;
- state which public API, DB schema, migrations, env names and scripts were deliberately not changed;
- list alternatives rejected, especially broad rewrite, microservice split, event bus, DI container or generic repository abstraction;
- link back to this task and to any release evidence;
- include checks run and remaining risk.

Suggested ADR topics after implementation:

- Repository port split and compatibility export policy.
- Manager Telegram persistence boundary inside conversations/delivery modules.
- Telegram inbound adapter mapper/classifier boundary.
- Timeline evidence type ownership if timeline dependencies change.
- Manager UI decomposition if UI state/data hooks are split in a meaningful way.

Do not create placeholder ADRs with no decision. If a slice is purely mechanical and does not change a boundary, update this task's evidence instead and explain why no ADR was needed.

## Refactor Slices

### Current Slice Status

| Slice | Status | Evidence | Notes |
|---|---|---|---|
| P1-1 repository contract split | accepted | `docs/adr/ADR-004-CONVERSATION_REPOSITORY_PORT_SPLIT_RU.md` | Narrow ports exist; `IntakeRepository` remains an aggregate compatibility interface. |
| P1-2 manager Telegram persistence extraction | accepted | `docs/adr/ADR-005-MANAGER_TELEGRAM_PERSISTENCE_BOUNDARY_RU.md` | Manager Telegram persistence lives in an explicit Postgres repository; aggregate facade remains. |
| P2-1 Telegram inbound mapper/classifier extraction | accepted | `docs/adr/ADR-006-TELEGRAM_INBOUND_MAPPER_BOUNDARY_RU.md` | Mapper/classifier is separate; webhook adapter still orchestrates typed use cases. |
| P2-2 timeline event input decoupling | accepted | `docs/adr/ADR-007-TIMELINE_EVENT_INPUT_BOUNDARY_RU.md` | Timeline inputs are neutral and protected by boundary tests. |
| P2-3 public widget AI reply generator boundary | accepted | `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md` | Public widget intake depends on a narrow AI reply generator interface. |
| P3-1 manager UI helpers/hooks split | deferred_optional | none | Only do this if `apps/manager/src/App.tsx` creates real state/locality friction. |
| P3-2 compatibility export policy | accepted | `docs/adr/ADR-009-COMPATIBILITY_EXPORT_POLICY_RU.md` | Compatibility exports stay; production imports are guarded toward `modules/*`. |
| P3-3 public intake test fixture split | deferred_optional | none | Only do this as test-maintenance cleanup; no production architecture change. |

### 2026-06-04 Deepening Review Follow-ups

These follow-ups came from a read-only pass using the external `improve-codebase-architecture` skill vocabulary: Module, Interface, Implementation, depth, deep, shallow, seam, adapter, leverage and locality. They are not approved implementation tasks yet. If selected, create a separate task doc and ADR only when the work changes a seam or dependency direction.

#### Strong: deepen manager lead persistence/read model

Files:

- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`
- `apps/api/src/modules/manager/use-cases/manager-lead-use-cases.ts`

Problem:

- `PostgresIntakeRepository` still holds public intake, inbound conversation persistence, widget AI send gate, manager read model/mutations and compatibility delegation.
- The manager lead paths are a clear high-friction cluster: list/detail/status/takeover plus conversation read-model assembly live behind the broad aggregate implementation.

Solution:

- Extract the `ManagerLeadRepository` implementation into a deeper manager lead persistence/read-model Module.
- Keep the existing aggregate facade for compatibility while composition still expects one repository object.
- Do not change public API contracts, DB schema, migrations, env names, npm scripts or runtime topology.

Expected benefits:

- Locality: manager workflow query/mutation bugs concentrate in one Module.
- Leverage: manager tests can target the manager Interface without crossing the full intake aggregate.
- Smaller aggregate Interface pressure: future code has less reason to learn public intake, AI and Telegram details just to touch manager lead behavior.

Recommendation strength: Strong.

#### Worth exploring: deepen widget AI reply gate

Files:

- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/api/src/modules/ai/policy/widget-ai-policy.ts`
- `apps/api/src/modules/ai/ai-turn.ts`

Problem:

- `PublicWidgetIntakeService` has the narrow AI reply generator dependency from ADR-008, but still mixes contract validation, persist-before-AI sequencing, fallback response mapping and unsafe candidate text/evidence validation.

Solution:

- Extract an in-process reply gate Implementation behind a local seam.
- Keep provider/model assembly out of this seam.
- Preserve persistence-before-AI and public response sequencing exactly.

Expected benefits:

- Locality: unsafe model output rules and evidence checks live in one Module.
- Leverage: fallback and safety tests can exercise one Interface.
- Lower risk of touching public widget response mapping while changing safety rules.

Recommendation strength: Worth exploring.

#### Worth exploring: deepen manager UI workspace state

Files:

- `apps/manager/src/App.tsx`
- `apps/manager/src/api.ts`
- `apps/manager/src/display.ts`

Problem:

- `ManagerWorkspace` holds polling, selected lead, detail loading, status mutation, takeover, Telegram bind token and logout state in one UI Module.
- This matches the existing P3-1 cleanup slice, but should only be done if it creates real state/locality friction.

Solution:

- Extract data-loading/mutation hooks only when they create a deeper Module.
- Do not redesign the UI.
- Do not move lead truth, takeover truth or assignment truth into UI state.

Expected benefits:

- Locality: workspace behavior and mutation state are easier to reason about.
- Less props/state leakage through presentational code.
- Tests can target workspace behavior without coupling to every visual detail.

Recommendation strength: Worth exploring.

#### Speculative: split test adapter and public intake fixture

Files:

- `apps/api/test/public-intake.test.ts`
- `apps/api/test/helpers/memory-intake-repository.ts`
- `apps/api/test/helpers/*`

Problem:

- `MemoryIntakeRepository` is a useful test adapter, but it now satisfies almost every narrow port and carries public intake, widget AI, Telegram manager reply context and idempotency behavior.

Solution:

- Split test helpers or scenario harnesses by domain workflow.
- Keep helpers local to tests.
- Do not turn test helpers into production abstractions.

Expected benefits:

- Test locality improves.
- Scenario setup becomes easier to navigate.
- Lower risk that memory behavior hides drift from the Postgres adapter.

Recommendation strength: Speculative.

#### Do not reopen now

- Telegram inbound mapper/classifier: ADR-006 already accepted the pure mapper Module and the current shape passes the deletion test.
- Compatibility exports: ADR-009 keeps compatibility exports available and guards production imports toward `modules/*`; do not remove them without a separate ADR.

### P1-1: Split repository contracts/types before behavior movement

Scope:

- Split `apps/api/src/modules/conversations/repositories/intake-repository.ts` into smaller type/port files by existing responsibilities:
  - public intake persistence;
  - conversation message persistence;
  - manager lead read/mutation port;
  - manager Telegram binding/reply port;
  - shared lead/conversation enums and errors.
- Keep `IntakeRepository` as an aggregate compatibility interface for current callers.
- Keep old compatibility exports under `apps/api/src/repositories/*`.

Out of scope:

- Moving Postgres behavior.
- Changing route/use-case public contracts.
- Changing DB schema.

Minimum acceptance:

- Import graph makes narrower ports visible.
- Existing callers still compile.
- New code can depend on a narrow port without importing the aggregate repository file.
- ADR created or updated for the repository boundary decision.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`
- `npx vitest run apps/api/test/public-intake.test.ts`

### P1-2: Extract manager Telegram persistence slice from `PostgresIntakeRepository`

Scope:

- Move `ManagerTelegramRepository` implementation out of `PostgresIntakeRepository` into an explicit module/file.
- Preserve current behavior for:
  - bind tokens;
  - manager chat binding;
  - actor lookup;
  - reply context create/clear;
  - manager Telegram reply persistence;
  - pending `message_deliveries` creation;
  - manager message queued timeline event.
- Keep a facade or aggregate repository if `buildAppContext` still needs one.

Out of scope:

- Changing Telegram webhook statuses or manager panel API.
- Implementing notification sender.
- Changing delivery worker behavior.

Minimum acceptance:

- `PostgresIntakeRepository` no longer owns manager Telegram binding/reply context behavior.
- `telegram/inbound` still has no delivery provider send path.
- Delivery still does not depend on webhook/inbound.
- ADR created or updated for manager Telegram persistence boundary.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`
- `npx vitest run apps/api/test/public-intake.test.ts`
- `npx vitest run apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts`

### P2-1: Extract Telegram inbound mapper/classifier

Scope:

- Move pure Telegram update helpers out of `telegram-bot-service.ts`:
  - Telegram raw message content parsing;
  - `telegramMessageToInbound`;
  - manager/customer command parsing if it stays pure;
  - handoff/urgency/content classification.
- Keep `TelegramBotService` as adapter/orchestrator over typed use cases.

Out of scope:

- New Telegram commands.
- Provider send behavior.
- Changing webhook response statuses.

Minimum acceptance:

- `telegram-bot-service.ts` is smaller and focused on routing provider updates to use cases.
- Classifier/mapper has focused tests or existing webhook tests still cover it.
- ADR created or updated if dependency direction or adapter boundary changes.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`
- `npx vitest run apps/api/test/public-intake.test.ts`

### P2-2: Decouple timeline evidence types from repository/service contracts

Scope:

- Ensure `modules/timeline` does not depend on broad repository contract files or service implementation types when neutral local event input types are enough.
- Preserve event names and metadata shapes.
- Keep timeline event builders centralized.

Out of scope:

- Renaming timeline event types.
- Changing manager-visible timeline payloads.
- Changing evidence semantics.

Minimum acceptance:

- Timeline dependency direction is explicit and neutral.
- Boundary test protects timeline from importing service implementations or broad repository files unnecessarily.
- ADR created or updated if timeline dependency ownership changes.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`
- `npx vitest run apps/api/test/public-intake.test.ts`
- `npx vitest run apps/api/test/telegram-delivery-service.test.ts`

### P2-3: Narrow widget intake AI dependency

Scope:

- Keep `PublicWidgetIntakeService` focused on contract validation, persistence sequencing and response mapping.
- Inject a narrow AI reply generator interface instead of constructing `WidgetAiService` internally if this reduces coupling.
- Consider extracting public response builders only if it makes tests clearer.

Out of scope:

- Prompt rewrite.
- Model change.
- New AI policy.
- OpenAI adapter changes.
- Public widget response contract changes.

Minimum acceptance:

- Widget message persists before AI generation exactly as before.
- AI fallback behavior remains unchanged.
- No provider details leak into intake use case.
- ADR created or updated only if dependency assembly or AI boundary changes meaningfully.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/public-intake.test.ts`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`

### P3-1: Split manager UI helpers/hooks only after backend boundaries settle

Scope:

- Extract stable label/format helpers from `apps/manager/src/App.tsx`.
- Extract data-loading/mutation hooks only if it reduces local state risk.
- Keep manager UI using operations API as source of truth.

Out of scope:

- UI redesign.
- API contract changes.
- New manager workflows.
- Moving takeover/assignment truth into UI state.

Minimum acceptance:

- `App.tsx` becomes easier to scan without changing visible behavior.
- API client and backend contracts remain unchanged.
- ADR created only if a meaningful UI state boundary is introduced.

Checks:

- `npm -w @granit/manager run typecheck`
- `npm -w @granit/manager run build`
- `npm run typecheck`

### P3-2: Compatibility exports cleanup plan, not removal

Scope:

- Make new imports prefer `apps/api/src/modules/*`.
- Keep old `apps/api/src/auth`, `routes`, `services`, `repositories` exports during this phase.
- Add or update a boundary test that discourages new production code from importing old compatibility paths.

Out of scope:

- Removing compatibility exports.
- Breaking tests, scripts or package exports.

Minimum acceptance:

- Compatibility exports remain available.
- New code path uses `modules/*`.
- ADR created or updated if the team decides a deprecation/removal policy.

Checks:

- `npm run typecheck`
- `npx vitest run apps/api/test/modular-boundaries.test.ts`
- `npm test`

### P3-3: Split large public intake test fixture

Scope:

- Move `MemoryIntakeRepository`, fake manager auth repository, fake AI provider and Telegram fixtures into test helpers.
- Keep test behavior and scenario names intact where practical.

Out of scope:

- Rewriting production code.
- Replacing scenario tests with broad mocks that reduce confidence.

Minimum acceptance:

- `apps/api/test/public-intake.test.ts` becomes smaller.
- Helpers are local to tests and do not become production abstractions.
- No ADR required unless test architecture affects production boundaries.

Checks:

- `npx vitest run apps/api/test/public-intake.test.ts`
- `npm test`

## Files Likely Touched

- `apps/api/src/modules/conversations/repositories/intake-repository.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/src/modules/conversations/**`
- `apps/api/src/modules/manager/**`
- `apps/api/src/modules/telegram/inbound/**`
- `apps/api/src/modules/timeline/timeline-events.ts`
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/api/src/modules/ai/services/widget-ai-service.ts`
- `apps/api/test/modular-boundaries.test.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/**/helpers*`
- `apps/manager/src/App.tsx`
- `apps/manager/src/**`
- `docs/adr/*.md`
- `docs/tasks/OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md`
- release evidence docs for any implemented slice

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| Read-only audit | completed | No code changes were made during audit. |
| 2026-06-04 docs status review | completed | ADR-004 through ADR-009 confirm that P1-1, P1-2, P2-1, P2-2, P2-3 and P3-2 were accepted after the original task pack was written. |
| 2026-06-04 deepening proposal review | completed | Read-only proposal only; no code or architecture changes were made and no tests were run. |

## Evidence Links

- Source guardrails: `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
- Modular monolith task: `docs/tasks/MODULAR_MONOLITH_REFACTOR_RU.md`
- Guardrails fix task: `docs/tasks/MODULAR_MONOLITH_GUARDRAILS_FIX_RU.md`
- Ops API modular monolith architecture: `docs/architecture/OPS_API_MODULAR_MONOLITH_RU.md`
- ADR index: `docs/adr/README.md`
- Repository port split ADR: `docs/adr/ADR-004-CONVERSATION_REPOSITORY_PORT_SPLIT_RU.md`
- Manager Telegram persistence ADR: `docs/adr/ADR-005-MANAGER_TELEGRAM_PERSISTENCE_BOUNDARY_RU.md`
- Telegram inbound mapper ADR: `docs/adr/ADR-006-TELEGRAM_INBOUND_MAPPER_BOUNDARY_RU.md`
- Timeline event input ADR: `docs/adr/ADR-007-TIMELINE_EVENT_INPUT_BOUNDARY_RU.md`
- Public widget AI reply generator ADR: `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md`
- Compatibility export policy ADR: `docs/adr/ADR-009-COMPATIBILITY_EXPORT_POLICY_RU.md`
- External skill used for 2026-06-04 proposal vocabulary: `https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture`

## Blockers

- None known.
- Production/staging deploy is not part of these refactor tasks.
- Existing dirty docs in the worktree must not be reverted or mixed into refactor patches.

## Next Action

Do not restart P1-1 through P2-3 or P3-2; they are accepted via ADR-004 through ADR-009.

If continuing this task pack, choose one of the remaining optional cleanup slices:

- P3-1: split manager UI helpers/hooks only if `apps/manager/src/App.tsx` causes real state/locality friction.
- P3-3: split the large public intake test fixture only as test-maintenance cleanup.

If working from the newer architectural smells review, create separate focused task docs for new risks instead of editing this task pack into a catch-all. Good candidates are:

- Strong first follow-up: deepen manager lead persistence/read model out of `PostgresIntakeRepository` while keeping the aggregate compatibility facade.
- Worth exploring: deepen widget AI reply gate around unsafe model output and evidence validation.
- Worth exploring: deepen manager UI workspace state only if the current `ManagerWorkspace` state shape creates real locality friction.
- Speculative: split test adapter/public intake fixture as test-maintenance cleanup.

Do not reopen Telegram inbound mapper/classifier or compatibility export removal from this task pack; ADR-006 and ADR-009 already record those decisions.
