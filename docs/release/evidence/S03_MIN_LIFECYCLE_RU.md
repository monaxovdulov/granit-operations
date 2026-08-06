# Evidence: S03-MIN-LIFECYCLE - Минимальные статусы и история

Status: accepted_staging_owner_checked
Date: 2026-05-13
Repo: `granit-operations`
Slice: S03-min
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Contract/version: manager lifecycle API over S02 protected session

Update 2026-05-13T14:00Z: migration `0003_s03_min_lifecycle.sql` was applied
to staging and `ops-api` was rebuilt/restarted. A fake staging smoke lead was
created through public intake, then a temporary server-side manager session was
used to verify manager visibility, status change `new -> in_progress`, appended
`lead.status_changed` history event, logout `204`, and post-logout `401`.
Cookie/token values and raw lead data were not recorded.

Update 2026-05-13T14:10Z: owner browser check passed in chat. S03-min is
accepted for continuing to S04. This is not production approval.

## Что Проверяли

- Manager API accepts the minimal status set:
  `new`, `in_progress`, `waiting_response`, `closed`, `duplicate`, `spam`.
- `PATCH /manager/leads/:leadId/status` requires a manager session.
- Status change updates the lead and writes a `lead.status_changed` history event.
- Status-change history includes previous status, next status, and manager actor metadata.
- Manager UI renders all S03-min statuses in Russian:
  `Новая`, `В работе`, `Ждет ответа`, `Закрыта`, `Дубль`, `Спам`.
- Public intake behavior remains unchanged.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | Root API/packages TS plus manager TS. |
| `npm test` | Passed | 14 tests; includes status change, invalid status `400`, unauthenticated `401`, viewer `403`. |
| `npm -w @granit/manager run build` | Passed | Vite production artifact generated. |
| `npm run build` | Passed | Root typecheck plus manager build. |
| Vite dev server `GET /manager/` | Passed | `http://127.0.0.1:5174/manager/` returned `200 text/html`. |
| staging DB constraint check | Passed | `leads_status_check` allows `new`, `in_progress`, `waiting_response`, `closed`, `duplicate`, `spam`. |
| staging `ops-api` rebuild/restart | Passed | Docker image rebuilt with current `apps/manager/dist`; container restarted healthy. |
| live public intake smoke | Passed | Fake staging request returned public `202` receipt after persistence. |
| live manager status/history smoke | Passed | Protected API changed fake smoke lead `new -> in_progress` and returned a matching `lead.status_changed` event. |
| live logout regression | Passed | `POST /auth/logout` returned `204`; subsequent manager API request returned `401`. |
| owner browser check after Yandex login | Passed | Owner confirmed the signed-in manager UX was normal in chat. |

## Доказательство Поведения

- API/provider result: local route test and live staging smoke create a public
  lead, then change status through protected manager API.
- DB persistence: migration `0003_s03_min_lifecycle.sql` expands the `leads.status`
  check constraint; staging constraint was verified after migration.
- Manager visibility: updated detail response returns the changed status and the
  appended `lead.status_changed` timeline event.
- Validation/failure path: invalid status returns `400`; unauthenticated status
  change returns `401`; viewer status change returns `403`.
- Public response privacy: public intake response still does not expose internal
  lead ids, manager ids, trace ids, DB details, or raw internal errors.
- Paired smoke with site-cms: live staging public intake on `botops.ru` returned
  a public `202` receipt and the fake smoke lead was visible to manager API.

## Что Не Записывать

Не добавляйте secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.

## Rollback / Manual Fallback

- Rollback path: revert the S03-min code changes and migration before staging
  rollout, or restore the previous DB constraint that allowed only `new`.
- Manual fallback: keep manager panel read-only and handle lifecycle state outside
  the app until the migration/API are redeployed.

## Blockers / Watch Items

- Staging migration/redeploy/API smoke passed on 2026-05-13T14:00Z.
- Owner browser check passed after Yandex login.
- Production launch remains blocked by release gates and explicit owner sign-off.
- Full S03 lifecycle remains later scope: close reasons, reopen, reminders,
  assignment, duplicate merge UI, analytics.

## Sign-Off

- Owner: accepted S03-min chunk and post-rebuild browser check in chat on 2026-05-13.
- Developer/release owner: accepted for staging API smoke; production approval remains blocked.
- Date: 2026-05-13
