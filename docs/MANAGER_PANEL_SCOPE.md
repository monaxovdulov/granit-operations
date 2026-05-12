# Manager Panel Scope

Status: initial scaffold

S01 manager panel can be intentionally narrow, but it must prove visibility and no lost lead.

Inbox minimum:

- new website form leads;
- source channel badge `site_form`;
- source page URL and form kind when known;
- contact data summary;
- created time;
- current status, initially `new`;
- indicator for intake errors or fallback cases if any.

Lead detail minimum:

- lead id and public submission id mapping;
- contact fields received from the form;
- request text/details;
- source page URL, form kind, referrer/UTM when available;
- timeline entry for lead creation/form recording;
- current status;
- internal note placeholder is acceptable.

Later slices add lifecycle, assignment, reminders, overdue queue, takeover/resume, bad-case review, and simple analytics.

Existing placeholder: `apps/manager/README.md`.

## Staging Domain Decision

Accepted staging domain for the future protected operations platform / manager UI:

```text
manager.botops.ru
```

Current S01 staging does not expose manager UI publicly. Manager visibility checks still use the local-only API on the staging server. Opening `manager.botops.ru` requires a later explicitly scoped task with DNS, reverse proxy, auth/session protection, noindex behavior, and evidence.

Decision record: `docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`.

## Planned Auth / Access Model

Planned protected manager access is documented in `docs/MANAGER_AUTH_YANDEX_RU.md`.

Decision summary:

- login through Yandex ID OAuth;
- access only after operations DB allowlist/role check;
- first release manager onboarding through owner/Codex/admin command that adds a Yandex email to the allowlist;
- later owner-only UI under `Настройки -> Команда` for adding, disabling, and changing roles;
- roles start with `owner`, `manager`, and optional `viewer`;
- public intake remains unauthenticated;
- manager leads must not be visible without a valid session.

`manager.botops.ru` should not be opened until this auth/session behavior has staging smoke evidence.
