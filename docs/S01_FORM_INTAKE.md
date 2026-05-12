# S01 Form Intake

Status: implementation scaffold started

S01 objective:

```text
website form -> operations intake API -> stored lead -> manager visibility
```

Operations responsibilities:

- accept a normalized public form intake request from `granit-site-cms`;
- validate the supported public intake contract version;
- enforce idempotency for repeated public form submissions;
- create or update an operations-owned lead;
- store source channel `site_form`, source page URL, form kind, contact fields, timestamp, and referrer/UTM when available;
- create a conversation/message only if needed for the form implementation;
- return a safe public receipt only after backend acceptance and persistence;
- expose the lead in the manager inbox/detail with source page/form metadata;
- return typed validation, unsupported-version, retry, and degradation errors;
- make failures visible enough for owner/manager follow-up.

Implemented S01 provider surfaces:

- public contract `site_form.v1`;
- `POST /public/intake/site-form`;
- Postgres migration for `leads`, `intake_submissions`, and `lead_timeline_events`;
- manager read endpoints `GET /manager/leads` and `GET /manager/leads/:leadId`;
- focused tests for no false success and idempotency.

Forbidden S01 outcomes:

- public success before backend acceptance;
- silent form loss on validation, network, database, or contract-version failure;
- AI replies;
- Telegram;
- widget AI;
- urgent production notifications;
- full SEO migration;
- production deploy.

Existing detail: `docs/product/mvp-soft-release-tz.md`.
