# Task: S04-WIDGET-PERSISTENCE - Виджет сохраняет сообщение до AI

Status: needs_review
Created: 2026-05-13
Repo: `granit-operations`
Slice: S04
Owner/agent: Codex

## Цель

Сделать путь `site widget -> operations API -> Postgres persistence -> manager visibility` без AI-ответов.

## Scope

- Утвердить контракт `site_widget.v1`.
- Добавить `POST /public/intake/site-widget/messages`.
- Сохранять widget session, lead, conversation и inbound message.
- Возвращать public success только после persistence.
- Показать диалог и сообщения в manager panel.
- Зафиксировать, что `automation.status` в S04 всегда `disabled`.

## Out Of Scope

- AI/Mastra/OpenAI replies.
- Telegram.
- Takeover/resume controls.
- Production deploy.

## Files Touched

- `packages/contracts/src/site-widget/v1.ts`
- `packages/contracts/schemas/site-widget.v1.json`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0004_s04_widget_persistence.sql`
- `apps/api/src/services/public-widget-intake-service.ts`
- `apps/api/src/routes/public-intake.ts`
- `apps/api/src/repositories/*`
- `apps/api/test/public-intake.test.ts`
- `apps/manager/src/*`
- `docs/contracts/widget-intake-contract.md`
- `docs/env/secrets-inventory.example.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | API/packages and manager TS. |
| `npm run smoke:api` | Passed | 10 tests, including widget persistence and manager visibility. |
| `npm test` | Passed | 17 tests across public intake and manager auth. |
| `npm run build` | Passed | Root typecheck plus manager production build. |
| Temporary Postgres smoke | Passed | `postgres:16-alpine`, migrations `0001..0004`, widget POST, manager detail saw 1 dialog/1 message. |

## Evidence Links

- `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md`
- Site consumer task: `../../granit-site-cms/docs/tasks/S04_WIDGET_PERSISTENCE_RU.md`

## Blockers

- Real Postgres/staging migration and browser smoke still require deploy/review decision.
- Production remains blocked by release gates and explicit sign-off.

## Next Action

Run paired staging smoke after site-cms widget consumer review and approved DB migration.
