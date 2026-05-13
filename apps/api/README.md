# apps/api

Fastify operations API for S01/S02.

S01 responsibilities:

- expose the public intake API for `site_form`;
- validate the supported contract version;
- enforce idempotency for public form submissions;
- persist operations-owned lead data before returning success;
- return typed validation, unsupported-version, retry, and fallback responses;
- never expose internal lead ids, trace ids, manager ids, eval labels, or database details in public responses.

Implemented endpoints:

- `GET /health`;
- `POST /public/intake/site-form`;
- `GET /auth/yandex/start`;
- `GET /auth/yandex/callback`;
- `POST /auth/logout`;
- `GET /manager` static React manager app shell;
- `GET /manager/assets/*` static manager assets after `apps/manager` build;
- `GET /manager/me`;
- protected `GET /manager/leads`;
- protected `GET /manager/leads/:leadId`;
- protected `PATCH /manager/leads/:leadId/status`.

S03-min status changes accept only:

- `new`;
- `in_progress`;
- `waiting_response`;
- `closed`;
- `duplicate`;
- `spam`.

Each real status change writes `lead.status_changed` into the lead timeline.

Manager auth is disabled closed when Yandex/session env is incomplete: public intake still works, but manager endpoints return `401` and OAuth start returns `503`. Required env names are documented in `../../docs/MANAGER_AUTH_YANDEX_RU.md`; do not put secret values in git.

`/manager` itself serves the public data-free login shell and sets
`X-Robots-Tag: noindex, nofollow` plus `Cache-Control: no-store`. The app shell
does not contain lead data; it loads manager data only through protected JSON
endpoints.

`DATABASE_URL` is required only when starting the API against Postgres. Focused route tests use an in-memory repository.
