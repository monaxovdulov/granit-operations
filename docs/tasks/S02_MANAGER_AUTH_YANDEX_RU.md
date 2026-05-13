# Task: S02-MANAGER-AUTH-YANDEX - Protected Manager Login

Status: needs_review
Created: 2026-05-12
Repo: `granit-operations`
Slice: S02 candidate
Owner/agent: owner + implementation agent

## Цель

Сделать `manager.botops.ru` защищенной manager platform: вход через Яндекс ID, доступ только для пользователей из operations allowlist/roles, без публичного доступа к заявкам.

## Scope

- Добавить Яндекс ID OAuth login flow.
- Добавить server-side session cookie.
- Защитить manager JSON API: `/manager/me`, `/manager/leads`,
  `/manager/leads/:leadId`.
- Формализовать `/manager` как публичную static login shell без lead/session
  data; заявки загружаются только через защищенные JSON endpoints.
- Добавить DB allowlist для manager users.
- Seed первого `owner` через server/admin path.
- Первый UX добавления менеджера: владелец просит Codex/admin добавить email в allowlist.
- Позже отдельным slice добавить UI `Настройки -> Команда` только для роли `owner`.
- Сохранить `/public/intake/site-form` публичным.

## Out Of Scope

- Production launch.
- Public signup.
- Self-service owner creation.
- Открытие leads без авторизации.
- AI replies, Telegram, website widget AI.
- DNS/proxy/deploy changes без отдельного explicit task.

## Files Touched

Expected later implementation scope:

- `apps/api/src/**` auth/session routes and middleware.
- `apps/manager/src/**` login shell and manager shell.
- `packages/db/migrations/**` manager users/session tables if needed.
- `docs/MANAGER_AUTH_YANDEX_RU.md`.
- `docs/MANAGER_PANEL_SCOPE.md`.
- `docs/env/secrets-inventory.example.md`.

Implemented backend slice:

- `GET /auth/yandex/start`;
- `GET /auth/yandex/callback`;
- `POST /auth/logout`;
- protected `GET /manager/me`;
- protected `GET /manager/leads`;
- protected `GET /manager/leads/:leadId`;
- Postgres tables `manager_users` and `manager_sessions`;
- server/admin CLI seed path: `npm run seed:manager-user -- --email user@yandex.ru --role owner`.

Staging route was later opened with `noindex,nofollow`, runtime-only auth env,
and live Yandex smoke evidence. Do not commit runtime secret values.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| Documentation planning | Done | Auth/onboarding UX documented; no app code changed. |
| `npm run build` | Passed | TypeScript compile check. |
| `npm run smoke:api` | Passed | Public intake remains public; manager visibility now uses session in test. |
| `npm test` | Passed | Includes S02 auth/session tests, public data-free shell policy, and secure cookie flags. |
| Fastify inject `GET /manager` without session | Passed | Public login shell returned noindex/no-store HTML without lead/contact/request data. |
| secure cookie flags test | Passed | OAuth state and manager session cookies use `HttpOnly`, `Secure`, and `SameSite=Lax` when secure runtime config is enabled. |
| live Yandex login smoke | Passed | Seeded owner session reached `/manager/me` and `/manager/leads`; signed-out `/manager/leads` returned `401`. |

## Evidence Links

- `docs/MANAGER_AUTH_YANDEX_RU.md`
- `docs/MANAGER_PANEL_SCOPE.md`
- `docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`
- `docs/release/evidence/S02_MANAGER_AUTH_YANDEX_RU.md`

## Blockers

- Need server-only env values to remain outside git/docs; do not write secrets to docs or git.
- Production approval remains blocked by release gates and explicit owner sign-off.
- Owner-only team management UI is still a later slice.
- Staging/live smoke should capture real `Set-Cookie` headers and confirm the
  same `HttpOnly; Secure; SameSite=Lax` attributes without recording token
  values.

## Next Action

- Review S02 evidence, then keep manager access behind allowlist/session while S03 UI is redeployed and smoke-tested.
