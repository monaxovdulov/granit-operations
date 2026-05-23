# Evidence: MODULAR-MONOLITH-REFACTOR

Дата: 2026-05-23
Repo: `granit-operations`
Статус: local verified, not deployed

## Что проверялось

Этот refactor должен был изменить только внутреннюю структуру `ops-api`: один Fastify backend service и один Postgres source of truth остаются. Проверки ниже доказывают, что TypeScript-контракты и текущие regression tests проходят после переноса в `apps/api/src/modules`.

## Baseline до refactor

| Проверка | Результат | Что доказала |
|---|---:|---|
| `npm run typecheck` | passed | Исходное состояние компилировалось до переносов. |
| `npm run smoke:api` | passed, 36 tests | Основной public intake smoke проходил до переносов. |
| `npm test` | passed, 55 tests | Существующие API, auth, Telegram delivery и worker tests проходили до переносов. |

## Проверки после refactor

| Проверка | Результат | Что доказала |
|---|---:|---|
| `npm run typecheck` | passed | Новая module/use-case структура не ломает TypeScript-контракты API и manager app. |
| `npm run smoke:api` | passed, 36 tests | Основной public intake/API smoke проходит после переносов. |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts apps/api/test/telegram-delivery-worker.test.ts` | passed, 12 tests | Telegram delivery service/worker сохраняют retry/failed/uncertain/worker behavior. |
| `npm test` | passed, 59 tests | Все существующие regression tests плюс новые modular boundary tests проходят. |
| `apps/api/test/modular-boundaries.test.ts` | passed, 4 tests | Telegram inbound отделен от delivery sender, delivery не зависит от webhook, runtime assembly идет через module paths, timeline uncertainty events централизованы. |
| `git diff --check` | passed | В изменениях нет whitespace errors. |

## Что стало evidence

- `apps/api/src/modules/*` - новая owner-readable карта подсистем внутри одного backend service.
- `apps/api/src/app-context.ts` - единая сборка use-cases вокруг текущего repository port.
- `apps/api/src/modules/timeline/timeline-events.ts` - централизованные timeline event names и metadata builders.
- `apps/api/test/modular-boundaries.test.ts` - regression guard на главные архитектурные границы.

## Границы доверия

- Production deploy не выполнялся.
- Staging deploy не выполнялся.
- DB migrations не добавлялись и не применялись.
- Реальные Telegram provider calls не выполнялись.
- Compatibility exports на старых путях оставлены намеренно; новый код должен использовать `apps/api/src/modules/*`.
