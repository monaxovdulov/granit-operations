# Manager Auth Через Яндекс ID

Status: needs_review
Date: 2026-05-12
Repo: `granit-operations`
Slice: S02 candidate

## Цель

Открыть `manager.botops.ru` только как защищенную manager platform. Вход должен быть через Яндекс ID, но сам факт успешного входа в Яндекс не дает доступ к заявкам. Доступ разрешает только operations allowlist/roles.

## Решение

Использовать Яндекс ID OAuth для login и собственную server-side session в `granit-operations`.

Backend slice implemented locally:

- OAuth authorization-code start/callback with signed `state` cookie and PKCE `S256`;
- Yandex profile fetch uses `Authorization: OAuth <token>`;
- operations DB allowlist/roles/status check through `manager_users`;
- opaque `HttpOnly` server-side session cookie backed by `manager_sessions`;
- `/manager/me`, `/manager/leads`, and `/manager/leads/:leadId` require session;
- `/manager` is a public static login shell only; it is `noindex`, `no-store`,
  and does not embed lead/session data;
- `POST /public/intake/site-form` remains public.

Live staging login smoke passed after runtime-only Yandex OAuth env values and
owner-approved allowlist seed were configured. No secrets or raw runtime values
should be committed.

Минимальный flow:

1. Пользователь открывает `https://manager.botops.ru/`.
2. Если session нет, видит экран входа с кнопкой `Войти через Яндекс`.
3. Backend отправляет пользователя в Яндекс OAuth.
4. Яндекс возвращает пользователя на callback:

```text
https://manager.botops.ru/auth/yandex/callback
```

5. Backend получает профиль Яндекс ID.
6. Backend проверяет email или Yandex user id по allowlist в operations DB.
7. Если доступ разрешен, backend создает `HttpOnly Secure` session cookie.
8. Если доступа нет, пользователь видит отказ без доступа к заявкам и
   защищенным `/manager/*` JSON endpoints.

## Required Routes

- `GET /auth/yandex/start`
- `GET /auth/yandex/callback`
- `POST /auth/logout`
- public data-free `GET /manager` static login shell
- protected `GET /manager/me`
- protected `GET /manager/leads`
- protected `GET /manager/leads/:leadId`

`POST /public/intake/site-form` остается публичным и не требует login.

## Roles

Минимальные роли:

- `owner`: владелец, может управлять командой в будущем UI;
- `manager`: может видеть и обрабатывать заявки;
- `viewer`: read-only роль, если понадобится позже.

Минимальные статусы пользователя:

- `invited`: email добавлен, первый вход еще не привязан к Яндекс ID;
- `active`: пользователь вошел и активен;
- `disabled`: доступ отключен.

## Team Onboarding UX

### Первый релиз

Самый безопасный первый UX:

1. Новый менеджер сообщает владельцу свой Яндекс email.
2. Владелец просит Codex/admin на сервере добавить email:

```text
add manager user <email> role manager
```

3. Email добавляется в operations DB allowlist.
4. Менеджер открывает `https://manager.botops.ru/`.
5. Менеджер нажимает `Войти через Яндекс`.
6. Если email есть в allowlist, пользователь получает доступ.
7. Если email не добавлен, пользователь видит `Нет доступа, обратитесь к владельцу`.

Этот вариант не требует сразу строить owner settings UI и снижает риск случайно открыть доступ не тому человеку.

### Позже

После базового manager UI добавить раздел только для роли `owner`:

```text
Настройки -> Команда
```

Функции:

- список пользователей;
- добавить email;
- выбрать роль `owner`, `manager` или `viewer`;
- видеть статус `invited`, `active`, `disabled`;
- отключить доступ;
- видеть last login;
- audit trail для добавления, изменения роли и отключения.

## Data Model

Планируемая таблица:

```text
manager_users
- id
- email
- yandex_uid nullable
- role: owner | manager | viewer
- status: invited | active | disabled
- invited_by
- created_at
- last_login_at
```

На первом успешном входе по email:

- найти `manager_users.email`;
- если status `invited`, привязать `yandex_uid`;
- перевести в `active`;
- записать `last_login_at`;
- создать session.

Если `yandex_uid` уже привязан, последующие входы должны проверять uid и email. При конфликте доступ запрещается до ручного разбора владельцем/admin.

## Security Requirements

- `YANDEX_CLIENT_SECRET`, session secrets and token exchange details are server-only.
- Не хранить OAuth tokens в browser localStorage/sessionStorage.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax` или `Strict`.
- Login callback должен проверять `state`; PKCE использовать, если выбранная реализация это поддерживает.
- `/manager/*` и manager API без session должны отвечать redirect to login или `401`.
- Public intake endpoint не должен зависеть от manager login.
- Добавление первого `owner` должно быть server/admin controlled, не self-service.
- Не открывать `manager.botops.ru` публично до auth/session smoke и owner-readable evidence.

## Environment Names

Имена без значений:

- `YANDEX_OAUTH_CLIENT_ID`
- `YANDEX_OAUTH_CLIENT_SECRET`
- `YANDEX_OAUTH_REDIRECT_URI`
- `SESSION_SECRET`
- `MANAGER_AUTH_ALLOWED_ORIGINS`

## Server/Admin Seed

Первый `owner` или менеджер добавляется только server/admin путем:

```text
npm run seed:manager-user -- --email user@yandex.ru --role owner
```

Роли: `owner`, `manager`, `viewer`. Статус по умолчанию: `invited`. Реальные email не записывать в docs или git.

## Acceptance Checks

- Непрошедший login не видит `/manager/*`.
- Яндекс account не из allowlist получает отказ.
- Email из allowlist получает session и видит manager shell.
- `manager` не может управлять командой.
- `owner` может быть seeded через server/admin path.
- Logout удаляет session.
- Public `/public/intake/site-form` продолжает работать без login.
- `manager.botops.ru` остается noindex на staging.

## Out Of Scope

- Production launch.
- AI replies.
- Telegram.
- Public signup.
- Self-service owner creation from the browser.
- Opening leads without auth.

## Official References

- Yandex OAuth app registration: `https://yandex.com/dev/id/doc/en/register-client`
- Yandex OAuth implementation: `https://yandex.ru/dev/id/doc/en/concepts/ya-oauth-intro`
- Connecting to API Yandex ID: `https://yandex.ru/dev/id/doc/en/how-to`
- Authorization code + PKCE parameters: `https://yandex.ru/dev/id/doc/en/codes/code-url`
- Yandex ID user info endpoint: `https://yandex.ru/dev/id/doc/en/user-information`
