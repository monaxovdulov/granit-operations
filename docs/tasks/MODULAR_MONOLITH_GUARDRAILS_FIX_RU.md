# Task: MODULAR-MONOLITH-GUARDRAILS-FIX - Довести `ops-api` modular monolith до Granit TS guardrails

Status: done
Created: 2026-05-23
Repo: `granit-operations`
Slice: architecture/refactor
Owner/agent: Codex follow-up after modular monolith review

## Цель

Исправить review findings после refactor `ops-api` в modular monolith без повторного широкого переписывания.

Бизнес-смысл: границы `ops-api` должны защищать рабочие сценарии Granit - manager auth, takeover, Telegram inbound, Telegram delivery, timeline evidence и AI fallback - от случайных связей между HTTP adapters, provider clients и бизнес-правдой в Postgres.

После этой задачи `ops-api` все еще остается одним Fastify backend service и одним Postgres source of truth. Runtime topology, public API, DB schema, migrations, env names, npm scripts, systemd/runbook topology и production behavior не должны измениться.

## Review Findings To Fix

### P2: raw `request`/`reply` и request mutation в auth/manager boundary

Files:

- `apps/api/src/modules/auth/manager-auth.ts`
- `apps/api/src/modules/auth/routes/manager-auth-routes.ts`
- `apps/api/src/modules/manager/routes/manager-routes.ts`

Что нарушено:

- `ManagerAuthRuntime` сейчас принимает `FastifyRequest/FastifyReply`.
- `requireManagerSession` мутирует request через `request.managerUser`.
- Manager routes читают actor из динамически добавленного поля request.

Почему это риск:

- Role gate для manager actions зависит от Fastify preHandler order и мутации request-like object.
- Это нарушает `granit-ts-code-guardrails`: raw `request`/`reply` не должны выходить из route adapter, а business behavior не должен полагаться на поля, добавленные hook/preHandler.
- Будущие non-HTTP adapters или новые manager actions могут случайно обойти actor/role boundary.

Минимальное исправление:

- Оставить Fastify `request/reply` только в route files.
- Auth layer должен принимать явные DTO, например cookie header/query values, и возвращать typed result.
- Routes должны явно получать `AuthenticatedManager | null` и передавать actor в use cases.
- Убрать `RequestWithManager` и динамическое `request.managerUser` из business flow.
- Domain/business errors вроде forbidden viewer action должны быть typed и мапиться в HTTP adapter.

### P2: dependency assembly не полностью централизован в `app-context`

Files:

- `apps/api/src/app.ts`
- `apps/api/src/app-context.ts`
- `apps/api/src/modules/intake/routes/public-intake-routes.ts`
- `apps/api/src/modules/telegram/inbound/routes/telegram-routes.ts`

Что нарушено:

- `app-context.ts` собирает только часть runtime use cases.
- Public intake routes сами создают `PublicIntakeService` и `PublicWidgetIntakeService`.
- Telegram route сам создает `TelegramBotService`.
- Routes все еще получают широкий `IntakeRepository` там, где нужны узкие use-case interfaces.

Почему это риск:

- Route adapters остаются местом сборки dependencies, а не только HTTP mapping layer.
- Новый код может снова начать прокидывать широкий repository port или infrastructure details в routes.
- Документация говорит, что routes получают use-case objects, но это сейчас верно не для всех routes.

Минимальное исправление:

- В `buildAppContext` собрать:
  - public site-form intake use case;
  - public widget intake use case;
  - manager lead use cases;
  - manager Telegram binding use cases;
  - Telegram inbound handler/service.
- Routes должны принимать узкие typed interfaces/use cases, а не `IntakeRepository`.
- Не добавлять DI container, event bus, generic repo layer или framework abstraction.

### P3: `timeline` зависит от delivery service type

Files:

- `apps/api/src/modules/timeline/timeline-events.ts`
- `apps/api/src/modules/delivery/services/telegram-delivery-service.ts`

Что нарушено:

- Нейтральный timeline module импортирует `RecordTelegramDeliveryFailedInput` из delivery service.
- Это обратная зависимость от evidence/helper слоя к конкретному service layer.

Почему это риск:

- Timeline helpers начинают зависеть от execution service shape.
- При добавлении новых events легко получить циклы или размытие границы между timeline evidence и delivery execution.

Минимальное исправление:

- Завести локальный input type в `timeline-events.ts` или вынести общий delivery event input/status type в нейтральный module.
- Сохранить event names и metadata shape без behavioral changes.

### P3: provider adapters смешаны с service modules

Files:

- `apps/api/src/modules/ai/services/widget-ai-service.ts`
- `apps/api/src/modules/delivery/services/telegram-delivery-service.ts`
- `apps/api/src/index.ts`
- `apps/api/src/scripts/deliver-telegram-pending-once.ts`
- `apps/api/src/scripts/deliver-telegram-worker.ts`

Что нарушено:

- `OpenAiWidgetAssistantProvider` с прямым `fetch` к OpenAI лежит рядом с widget AI service.
- `TelegramBotApiDeliveryProvider` с прямым `fetch` к Telegram Bot API лежит рядом с delivery service.

Почему это риск:

- HTTP/provider quirks, timeout behavior, secret redaction and provider payload handling могут снова протечь в use-case/service layer.
- Сложнее удерживать правило: repositories/adapters own infrastructure references.

Минимальное исправление:

