# apps/manager

Placeholder for the custom manager panel.

S01 minimum:

- inbox with new website form leads;
- `site_form` source badge;
- source page URL and form kind when available;
- contact summary;
- created time;
- current status, initially `new`;
- lead detail with contact fields, request text/details, source metadata, public submission id mapping, and a creation timeline entry.

Later slices add lifecycle, assignment, follow-ups, takeover, reviews, analytics, AI, and Telegram.

S01 manager visibility is currently exposed as read endpoints from `apps/api`:

- `GET /manager/leads`;
- `GET /manager/leads/:leadId`.

Planned protected access:

- `manager.botops.ru` uses Yandex ID login;
- operations DB allowlist/roles decide who can enter after Yandex login;
- first manager onboarding is owner/Codex/admin-command driven by adding a Yandex email;
- later owner-only UI adds `Настройки -> Команда`;
- no manager lead data is public without a valid session.

Auth plan: `../../docs/MANAGER_AUTH_YANDEX_RU.md`.
