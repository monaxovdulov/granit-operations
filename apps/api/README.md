# apps/api

Fastify operations API for S01.

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
- `GET /manager/leads`;
- `GET /manager/leads/:leadId`.

`DATABASE_URL` is required only when starting the API against Postgres. Focused route tests use an in-memory repository.
