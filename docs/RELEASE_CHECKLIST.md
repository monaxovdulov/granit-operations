# Release Checklist

Status: initial scaffold

S01 is not production approval.

Before S01 acceptance:

- versioned public intake contract artifact exists;
- `granit-site-cms` pins the supported contract version;
- representative `site_form` request persists a lead;
- safe public receipt is returned only after persistence;
- manager inbox/detail shows the lead with source page/form metadata;
- backend failure returns retry/fallback, not success;
- provider checks run for contract changes;
- paired smoke with `granit-site-cms` proves no false success;
- owner-readable evidence is captured.

Deferred from S01:

- AI replies;
- Telegram;
- website widget AI;
- protected public manager UI and auth;
- urgent production notifications;
- full SEO migration;
- production deploy.

Before opening `manager.botops.ru` in a later slice:

- Yandex ID OAuth app exists;
- operations DB allowlist/roles exist;
- first `owner` is seeded through server/admin path;
- non-allowlisted Yandex account cannot see manager data;
- `owner`, `manager`, and logout behavior are smoke-tested;
- `/public/intake/site-form` still works without login;
- owner-readable auth evidence is captured.

Production launch later requires the main wiki G01-G17 readiness contract, staging evidence, backup/restore evidence, rollback path, owner-readable evidence bundle, and explicit owner confirmation.
