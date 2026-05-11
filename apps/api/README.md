# apps/api

Placeholder for the Fastify operations API.

S01 responsibilities:

- expose the public intake API for `site_form`;
- validate the supported contract version;
- enforce idempotency for public form submissions;
- persist operations-owned lead data before returning success;
- return typed validation, unsupported-version, retry, and fallback responses;
- never expose internal lead ids, trace ids, manager ids, eval labels, or database details in public responses.

No implementation or dependencies are installed in this scaffold.
