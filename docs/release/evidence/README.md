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

Current evidence records:

- `S01_PUBLIC_INTAKE_PROVIDER_RU.md` - public intake provider and manager visibility evidence.
- `S02_MANAGER_AUTH_YANDEX_RU.md` - Yandex ID manager auth/session evidence.
- `S03_MANAGER_UI_MANTINE_RU.md` - React/Vite/Mantine manager UI evidence.
- `S03_MIN_LIFECYCLE_RU.md` - minimal statuses and status-change history evidence.
- `S04_WIDGET_PERSISTENCE_RU.md` - widget message persistence and manager visibility evidence.
- `S05_WEBSITE_SAFE_AI_RU.md` - local safe AI backend, persistence, manager visibility, and fallback evidence.
- `S06_MANAGER_TAKEOVER_RU.md` - manager takeover, blocked follow-up AI, and stale draft send-time gate evidence.
- `P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` - channel-neutral widget/Telegram-ready conversation foundation evidence.
