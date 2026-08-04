# Repo-Local ADRs

Use this directory for meaningful `granit-operations` decisions only.

Architecture, repo boundaries, release/deploy policy, AI safety gates and the
`PR0a-PR9` order are repo-local. Start with `docs/source-of-truth.md` and
`ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`.

Do not create ADRs for every small task. Use ADRs for decisions that future agents must not accidentally reopen.

Use the required fields below as the local ADR template.

Required fields:

- status;
- date;
- context;
- decision;
- consequences;
- alternatives considered;
- owner impact;
- links to task/evidence.

Current ADRs:

- `ADR-001-STAGING_MANAGER_DOMAIN_RU.md` - `manager.botops.ru` is the accepted staging domain for the future operations platform / manager UI.
- `ADR-002-TELEGRAM-MANAGER-REPLY-WORKER_RU.md` - explicit, disabled-by-default Telegram manager reply worker over `message_deliveries`; not production approval.
- `ADR-003-TELEGRAM-MANAGER-REPLY-SUPERVISED-SCHEDULER_RU.md` - systemd timer plus one-shot plus Postgres advisory lock for manager reply delivery; not production approval.
- `ADR-004-CONVERSATION_REPOSITORY_PORT_SPLIT_RU.md` - conversation repository contracts are split into narrow ports while `IntakeRepository` and legacy exports remain for compatibility.
- `ADR-005-MANAGER_TELEGRAM_PERSISTENCE_BOUNDARY_RU.md` - manager Telegram bind-token, binding, reply-context and manager reply persistence live in an explicit Postgres repository while `PostgresIntakeRepository` remains a compatibility facade.
- `ADR-006-TELEGRAM_INBOUND_MAPPER_BOUNDARY_RU.md` - Telegram inbound raw update parsing, command/callback parsing, content mapping and classification live in a pure mapper while `TelegramBotService` remains the webhook adapter/orchestrator.
- `ADR-007-TIMELINE_EVENT_INPUT_BOUNDARY_RU.md` - timeline event input DTOs are owned by `modules/timeline`, while centralized builders keep event names and metadata shapes stable.
- `ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md` - public widget intake depends on a narrow AI reply generator port while `app-context.ts` assembles `WidgetAiService` from provider/model options.
- `ADR-009-COMPATIBILITY_EXPORT_POLICY_RU.md` - old `auth`, `routes`, `services` and `repositories` paths remain compatibility exports, while new production imports must use `modules/*`.
- `ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md` - Studio-like AI observability is allowed only as an optional app-owned sink/export layer; primary widget AI runtime, send gate, persistence and manager controls stay app-owned.
- `ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md` - active customer-facing landing/widget smoke source is `monaxovdulov/landing-granit-static`; `granit-site-cms` is not the current rollout target.
- `ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md` - current code and repo-local owner docs define AI facts, app-owned queue/direct runtime direction and `PR0a-PR9`; historical external planning links are provenance only.
