# Release Evidence

Use this directory for owner-readable proof of smoke, review, staging, and release behavior.

For `granit-operations`, evidence usually covers:

- public intake provider checks;
- database persistence smoke;
- manager visibility;
- validation and retry/fallback behavior;
- idempotency;
- paired smoke against the active customer-facing landing repo `monaxovdulov/landing-granit-static`;
- backup/restore/rollback evidence when explicitly in scope.

Historical evidence records before 2026-07-20 may mention `granit-site-cms`. Treat those as historical facts for that evidence date, not as the current customer-facing landing source. Current repo ownership is recorded in `docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`.

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

- `WIDGET_CONVERSATION_SCOPE_19_20260722_RU.md` - staging evidence issue #19: единый cross-page conversation scope, legacy migration, exact catalog navigation/reload и production untouched.
- `WIDGET_AI_AUDIT_13_20260722_RU.md` - итоговый staging-аудит issues #13–#17: dialogue quality, async delivery, safe catalog actions, manager gate, screenshots и rollback evidence.
- `CATALOG_RAG_STAGING_20260720_RU.md` - staging evidence нового канонического каталога, knowledge snapshot, provider, deploy, QA и точного live-AI blocker.
- `S01_PUBLIC_INTAKE_PROVIDER_RU.md` - public intake provider and manager visibility evidence.
- `S02_MANAGER_AUTH_YANDEX_RU.md` - Yandex ID manager auth/session evidence.
- `S03_MANAGER_UI_MANTINE_RU.md` - React/Vite/Mantine manager UI evidence.
- `S03_MIN_LIFECYCLE_RU.md` - minimal statuses and status-change history evidence.
- `S04_WIDGET_PERSISTENCE_RU.md` - widget message persistence and manager visibility evidence.
- `S05_WEBSITE_SAFE_AI_RU.md` - local safe AI backend, persistence, manager visibility, and fallback evidence.
- `S06_MANAGER_TAKEOVER_RU.md` - manager takeover, blocked follow-up AI, and stale draft send-time gate evidence.
- `AI_DIALOG_BOUNDARY_STAGE_A_RU.md` - neutral AI turn boundary implementation evidence before Mastra runtime, Telegram AI outbound or production AI approval.
- `P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` - channel-neutral widget/Telegram-ready conversation foundation evidence.
- `TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md` - Telegram inbound webhook, manager binding, takeover/reply mini-panel, and no-direct-send evidence.
- `TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md` - Telegram delivery sender path, retry/failure status and manager-visible delivery evidence.
- `TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md` - safe sender audit verdict, private-chat hardening, local manual smoke checklist, and controlled staging Bot API smoke evidence.
- `TELEGRAM_MANAGER_REPLY_WORKER_RU.md` - explicit Telegram manager reply worker evidence with local checks and controlled staging worker smoke.
- `TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md` - supervised one-shot scheduler evidence; staging timer smoke passed, production approval remains blocked.

Telegram acceleration assumption, 2026-05-21: requester stated there are currently no real clients and no real managers depending on the Telegram path. Use this to prioritize controlled staging Bot API smoke with test bot/private chats; do not treat it as production approval.