- Вынести provider implementations в adapter files, например:
  - `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`
  - `apps/api/src/modules/delivery/adapters/telegram-bot-api-delivery-provider.ts`
- Оставить public compatibility exports, если текущие tests/scripts/imports ожидают старые paths.
- Не менять provider behavior, timeout policy, response contract или env names.

## Scope

- Исправить только findings выше.
- Сохранить текущие public API endpoints and response bodies.
- Сохранить DB schema and migrations unchanged.
- Сохранить npm scripts and env names unchanged.
- Сохранить Telegram inbound/delivery split:
  - inbound не импортирует delivery;
  - webhook не имеет прямого `sendMessage`;
  - delivery не импортирует webhook/inbound.
- Сохранить Postgres как единственный source of truth для business state.
- Обновить focused boundary tests так, чтобы они ловили новые guardrails:
  - no raw Fastify request/reply outside route adapters;
  - routes do not instantiate business services directly;
  - timeline does not import delivery service implementation/types if a neutral type is enough;
  - provider `fetch` implementations live in adapter modules.

## Acceptance

- `ops-api` остается одним Fastify backend service.
- Public API contracts remain compatible.
- DB schema, migrations, env names, npm scripts and production behavior remain unchanged.
- No broad rewrite and no unrelated dirty files touched.
- Auth/manager routes no longer rely on dynamically mutated `request.managerUser` for business behavior.
- `app-context.ts` is the visible composition root for runtime use cases/services.
- Routes are thin protocol adapters: parse/validate/map HTTP, call typed use cases, map errors/responses.
- `telegram/inbound` and `delivery` remain import-separated.
- Provider HTTP clients live in adapter files or another explicitly infra-owned location.
- Timeline helpers do not depend on delivery service implementation.
- Compatibility exports under old `auth`, `routes`, `services`, `repositories` paths remain unless explicitly decided otherwise.

## Out Of Scope

- Repeating the whole modular monolith refactor.
- Splitting into microservices.
- New DB schema/migrations.
- Queue/event-bus/CQRS/DI-container introduction.
- Redis, BullMQ, pg-boss, Graphile Worker or Kafka.
- New public API behavior.
- Telegram AI outbound enablement.
- `manager_notification_outbox` sender implementation.
- WhatsApp/MAX/call tracking or omnichannel CRM expansion.
- Production/staging deploy.
- UI redesign.

## Suggested Implementation Order

1. Refactor manager auth boundary:
   - convert auth operations to DTO/result functions;
   - keep Fastify `request/reply` in route adapters;
   - pass actor explicitly to manager use cases.
2. Move remaining service construction into `buildAppContext`.
3. Split provider adapters out of service files while keeping compatibility exports.
4. Remove timeline dependency on delivery service type.
5. Strengthen `apps/api/test/modular-boundaries.test.ts` for the fixed guardrails.
6. Run evidence commands and update task/evidence docs.

## Files Likely Touched

- `apps/api/src/app.ts`
- `apps/api/src/app-context.ts`
- `apps/api/src/modules/auth/manager-auth.ts`
- `apps/api/src/modules/auth/routes/manager-auth-routes.ts`
- `apps/api/src/modules/manager/routes/manager-routes.ts`
- `apps/api/src/modules/intake/routes/public-intake-routes.ts`
- `apps/api/src/modules/telegram/inbound/routes/telegram-routes.ts`
- `apps/api/src/modules/ai/services/widget-ai-service.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`
- `apps/api/src/modules/delivery/services/telegram-delivery-service.ts`
- `apps/api/src/modules/delivery/adapters/telegram-bot-api-delivery-provider.ts`
- `apps/api/src/modules/timeline/timeline-events.ts`
- `apps/api/src/index.ts`
- `apps/api/src/scripts/deliver-telegram-pending-once.ts`
- `apps/api/src/scripts/deliver-telegram-worker.ts`
- `apps/api/test/modular-boundaries.test.ts`
- Existing compatibility export files under `apps/api/src/auth`, `routes`, `services`, `repositories` if exports need adjustment.

## Checks To Run

| Command/check | Expected Result | Notes |
|---|---|---|
| `git diff --check` | passed | No whitespace errors. |
| `npm run typecheck` | passed | API and manager TypeScript contracts still compile. |
| `npm run smoke:api` | passed | Public intake/API smoke stays compatible. |
| `npm test -- apps/api/test/modular-boundaries.test.ts` | passed | Guardrails are enforced. |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed | Delivery behavior unchanged. |
| `npm test` | passed | Full regression suite passes. |

## Evidence Links

- Source guardrails: `/home/devuser/ai-projects/granit-plan-app/codex-skills/granit-ts-code-guardrails/SKILL.md`
- Refactor task: `docs/tasks/MODULAR_MONOLITH_REFACTOR_RU.md`
- Architecture doc: `docs/architecture/OPS_API_MODULAR_MONOLITH_RU.md`
- Refactor evidence: `docs/release/evidence/MODULAR_MONOLITH_REFACTOR_RU.md`
- Guardrails fix evidence: `docs/release/evidence/MODULAR_MONOLITH_GUARDRAILS_FIX_RU.md`

## Blockers

- None known.
- Production/staging deploy is not part of this task.
- Review should re-check unrelated dirty docs are not reverted or mixed into the patch.

## Next Action

Human review of the local patch, then merge/deploy through the normal release path if the diff matches the intended scope.
