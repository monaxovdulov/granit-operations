# Task: S02/S03 Manager Staging Smoke Prep

Status: accepted_staging_smoke
Date: 2026-05-13
Repo: `granit-operations`
Slice: S02a auth shell/cookies + S02b manager UI

## Цель

Подготовить live staging smoke для `manager.botops.ru` после staging rebuild/restart
с текущим `apps/manager/dist`. Этот документ не является production approval и
не требует менять DNS, secrets, env или server config.

Update 2026-05-13T14:00Z: staging DB migration and `ops-api` rebuild/restart
were performed. Automated shell/API smoke passed. Owner browser check after
Yandex login remains the final visual confirmation for the signed-in React UI.

Update 2026-05-13T14:10Z: owner browser check passed in chat. S02/S03 staging
smoke is accepted for continuing to S04. This is not production approval.

## Prerequisites

- Staging API rebuilt/restarted with the current manager static artifact.
- Existing staging domain: `https://manager.botops.ru/`.
- Existing Yandex OAuth runtime env already configured on staging.
- Allowlisted owner/manager account available for browser login.
- Do not record cookie values, OAuth `state`, session tokens, DB URLs, raw lead
  data, or secrets in evidence.

## Smoke Matrix

| Check | Expected |
|---|---|
| `GET https://manager.botops.ru/` without session | `302` to `/manager` with `X-Robots-Tag: noindex, nofollow`; following redirect returns data-free manager login shell. |
| `GET https://manager.botops.ru/manager` without session | `200`, `text/html`, `X-Robots-Tag: noindex, nofollow`, no lead/contact/request data in HTML. |
| `GET https://manager.botops.ru/manager/leads` without session | `401` JSON with `manager_auth_required`. |
| `GET https://manager.botops.ru/auth/yandex/start?return_to=/manager` | `302` to Yandex OAuth; `manager_oauth_state` Set-Cookie has `HttpOnly`, `Secure`, `SameSite=Lax`. Record flags only, not values. |
| Browser login through Yandex as allowlisted user | Returns to manager panel and loads `GET /manager/me`. |
| Inbox | Shows `Заявки`, `Входящие`, status `Новая`, source `Форма сайта`. |
| Detail | Shows request/contact/source fields; referrer label is `Источник перехода`; timeline uses Russian labels. |
| Logout | `POST /auth/logout` clears session; returning to API without cookie gives `401`. |
| Public intake regression | `POST https://botops.ru/public/intake/site-form` still returns `202` only after persistence, if the smoke run intentionally creates a staging test lead. |

## Smoke Results 2026-05-13T14:00Z

| Check | Result | Notes |
|---|---|---|
| S03 DB migration | Passed | `leads_status_check` allows all six S03-min statuses. |
| `ops-api` rebuild/restart | Passed | Docker image rebuilt; `ops-api` restarted healthy on `127.0.0.1:3101`. |
| `GET https://manager.botops.ru/` | Passed | `302` to `/manager`, `X-Robots-Tag: noindex, nofollow`. |
| `GET https://manager.botops.ru/manager` | Passed | React shell served with `/manager/assets/*` and `id="root"`. |
| `GET /manager/leads` without session | Passed | `401` with `manager_auth_required`. |
| `GET /auth/yandex/start?return_to=/manager` | Passed | `302` to Yandex OAuth; state cookie flags verified, value redacted. |
| Public intake fake smoke | Passed | Returned public `202` receipt after persistence. |
| Manager list/detail/status/history | Passed | Temporary server-side session verified visibility, `new -> in_progress`, and `lead.status_changed`. |
| Logout | Passed | `POST /auth/logout` returned `204`; subsequent manager API request returned `401`. |

One earlier fake smoke intake was created before retrying the temporary session
insert after a local `psql` quoting error. It contains only fake staging smoke
data and no customer data.

## Safe CLI Checks

These checks do not require storing cookies:

```bash
curl -sS -o /dev/null -w "manager root: %{http_code} %{redirect_url}\n" https://manager.botops.ru/
curl -sSL -o /dev/null -w "manager shell: %{http_code} %{content_type}\n" https://manager.botops.ru/
curl -sS -o /dev/null -w "manager API unauth: %{http_code} %{content_type}\n" https://manager.botops.ru/manager/leads
```

For cookie flags, inspect only attribute names and redact values before saving
evidence.

## Owner Browser Check

Passed on 2026-05-13 after owner opened `https://manager.botops.ru/`, signed in
through Yandex, and confirmed the browser UX was normal. Automated protected API
smoke already passed.
