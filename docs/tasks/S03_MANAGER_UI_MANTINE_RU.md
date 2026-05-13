# Task: S03-MANAGER-UI-MANTINE - React Manager Panel

Status: needs_review
Created: 2026-05-12
Repo: `granit-operations`
Slice: S02b / S03 candidate
Owner/agent: owner + implementation agent

## Цель

Заменить временный Fastify HTML shell на постоянную manager panel:
React + Vite + Mantine, same-origin API calls, server-side auth/session через
уже реализованный S02 Yandex ID flow.

Этот срез закрывает read-only русскую UI-панель для S02b. Отдельный
`S03-min` lifecycle со статусами, сменой статуса и записью истории теперь
описан в `S03_MIN_LIFECYCLE_RU.md`.

## Scope

- Scaffold `apps/manager` as React + Vite + Mantine app.
- Add manager login state that calls `GET /manager/me`.
- Add inbox for protected `GET /manager/leads`.
- Add lead detail view through `GET /manager/leads/:leadId`.
- Add logout through `POST /auth/logout`.
- Keep auth server-side with HttpOnly cookie; do not put tokens in browser state.
- Build manager static artifact under `apps/manager/dist`.
- Serve `/manager` and `/manager/assets/*` from `apps/api`.
- Keep manager app shell `noindex,nofollow`.
- Render public UI labels/errors/statuses/source/timeline terms in Russian at
  the UI boundary while keeping internal API/DB codes stable.

## Out Of Scope

- Production launch.
- Team management UI under `Настройки -> Команда`.
- Lead lifecycle/status changes beyond current read-only `new`.
- Assignment, reminders, takeover, analytics, AI, Telegram.
- Changing deployed runtime secrets or documenting secret values.

## Files Touched

- `apps/manager/index.html`
- `apps/manager/package.json`
- `apps/manager/tsconfig.json`
- `apps/manager/vite.config.ts`
- `apps/manager/src/App.tsx`
- `apps/manager/src/api.ts`
- `apps/manager/src/main.tsx`
- `apps/manager/src/styles.css`
- `apps/manager/src/types.ts`
- `apps/manager/src/placeholder.ts` removed
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/routes/manager-shell.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `README.md`
- `apps/api/README.md`
- `apps/manager/README.md`
- `docs/MANAGER_PANEL_SCOPE.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | Root API/packages TS plus manager TS. |
| `npm -w @granit/manager run build` | Passed | Vite production artifact created in `apps/manager/dist`. |
| `npm run build` | Passed | Root typecheck plus manager build. |
| `npm test` | Passed | 13 tests. |
| `npm run smoke:api` | Passed | Public intake smoke still passes. |
| Fastify inject `GET /manager` | Passed | Returned `200`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, app root and `/manager/assets/*` links. |
| Fastify inject `GET /manager/leads` without session | Passed | Returned `401` with `manager_auth_required`. |
| UI label scan | Passed | User-facing status/source/role/history/API error labels render Russian strings instead of raw `new`, `site_form`, role codes, event codes, or API errors. |
| Vite dev server | Passed | Local dev UI reachable at `http://localhost:5174/manager/`. |

## Evidence Links

- `docs/release/evidence/S03_MANAGER_UI_MANTINE_RU.md`
- `apps/manager/README.md`
- `docs/MANAGER_PANEL_SCOPE.md`
- `docs/MANAGER_AUTH_YANDEX_RU.md`

## Blockers

- Live deploy/restart of the updated static manager app was not performed in this task.
- Production approval remains blocked by release gates and explicit owner sign-off.
- This document is not the `S03-min` lifecycle evidence; use
  `S03_MIN_LIFECYCLE_RU.md` and `release/evidence/S03_MIN_LIFECYCLE_RU.md` for that slice.

## Next Action

Review the UI slice, then deploy/rebuild staging API with the new
`apps/manager/dist` artifact and run live smoke on `manager.botops.ru`:
signed-out login state, Yandex login, inbox load, detail load, logout, and
unauthenticated JSON `401`.
