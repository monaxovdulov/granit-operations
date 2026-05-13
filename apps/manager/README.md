# apps/manager

React + Vite + Mantine manager panel.

## Stack

- React + Vite;
- Mantine core components from `https://mantine.dev/`;
- Mantine UI blocks from `https://ui.mantine.dev/` when they fit the screen;
- operations API calls through authenticated same-origin `/manager/*` endpoints.

Auth remains server-side. The browser only receives the HttpOnly
`manager_session` cookie and calls protected API endpoints on the same origin.

## Commands

From repo root:

```bash
npm -w @granit/manager run dev
npm -w @granit/manager run build
npm -w @granit/manager run preview
```

The Vite app is mounted at `/manager/`. In local dev, `MANAGER_DEV_API_ORIGIN`
can point the Vite proxy at an API instance; it defaults to
`http://localhost:3001`.

Production/staging uses `npm -w @granit/manager run build`; `apps/api` serves
`apps/manager/dist/index.html` at `/manager` and hashed static assets under
`/manager/assets/*`.

## Current Surface

S01 minimum:

- inbox with new website form leads;
- source badge rendered as `Форма сайта` while the API keeps the internal
  `site_form` code;
- source page URL and form kind when available;
- contact summary;
- created time;
- current status rendered as Russian labels while the API keeps stable internal
  codes;
- S03-min status change for `Новая`, `В работе`, `Ждет ответа`, `Закрыта`,
  `Дубль`, `Спам`;
- lead detail with contact fields, request text/details, source metadata, public submission id mapping, and a creation timeline entry.
- logout through `POST /auth/logout`.

Later slices add lifecycle, assignment, follow-ups, takeover, reviews, analytics, AI, and Telegram.

The UI uses:

- `GET /manager/me`;
- `GET /manager/leads`;
- `GET /manager/leads/:leadId`;
- `PATCH /manager/leads/:leadId/status`.

Protected access:

- `manager.botops.ru` uses Yandex ID login;
- operations DB allowlist/roles decide who can enter after Yandex login;
- first manager onboarding is owner/Codex/admin-command driven by adding a Yandex email;
- later owner-only UI adds `Настройки -> Команда`;
- `/manager` may serve the public static login shell, but the shell contains no
  lead/session data;
- no manager lead data is public without a valid session.

Auth plan: `../../docs/MANAGER_AUTH_YANDEX_RU.md`.
