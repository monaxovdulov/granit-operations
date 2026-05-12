# Task: S02-MANAGER-AUTH-YANDEX - Protected Manager Login

Status: planned
Created: 2026-05-12
Repo: `granit-operations`
Slice: S02 candidate
Owner/agent: owner + implementation agent

## Цель

Сделать `manager.botops.ru` защищенной manager platform: вход через Яндекс ID, доступ только для пользователей из operations allowlist/roles, без публичного доступа к заявкам.

## Scope

- Добавить Яндекс ID OAuth login flow.
- Добавить server-side session cookie.
- Защитить `/manager/*` и manager API.
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

This planning update only documents the intended UX and boundaries.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| Documentation planning | Done | Auth/onboarding UX documented; no app code changed. |
| Implementation checks | Pending | To be defined with S02 implementation. |

## Evidence Links

- `docs/MANAGER_AUTH_YANDEX_RU.md`
- `docs/MANAGER_PANEL_SCOPE.md`
- `docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`

## Blockers

- Yandex OAuth app must be created before staging login can work.
- Need owner-provided allowed emails for first `owner` and managers.
- Need server-only env values; do not write secrets to docs or git.
- `manager.botops.ru` must stay closed until auth/session smoke and evidence are complete.

## Next Action

- Owner creates or confirms Yandex OAuth app and allowed email list, then implementation agent builds S02 manager auth without opening manager leads publicly before auth is proven.
