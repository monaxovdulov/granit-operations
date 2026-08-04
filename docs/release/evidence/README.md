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

- `STAGING_FEATURE_BASELINE_20260803_RU.md` - текущая staging feature baseline по продуктовым
  фичам: `landing@628e4a07` + widget `v1.1.4@c44f9963` + backend runtime
  `https://manager.botops.ru`; smoke/regression evidence intentionally pending.
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
- `SITE_WIDGET_V1_CROSS_REPO_ACCEPTANCE_RU.md` - accepted G0/P0 record linking the exact
  `site_widget.v1` provider, widget source, preview integration, CI/deploy runs and deployed bundle
  hashes before P1/W0.
- `AI_DIALOG_BOUNDARY_STAGE_A_RU.md` - neutral AI turn boundary implementation evidence before Mastra runtime, Telegram AI outbound or production AI approval.
- `AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md` - G1/P1 evidence for bounded causal history,
  app-only persistence identity, structural legacy orchestration and frozen direct S05 checks.
- `AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md` - local evidence for the disabled provider-neutral P1Q core
  at `78c9947`; this records `core_local_checks_passed`, not G1Q sign-off, deployment or runtime
  enablement. Its later gate status is superseded by the G1Q evidence below.
- `AI_DIALOG_P1Q_FACTS_SOURCE_AUDIT_RU.md` - exact-object source and semantic audit of the
  corrected 15-row P1Q facts proposal pinned to remote-resolvable `granit-site-cms@23f2ee8...`;
  this remains historical pre-approval proposal evidence.
- `AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md` - authoritative G1Q closure: exact owner acceptance,
  schema-validated 15-row production snapshot at `1d737e0`, repeated checks, runtime still
  disabled/not deployed and P2 unblocked.
- `AI_DIALOG_OBSERVABILITY_P2_RU.md` - exact-SHA P2 evidence for app-owned run/span/quality
  persistence, configured/observed model truth, atomic outbound linkage, fail-closed replay,
  disposable PostgreSQL fresh/upgrade proof and zero live provider calls.
- `AI_DIALOG_PRIVACY_VISIBILITY_P3_RU.md` - exact-SHA P3 evidence for protected manager quality
  visibility, strict approved assets, centralized fail-closed observability sanitizer, bounded
  span-only retention and zero live provider calls.
- `AI_DIALOG_MASTRA_M2_RU.md` - exact-SHA M2 evidence for the deterministic local/fake Mastra
  `live_v2` path, honest configured/observed runtime evidence, controlled no-reply semantics,
  atomic takeover/replay checks, PostgreSQL fresh/upgrade proof and zero real provider calls.
- `AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md` - honest M3 staging record: exact-SHA first
  authenticated Mastra attempt, fail-closed generator failure, durable sanitized run/span/quality
  evidence, no outbound/retry/secret leak and the remaining external/provider blocker.
- `P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` - channel-neutral widget/Telegram-ready conversation foundation evidence.
- `TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md` - Telegram inbound webhook, manager binding, takeover/reply mini-panel, and no-direct-send evidence.
- `TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md` - Telegram delivery sender path, retry/failure status and manager-visible delivery evidence.
- `TELEGRAM_SAFE_SENDER_LOCAL_SMOKE_PREP_RU.md` - safe sender audit verdict, private-chat hardening, local manual smoke checklist, and controlled staging Bot API smoke evidence.
- `TELEGRAM_MANAGER_REPLY_WORKER_RU.md` - explicit Telegram manager reply worker evidence with local checks and controlled staging worker smoke.
- `TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md` - supervised one-shot scheduler evidence; staging timer smoke passed, production approval remains blocked.

Telegram acceleration assumption, 2026-05-21: requester stated there are currently no real clients and no real managers depending on the Telegram path. Use this to prioritize controlled staging Bot API smoke with test bot/private chats; do not treat it as production approval.
