# MVP / Soft Release Technical Task

Status: initial scaffold

The MVP/soft release starts with S01, not the whole production release.

## S01 Objective

Prove that a public website form creates or updates an operations-owned lead before any public success UI appears.

Required flow:

```text
public website form
  -> operations public intake API
  -> validate contract version and request
  -> persist lead and source metadata
  -> expose the lead in the manager inbox/detail
  -> return a safe public receipt
  -> site may show success only after backend acceptance
```

## S01 Acceptance

- A representative `site_form` request is accepted through the public intake API.
- The request includes `schema_version`, an idempotency key, source page URL, form kind, contact fields, timestamp, and referrer/UTM when available.
- The operation creates or updates an operations-owned lead.
- Manager inbox shows the lead with `site_form` source, source page/form metadata, contact summary, created time, and status `new`.
- Lead detail shows contact fields, request text/details, source metadata, public submission id mapping, and a creation timeline entry.
- Public success response is returned only after persistence.
- Backend/database/contract failure returns typed retry/fallback or validation behavior, not silent loss and not public success.
- Public response does not expose internal `lead_id`, `conversation_id`, `trace_id`, manager ids, eval labels, or handoff internals.

## Explicitly Out Of S01

- AI auto-replies.
- Website widget AI.
- Telegram.
- Urgent production notifications.
- Full SEO migration.
- Production deploy.

## Release Stance

S01 is evidence for the no-lost-lead path. It is not approval to send production traffic.

Production launch still requires the G01-G17 readiness contract, staging evidence, backup/restore evidence, rollback path, owner-readable evidence bundle, and explicit owner confirmation.
