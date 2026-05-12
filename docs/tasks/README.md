# Task Docs

Use this directory for repo-local task records. A task doc explains what the agent changed or checked, what was out of scope, what files were touched, which checks ran, where evidence lives, and what remains blocked.

Template:

```text
docs/tasks/TEMPLATE_RU.md
```

Current task records:

- `S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md` - planned owner/release review for S01 operations provider evidence.
- `S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md` - planned split of dirty operations changes into reviewable chunks and checks.
- `S02_MANAGER_AUTH_YANDEX_RU.md` - planned protected manager login through Yandex ID plus operations allowlist/roles.

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
