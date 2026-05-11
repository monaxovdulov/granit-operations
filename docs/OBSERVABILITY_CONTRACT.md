# Observability Contract

Status: initial scaffold

Canonical source: `/home/devuser/ai-projects/granit-plan-app/ai-agent-stack-wiki/wiki/15-observability-contract.md`

Observability/evals belong to operations and quality workflows. They must not become the CRM.

S01 minimum:

- intake failures are visible enough for owner/manager follow-up;
- evidence can show request handling, persistence, manager visibility, and failure behavior;
- public responses must not leak `trace_id`, eval labels, manager ids, handoff internals, database details, or raw internal errors.

Later required linkage:

- trace/session/lead/conversation/message identifiers where applicable;
- business metadata such as channel, source page, source form, status, handoff reason, urgent reason;
- tool spans and degradation metadata;
- review labels;
- sanitized eval cases and regression runs.

Any trace/eval export must be sanitized by default unless the owner explicitly approves wider data sharing.
