# Release Scope

Status: initial scaffold

## Current Focus

Start with S01:

```text
website form -> stored lead -> manager visibility
```

This repo must provide the operations side of that flow:

- versioned public intake API;
- validation and idempotency handling;
- operations-owned lead persistence;
- manager inbox/detail visibility;
- safe public receipts and typed errors.

## MVP / Soft Release First

The implementation order is slice based. Each slice must produce owner-readable evidence before moving forward.

S01 does not include:

- AI replies;
- Telegram;
- website widget AI;
- urgent production notifications;
- full SEO migration;
- production deploy.

## Full First Release Later

The full first release later includes website pages/forms/widget, Telegram, manager panel, AI safety, observability/evals, backup/restore, rollback, and release evidence.

Those capabilities must be added only through accepted later slices and release gates.

## Production Deploy Rule

No production deploy is allowed from this scaffold. A later production release requires explicit owner confirmation for a concrete release candidate, plus staging and rollback evidence.
