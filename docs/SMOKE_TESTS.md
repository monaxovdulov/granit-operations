# Smoke Tests

Status: focused provider tests added; paired site-cms smoke still required

S01 smoke expectations:

- health check passes, when API exists;
- representative `site_form` request is accepted through the public intake API;
- request includes `schema_version`, idempotency key, source page URL, form kind, contact fields, timestamp, and referrer/UTM when available;
- operations creates or updates an operations-owned lead;
- manager inbox/detail shows the lead with source page/form metadata;
- public response is returned only after persistence;
- backend/database/contract failure returns typed retry/fallback or validation behavior;
- public response avoids internal ids, traces, manager ids, eval labels, handoff internals, raw internal errors, database details, and private notification destinations;
- repeated idempotency key does not create duplicate accepted leads.

Paired smoke with `granit-site-cms` is required before staging traffic reaches the affected path.

Production smoke belongs to a later reviewed release flow and requires explicit owner confirmation for a concrete release candidate.
