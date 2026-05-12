# Release Evidence

Use this directory for owner-readable proof of smoke, review, staging, and release behavior.

For `granit-operations`, evidence usually covers:

- public intake provider checks;
- database persistence smoke;
- manager visibility;
- validation and retry/fallback behavior;
- idempotency;
- paired smoke against `granit-site-cms`;
- backup/restore/rollback evidence when explicitly in scope.

Do not store secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials, or full private logs.

Template:

```text
docs/release/evidence/TEMPLATE_RU.md
```

Legacy scaffold:

```text
docs/release/evidence-template.md
```

Prefer the Russian template in this directory for new owner-facing evidence.
