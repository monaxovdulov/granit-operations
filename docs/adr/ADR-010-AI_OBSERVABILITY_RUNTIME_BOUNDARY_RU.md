# ADR-010: AI Observability Runtime Boundary

Status: accepted
Date: 2026-07-20
Repo scope: `granit-operations`
Related task: `docs/tasks/RECONCILE_REMAINING_BRANCHES_RU.md`
Reconciled: 2026-08-04 by `ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`

## Context

После PR0a-PR2 primary orchestration в `main` принадлежит приложению:

```text
PublicWidgetIntakeService
  -> app-owned persistence and PostgreSQL queue
  -> latest-wins / fresh context / response-window identity
  -> direct model boundary by default
  -> app-owned validation, commit fence and send gate
  -> app-owned ai_runs / ai_quality_events
  -> manager-visible safe summary
```

Старый Mastra/live-v2 срез содержал полезные идеи по observability, но также тянул конкурирующую orchestration модель, старые migration номера, staging evidence и runtime wiring, которые конфликтуют с текущим grounded AI.

Риск: будущий агент может попытаться вернуть “Mastra Studio-like observability” через восстановление старого live-v2/Mastra runtime целиком. Это снова смешает observability с primary orchestration, send gate, persistence и manager controls.

## Decision

Primary AI runtime source of truth remains app-owned:

- `PublicWidgetAiReplyGenerator` is the only public widget AI generation port used by intake.
- `PublicWidgetIntakeService` owns public request sequencing and never imports provider/orchestrator details.
- `PostgresIntakeRepository` owns persisted inbound/outbound messages, send gate, `ai_runs`, `ai_quality_events`, manager controls and manager read models.
- `ai_runs`, `ai_quality_events`, eval tables and future app-owned trace/span tables are the operational source of truth.
- Manager-visible AI quality data must be summarized and sanitized; raw provider traces, spans, prompts, secrets and raw errors are not manager payload.

Mastra is not primary orchestration. The existing `mastra_openai_api` mode is a
bounded staging adapter behind app-owned queue, state and gates. Mastra-like
observability remains optional:

```text
current runtime
  -> app-owned observability contract
  -> optional sinks/exporters
       -> Postgres trace/span sink
       -> OpenTelemetry sink
       -> Mastra/Mastra Studio-style sink, if later approved
```

Mastra, OpenTelemetry or another tracing tool may not own:

- primary widget AI orchestration;
- public widget send gate;
- manager AI global/per-conversation controls;
- lead/conversation persistence;
- public widget response contract;
- DB migration numbering;
- eval pass/fail source of truth.

Any Mastra integration must remain one of:

- the existing bounded staging/model adapter that obeys app-owned queue,
  validation, commit and send-gate contracts; or
- an optional observability sink/exporter under an explicit observability module.

It must not make Mastra workflows or run/span repositories the primary runtime
or operational source of truth.

New DB changes must continue from the current migration sequence. Old Mastra alternative migrations `0010`/`0011` are not valid source files for `main`.

## Consequences

Future Studio-like observability work should add app-owned traces/spans first, for example a later migration such as `0016_ai_traces_and_spans.sql`, then optionally export those sanitized records to an external UI or tracing platform.

The app can still get a tree of spans, latency, model calls, verifier verdicts, grounding failures and send-gate decisions. The boundary is about ownership: those records are derived from app-owned runtime events, not from a third-party orchestrator becoming the source of truth.

The tradeoff is that Mastra Studio parity may require an adapter/export layer rather than direct adoption of Mastra as the main runtime. This is intentional because preserving app-owned persistence, send gate and manager controls is more important than matching a tool’s native runtime model.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| Reopen and merge PR #2 Mastra branch | Rejected because it conflicted with current grounded AI, old migrations and app-owned send gate. |
| Make Mastra the primary orchestrator and adapt app code around it | Rejected because lead/conversation truth, send gate and manager controls must stay in the app/Postgres boundary. |
| Avoid Studio-like observability entirely | Rejected because traces/spans are useful, but they must be provider-neutral and privacy-safe. |
| Store raw prompts, raw errors and full provider traces for easier debugging | Rejected by default because manager-visible and long-retention observability must be sanitized. Any raw debug capture needs a separate owner-approved retention/access decision. |
| Only document this decision without tests | Rejected because future agents need executable guardrails, not just prose. |

## Checks / Guardrails

Boundary checks should fail if production code:

- lets Mastra own queue scheduling, current conversation state or commit order;
- enables the bounded Mastra mode outside its approved staging boundary;
- bypasses the `PublicWidgetAiReplyGenerator` intake boundary;
- exposes AI quality as raw metadata/traces/spans instead of manager-safe summary fields.

Relevant local checks for this ADR:

- `npx vitest run apps/api/test/modular-boundaries.test.ts --maxWorkers=1`
- `npm run typecheck`

## Remaining Risk

This ADR does not approve production Mastra activation, OpenTelemetry, new
tracing tables, production migrations or raw debug capture.

The next implementation step, if observability parity is required, should be a separate PR for app-owned trace/span contracts and storage, followed by an optional exporter/sink PR.

## Owner Impact

The owner gets a clear architecture rule: observability can become Studio-like, but the business-critical runtime remains controlled by the application.

During review, reject PRs that make Mastra or any tracing vendor the primary source of truth for widget AI replies, send gate decisions, manager controls or persistence.

## Links

- Reconciliation source: `docs/tasks/RECONCILE_REMAINING_BRANCHES_RU.md`
- AI boundary ADR: `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md`
- Existing observability contract entrypoint: `docs/OBSERVABILITY_CONTRACT.md`
