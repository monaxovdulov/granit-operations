# Repo-Local ADRs

Use this directory for meaningful `granit-operations` decisions only.

Cross-project architecture, repo boundaries, release/deploy policy, AI safety gates, and S01-S15 order live in:

```text
/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/
```

Do not create ADRs for every small task. Use ADRs for decisions that future agents must not accidentally reopen.

ADR template:

```text
/home/devuser/ai-projects/granit-plan-app/docs/templates/ADR_TEMPLATE.md
```

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
