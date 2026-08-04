# Observability Contract

Status: active repo-local contract updated on 2026-08-04

Canonical sources: current `ai_runs`/quality persistence code and schema,
`docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md` and
`docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`.

Observability/evals belong to operations and quality workflows. They must not become the CRM.

Current minimum:

- intake failures are visible enough for owner/manager follow-up;
- evidence can show intake persistence, queue wait, response-window identity,
  model/validator outcome, commit fence, manager visibility and failure behavior;
- public responses must not leak `trace_id`, eval labels, manager ids, handoff internals, database details, or raw internal errors.

Required linkage:

- trace/session/lead/conversation/message identifiers where applicable;
- business metadata such as channel, source page, source form, status, handoff reason, urgent reason;
- tool spans and degradation metadata;
- review labels;
- sanitized eval cases and regression runs.

Postgres app-owned records remain authoritative. Mastra or another tracing UI may
only consume bounded sanitized exports and may not define runtime success,
send-gate state or eval truth.

Any trace/eval export must be sanitized by default unless the owner explicitly
approves wider data sharing.
