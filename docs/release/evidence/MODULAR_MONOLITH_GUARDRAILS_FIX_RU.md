# Evidence: MODULAR-MONOLITH-GUARDRAILS-FIX

Дата: 2026-05-23
Repo: `granit-operations`
Статус: local verified, not deployed

## Что проверялось

Guardrails fix должен был сохранить `ops-api` одним Fastify backend service и одним Postgres source of truth, но убрать опасные связи после modular monolith refactor: raw Fastify request/reply вне route adapters, `request.managerUser` как источник бизнес-поведения, service construction внутри routes, provider HTTP clients внутри service modules и зависимость timeline от delivery service type.

## Проверки

| Проверка | Результат | Что доказала |
|---|---:|---|
| `git diff --check` | passed | В изменениях нет whitespace errors. |
| `npm run typecheck` | passed | API и manager TypeScript-контракты компилируются после изменения границ. |
| `npm run smoke:api` | passed, 36 tests | Public intake/API smoke остается совместимым. |
| `npm test -- apps/api/test/modular-boundaries.test.ts` | passed, 7 tests | Boundary tests ловят новые guardrails: request boundary, thin routes, adapter placement и timeline decoupling. |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed, 12 tests | Telegram delivery service/worker behavior не изменился после выноса provider adapter. |
| `npm test` | passed, 62 tests | Полный regression suite проходит. |

## Что стало evidence

- `apps/api/src/modules/auth/manager-auth.ts` больше не принимает `FastifyRequest/FastifyReply` и возвращает typed DTO/results.
- `apps/api/src/modules/manager/use-cases/manager-actor.ts` фиксирует typed manager actor и forbidden error для manager actions.
- `apps/api/src/app-context.ts` стал видимым composition root для public intake, manager use cases и Telegram webhook service.
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts` и `apps/api/src/modules/delivery/adapters/telegram-bot-api-delivery-provider.ts` владеют provider `fetch` calls.
- `apps/api/test/modular-boundaries.test.ts` закрепляет guardrails как regression tests.

## Границы доверия

- Production deploy не выполнялся.
- Staging deploy не выполнялся.
- DB schema/migrations не менялись и не применялись.
- Реальные OpenAI/Telegram provider calls не выполнялись.
- Runtime topology, env names и npm scripts не менялись.
