# Task Docs

Use this directory for repo-local task records. A task doc explains what the agent changed or checked, what was out of scope, what files were touched, which checks ran, where evidence lives, and what remains blocked.

Template:

```text
docs/tasks/TEMPLATE_RU.md
```

Current task records:

- `S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md` - planned owner/release review for S01 operations provider evidence.
- `S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md` - planned split of dirty operations changes into reviewable chunks and checks.
- `S02_MANAGER_AUTH_YANDEX_RU.md` - protected manager login through Yandex ID plus operations allowlist/roles.
- `S03_MANAGER_UI_MANTINE_RU.md` - React/Vite/Mantine manager panel over the protected S02 API.
- `S03_MIN_LIFECYCLE_RU.md` - minimal manager statuses and status-change history before widget persistence.
- `S04_WIDGET_PERSISTENCE_RU.md` - website widget message persistence before AI replies.
- `SERIOUS_AI_LAYER_RU.md` - preparation plan for the serious backend AI layer after S05 website safe AI.
- `AI_DIALOG_BOUNDARY_STAGE_A_RU.md` - local Stage A implementation of the neutral AI turn boundary before Mastra runtime, Telegram AI outbound or production AI approval.
- `AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md` - locally passed G1/P1 implementation of bounded causal
  history, app-owned identity, structural legacy decision orchestration and frozen direct S05
  golden checks before P1Q.
- `AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md` - provider-neutral P1Q core at
  `core_local_checks_passed` in `78c9947`: strict `live_v2` context, candidate validation,
  deterministic apply semantics and fixed synthetic fixtures passed local checks; not deployed,
  no model call, Mastra dependency or runtime switch, and G1Q remains pending owner facts
  approval.
- `AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md` - exact 15-row facts proposal at `needs_review`;
  every row remains `no — pending` / `after approval`, and the test-only approved fixture is not
  owner approval or a runtime snapshot.
- `AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md` - active implementation plan: G0/G1 passed,
  W0 consumer and P1Q core passed local checks, while G1Q awaits exact owner facts approval;
  remaining operations lane
  `P1 -> P1Q -> P2 -> P3 -> M1 disabled -> M2 local/fake -> G6 owner gate -> M3 authenticated
  staging` (`OPENAI_API_KEY`, `gpt-5.6-sol`, medium), with frozen direct OpenAI emergency rollback
  and future `codex_subscription` outside the slice.
- `MODULAR_MONOLITH_REFACTOR_RU.md` - planned refactor to make `ops-api` a clearer modular monolith without changing runtime topology, public contracts, DB schema or production state.
- `OPS_API_THICK_MODULE_REFACTOR_NEXT_TASKS_RU.md` - ordered next refactor slices after the thick-module audit, with mandatory explicit ADRs for boundary-changing work.
- `P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md` - implementation handoff for channel-neutral widget/Telegram conversation foundation before Telegram adapter and production.
- `TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md` - Telegram inbound webhook plus manager binding/takeover/reply mini-panel after P0.
- `TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md` - separate sender path for pending Telegram manager replies with retry/failure visibility.
- `TELEGRAM_MANAGER_REPLY_WORKER_RU.md` - explicit Postgres-backed worker for automatic delivery of manager-authored Telegram replies only; staging smoke accepted, not production approval.
- `TELEGRAM_MANAGER_REPLY_WORKER_SUPERVISED_SCHEDULER_RU.md` - systemd timer plus one-shot plus Postgres advisory lock for supervised manager reply delivery; staging smoke passed, not production approval.
- `TELEGRAM_POST_SUPERVISED_SCHEDULER_NEXT_TASKS_RU.md` - ordered next task pack for supervised staging smoke, `uncertain` policy, notification sender, backup/rollback, release bundle, AI handoff policy and branch cleanup.
- `TELEGRAM_SAFE_SENDER_NEXT_TASK_PACK_RU.md` - plain-language next-session task pack for audit, safe refactor, local manual smoke and staging smoke preparation after the local Telegram sender slice.
- `STAGING_GO_LIVE_READINESS_RU.md` - explicit owner goal and ordered safety path for production-like staging enablement before notification sender, AI handoff expansion, Mastra or Telegram AI outbound.

Required fields:

- ID;
- title;
- repo;
- slice;
- owner/agent;
- status;
- scope;
- out of scope;
- files touched;
- checks run;
- evidence links;
- blockers;
- next action.

GitHub Issues may later mirror task status externally, but these files remain the durable repo record.
