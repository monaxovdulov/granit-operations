# Task: S03-MIN-LIFECYCLE - Минимальные статусы и история

Status: implemented_local
Created: 2026-05-13
Repo: `granit-operations`
Slice: S03-min
Owner/agent: owner + implementation agent

## Цель

Закрыть минимальный lifecycle перед S04 widget persistence без расширения в полный CRM:
`Новая`, `В работе`, `Ждет ответа`, `Закрыта`, `Дубль`, `Спам` и запись каждой
реальной смены статуса в историю заявки.

## Scope

- Расширить допустимые `leads.status` до S03-min набора.
- Добавить migration для Postgres check constraint.
- Добавить защищенный `PATCH /manager/leads/:leadId/status`.
- Разрешить смену статуса ролям `owner` и `manager`; оставить `viewer` read-only.
- Возвращать обновленную карточку заявки после смены статуса.
- Писать `lead.status_changed` в `lead_timeline_events`.
- Показать статус и смену статуса в React manager UI на русском.
- Показывать status-change event в истории заявки.

## Out Of Scope

- Production launch.
- Полный S03 CRM lifecycle: assignment, reminders, overdue queues, close reasons,
  reopen flow, duplicate merge UI, analytics.
- AI widget, Telegram, takeover/resume.
- Изменение runtime secrets или production/staging deploy.

## Files Touched

- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `apps/api/src/routes/manager.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/manager-auth.test.ts`
- `apps/manager/src/App.tsx`
- `apps/manager/src/api.ts`
- `apps/manager/src/types.ts`
- `apps/manager/src/styles.css`
- `packages/db/migrations/0003_s03_min_lifecycle.sql`
- `docs/LEAD_LIFECYCLE.md`
- `docs/tasks/S03_MIN_LIFECYCLE_RU.md`
- `docs/release/evidence/S03_MIN_LIFECYCLE_RU.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | Root API/packages TS plus manager TS. |
| `npm test` | Passed | 14 tests; includes status change, invalid status `400`, unauthenticated `401`, viewer `403`. |
| `npm -w @granit/manager run build` | Passed | Vite production artifact generated. |
| `npm run build` | Passed | Root typecheck plus manager build. |
| Vite dev server `GET /manager/` | Passed | `http://127.0.0.1:5174/manager/` returned `200 text/html`. |

## Evidence Links

- `docs/release/evidence/S03_MIN_LIFECYCLE_RU.md`
- `docs/LEAD_LIFECYCLE.md`

## Blockers

- Staging DB migration and redeploy were not run in this local implementation task.
- Production approval remains blocked by release gates and explicit owner sign-off.

## Next Action

Apply migration/redeploy on staging and smoke: login, list, detail, status
change, history event, signed-out `401`, viewer `403` if a viewer account is
available.
