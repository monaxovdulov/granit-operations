# Evidence: S03-MANAGER-UI-MANTINE - React Manager Panel

Status: accepted_staging_owner_checked
Date: 2026-05-12
Repo: `granit-operations`
Slice: S02b / S03 candidate
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Contract/version: manager UI static app over S02 protected API

Update 2026-05-13: this evidence should be read as S02b read-only manager UI
evidence. `S03-min` lifecycle is now covered separately by
`S03_MIN_LIFECYCLE_RU.md`.

Update 2026-05-13T14:00Z: staging `ops-api` was rebuilt/restarted from the
current `granit-operations` checkout. `https://manager.botops.ru/manager`
served the React/Vite shell with `/manager/assets/*` hashed JS/CSS and
`<div id="root"></div>`. The old temporary HTML login shell was no longer the
served artifact.

Update 2026-05-13T14:10Z: owner browser check after Yandex login passed in chat.
S02b UI is accepted for continuing to S04. This is not production approval.

## Что Проверяли

- `apps/manager` builds as React + Vite + Mantine.
- Manager app uses same-origin API calls to `/manager/me`, `/manager/leads`,
  `/manager/leads/:leadId`, and `/auth/logout`.
- API serves the built manager app at `/manager`.
- Static manager shell does not embed lead data.
- Protected manager JSON endpoints still require a valid session.
- Public intake tests still pass.
- Manager app shell keeps `noindex,nofollow` while staging.
- User-facing labels/errors/status/source/timeline text render in Russian at the
  UI boundary; internal API/DB codes remain unchanged.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | Root API/packages TS and manager TS. |
| `npm -w @granit/manager run build` | Passed | Vite build generated `apps/manager/dist/index.html` and hashed assets. |
| `npm run build` | Passed | Combined root typecheck and manager build. |
| `npm test` | Passed | 13 tests. |
| `npm run smoke:api` | Passed | Public intake focused smoke. |
| Fastify inject `GET /manager` | Passed | Returned `200`, app root, asset links, `X-Robots-Tag: noindex, nofollow`, and `Cache-Control: no-store`. |
| Fastify inject `GET /manager/leads` without session | Passed | Returned `401` with `manager_auth_required`. |
| UI label scan | Passed | User-facing UI no longer shows raw `new`, `site_form`, role codes, event codes, or raw API status strings. |
| Vite dev server | Passed | Local UI opened on `http://localhost:5174/manager/`. |
| live post-rebuild `GET https://manager.botops.ru/` | Passed | Returned `302` to `/manager` with `X-Robots-Tag: noindex, nofollow`. |
| live post-rebuild `GET https://manager.botops.ru/manager` | Passed | Returned React app shell HTML with `/manager/assets/*` links and `id="root"`. |
| live post-rebuild `GET /manager/leads` without session | Passed | Returned `401` with `manager_auth_required`. |
| live post-rebuild auth/API smoke with temporary server-side session | Passed | Manager list/detail/status/logout paths worked over the protected API. |
| owner browser check after Yandex login | Passed | Owner confirmed the signed-in manager UX was normal in chat. |

## Доказательство Поведения

- API/provider result: public intake behavior unchanged; focused smoke passed.
- DB persistence: no DB schema changes in this UI slice.
- Manager visibility: manager app shell is public HTML, but manager data loads only
  through protected JSON endpoints; unauthenticated `/manager/leads` returned `401`.
- Validation/failure path: signed-out browser state renders Yandex login action after
  `/manager/me` returns `401`.
- Idempotency: existing public intake idempotency tests still pass.
- Public response privacy: static manager shell contains no raw lead data or session
  token values.
- UI localization: statuses render as `Новая`, source channel as `Форма сайта`,
  roles as Russian role labels, referrer as `Источник перехода`, timeline
  creation event as Russian copy, and API failures as controlled Russian
  messages.
- Paired smoke with site-cms: not run in this UI task.

## Что Не Записывать

Не добавляйте secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.

## Rollback / Manual Fallback

- Rollback path: revert the S03 UI changes or serve the previous temporary shell
  while keeping protected JSON endpoints from S02.
- Manual fallback: use protected manager JSON checks with a valid owner session
  until the React UI is redeployed and smoke-tested.

## Blockers / Watch Items

- Staging deploy/rebuild of the updated manager static artifact passed on
  2026-05-13T14:00Z.
- Keep `X-Robots-Tag: noindex, nofollow` on `manager.botops.ru` while staging.
- Owner browser check passed after Yandex login. Automated API smoke also
  verified the protected data paths.
- Do not accept this document itself as `S03-min` lifecycle evidence. Minimal
  statuses and status-change history are covered by
  `S03_MIN_LIFECYCLE_RU.md`.

## Sign-Off

- Owner: accepted S02b UI chunk and post-rebuild browser check in chat on 2026-05-13.
- Developer/release owner: accepted for staging shell/API smoke; production approval remains blocked.
- Date: 2026-05-13
