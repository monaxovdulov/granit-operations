# Evidence: S02-MANAGER-AUTH-YANDEX - Backend Auth Slice

Status: accepted_staging_owner_checked
Date: 2026-05-12
Repo: `granit-operations`
Slice: S02
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Contract/version: manager auth backend slice

Update 2026-05-13: `/manager` is explicitly treated as a public static login
shell with no embedded lead/session data. Manager data access is protected at
the JSON API boundary.

Update 2026-05-13T14:00Z: after the S02/S03 staging rebuild, live checks
confirmed `manager.botops.ru` redirects `/` to `/manager`, OAuth start returns a
Yandex redirect with `HttpOnly`, `Secure`, `SameSite=Lax` state cookie, and
manager JSON APIs return `401` without session. A temporary server-side staging
session was used only for API smoke; cookie/token values were not recorded.

Update 2026-05-13T14:10Z: owner browser check after Yandex login passed in chat.
S02 auth is accepted for continuing to S04. This is not production approval.

## Что Проверяли

- Public intake remains unauthenticated.
- `/manager` login shell can be fetched without session but does not embed
  lead/contact/request data.
- Manager lead APIs require a valid server-side session.
- Yandex OAuth start creates signed state + PKCE redirect.
- Yandex callback allows only DB allowlisted email and binds Yandex uid.
- Outside-allowlist Yandex account is denied.
- Logout revokes the server-side session.
- Secure runtime cookie flags are `HttpOnly`, `Secure`, and `SameSite=Lax`.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Passed | TypeScript compile check. |
| `npm run smoke:api` | Passed | Public intake + authenticated manager visibility test. |
| `npm test` | Passed | 13 tests, including S02 manager auth tests. |
| Fastify inject `GET /manager` without session | Passed | Public static login shell returned noindex/no-store HTML and did not include lead/contact/request data. |
| secure cookie flags test | Passed | OAuth state and manager session cookies include `HttpOnly`, `Secure`, `SameSite=Lax` when `cookieSecure=true`. |
| staging ops-api rebuild/restart | Passed | API container rebuilt and restarted. |
| staging `GET /health` | Passed | Local API returned healthy response. |
| staging public intake POST | Passed | Local API returned `202`. |
| staging unauthenticated `GET /manager/leads` | Passed | Local API returned `401`. |
| staging `GET /auth/yandex/start` without Yandex env | Blocked as expected | Local API returned `503`; fixed after Yandex env was provided. |
| live `GET /auth/yandex/start` | Passed | Public manager domain redirects to Yandex OAuth with signed state and PKCE. |
| live Yandex callback | Passed | User returned from Yandex and backend created session. |
| live `GET /manager/me` with session | Passed | Returned `200` for seeded owner session. |
| live `GET /manager/leads` with session | Passed | Returned `200` for seeded owner session. |
| live `GET /manager/leads` without session | Passed | Returned `401`. |
| live post-rebuild `GET https://manager.botops.ru/` | Passed | Returned `302` to `/manager` with `X-Robots-Tag: noindex, nofollow`. |
| live post-rebuild `GET /auth/yandex/start` | Passed | Returned `302` to Yandex OAuth; state cookie flags were `HttpOnly`, `Secure`, `SameSite=Lax`; value redacted. |
| live post-rebuild `GET /manager/leads` without session | Passed | Returned `401` with `manager_auth_required`. |
| live post-rebuild temporary server-side session API smoke | Passed | `GET /manager/leads`, `GET /manager/leads/:id`, `PATCH status`, `POST /auth/logout`, and post-logout `401` passed without recording token values. |
| owner browser check after Yandex login | Passed | Owner confirmed the signed-in manager UX was normal in chat. |

## Доказательство Поведения

- API/provider result: `POST /public/intake/site-form` still returns public `202` success after persistence.
- DB persistence: S02 migration adds `manager_users` and `manager_sessions`; live auth smoke confirmed allowlisted owner session creation.
- Manager visibility: `/manager/leads` and `/manager/leads/:leadId` return `401` without session and `200` with a valid session in tests; live staging returned `401` without session and `200` with owner session.
- Manager shell policy: unauthenticated `/manager` may serve the React login
  shell, but the shell is cache-disabled, `noindex,nofollow`, and contains no
  lead/contact/request data. This preserves the browser login UX while keeping
  operations data behind session-only APIs.
- Validation/failure path: callback without signed matching `state` returns `400`; outside allowlist returns `403`.
- Idempotency: existing public intake idempotency tests still pass.
- Public response privacy: public intake response still does not expose internal lead ids.
- Paired smoke with site-cms: not run in this auth slice.

## Что Не Записывать

Не добавляйте secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.

## Rollback / Manual Fallback

- Rollback path: revert S02 auth code/migration and remove the manager route from staging proxy if auth must be withdrawn.
- Manual fallback: keep using protected JSON/API checks with server-side sessions while UI or proxy changes are reviewed.

## Blockers / Watch Items

- Temporary Fastify HTML shell was replaced by the React/Vite/Mantine app in
  `docs/release/evidence/S03_MANAGER_UI_MANTINE_RU.md`.
- Keep `X-Robots-Tag: noindex, nofollow` while staging is not production-approved.
- Owner browser login check after the latest rebuild passed. API smoke also
  covered the protected session behavior.

## Sign-Off

- Owner: accepted S02 auth chunk and post-rebuild browser check in chat on 2026-05-13.
- Developer/release owner: accepted for staging API smoke; production approval remains blocked.
- Date: 2026-05-13
