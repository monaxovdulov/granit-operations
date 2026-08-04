# Architecture

Status: active repo-local map updated on 2026-08-04

Canonical sources:

- `docs/source-of-truth.md`;
- `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`;
- `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
- current code, contracts and migrations at the checked-out SHA.

`granit-operations` is the business operations application.

Current shape:

```text
Fastify public intake and manager API
React/Vite/Mantine manager panel
Postgres operational state and app-owned durable AI queue
latest-wins response windows and fresh context assembly
direct OpenAI runtime boundary by default
bounded Mastra staging adapter, never primary orchestration
app-owned validation, send gate, commit fence and observability
Telegram inbound and manager-authored delivery path
```

Active AI target:

```text
PR0a -> PR0b -> PR0c -> PR1 -> ... -> PR9
```

Protected manager access:

```text
manager.botops.ru
  -> Yandex ID login
  -> operations allowlist/role check
  -> server-side session
  -> manager UI/API
```

Yandex identity is authentication only. Authorization remains operations-owned through DB users, roles, and statuses.

Initial layout:

```text
apps/api/          Fastify intake API, auth routes, manager static app host
apps/manager/      React/Vite/Mantine manager panel
packages/contracts public intake contract artifacts
packages/db        Drizzle/Postgres schema and migrations
packages/shared    operations-local shared utilities
docs/              repo-local owner decisions, ADRs, task cards and evidence
```

Route handlers should be protocol adapters. Domain services own business behavior and must not rely on hidden request/reply mutation.

Do not infer production approval from implemented staging/runtime code. Deploy,
production migrations, Telegram AI outbound, secrets and runtime activation
remain separately gated.
