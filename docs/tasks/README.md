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
