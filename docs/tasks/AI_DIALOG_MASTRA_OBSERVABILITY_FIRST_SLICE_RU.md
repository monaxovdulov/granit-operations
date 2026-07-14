# Task: AI-DIALOG-MASTRA-OBSERVABILITY-FIRST-SLICE - implementation plan первого staging-only Mastra + observability slice

Status: needs_review; implementation not started
Created: 2026-07-13
Updated: 2026-07-14
Repo: `granit-operations`
Slice: backend P1 -> P1Q -> P2 -> P3 -> M1 -> M2 -> M3; W0 parallel after G0
Owner/agent: owner review required / Codex planning agent

## Результат этой planning-сессии

Этот документ является проверяемым implementation plan. В этой сессии не добавлялись Mastra
packages, runtime-код, migrations, deploy config, staging/production flags, Telegram AI outbound
или Mastra Studio.

План заканчивается owner review gate. Реализация не должна начинаться только на основании
наличия этого файла.

Дополнительное owner decision от 2026-07-14 уточняет самый быстрый путь к живому website
assistant, не меняя исходный порядок верхнего уровня. Его локальный design artifact находится в
`docs/superpowers/specs/2026-07-14-live-widget-ai-design.md`.

## Owner-approved порядок

Источник sequencing decision: draft PR
[`monaxovdulov/granit-plan-app#5`](https://github.com/monaxovdulov/granit-plan-app/pull/5),
ветка `origin/codex/mastra-observability-sequence`, commit
`cf04541a4fe3c2fd5bbbef4a201067e1258c8317`.

```text
site-widget.v1 acceptance
  -> app-owned AI quality/trace prerequisites
  -> staging-only in-process Mastra + observability
  -> S08 Telegram AI parity
  -> S10 bad dialog -> sanitized eval -> regression
```

Sequencing утвержден, но не является разрешением на package install, schema change, staging
enablement или production.

### Owner-confirmed local execution refinement (2026-07-14)

```text
site_widget.v1 acceptance
  +-> widget lane: W0 Live Widget UX -------------------------> combined widget-UX evidence
  |
  +-> backend lane: P1 neutral boundary
        -> P1Q Live Dialog Core (synthetic acceptance fixtures)
        -> P2 minimum run/quality persistence
        -> P3 assets/privacy/retention/manager visibility
        -> M1 Mastra adapter disabled
        -> M2 local/fake contract + observability proof
        -> G6 owner staging approval
        -> M3 first authenticated live_v2 Mastra call/evidence
```

W0 после G0 идет параллельно и не блокирует backend lane; он обязателен только для итогового
combined widget-UX claim. P1Q создает контекст, structured decision, tone/facts profile и
synthetic contract fixtures, но не вызывает реальную модель и не добавляет Mastra packages.
Первый authenticated `live_v2` model call остается в M3 после всех gates.

Это декомпозиция operations prerequisites и внешний W0 handoff, а не замена cross-repo S01-S15
order. Если refinement должен стать общепроектным каноном, владелец фиксирует его отдельным
изменением в `granit-plan-app`; этот repo-local plan не присваивает себе такую authority.

## Owner-selected first runtime profile

Owner follow-up decision on 2026-07-14 narrows the first Mastra implementation to:

- runtime mode `mastra_openai_api`: in-process Mastra orchestration in staging only;
- server-side OpenAI API authentication through existing `OPENAI_API_KEY`;
- explicit model `gpt-5.6-sol` with requested `reasoning.effort=medium`;
- no ChatGPT subscription, Codex SDK/CLI, inherited server Codex session or skills harness in
  M1-M3.

The current official OpenAI latest-model guide identifies `gpt-5.6-sol` as the flagship model,
states that the `gpt-5.6` alias routes to it, and supports `medium` reasoning effort. The explicit
`gpt-5.6-sol` model name is used here to avoid relying on the family alias. If dated G4
verification cannot prove API-key access and exact parameter support through the selected Mastra
integration, implementation stops for owner review; it must not substitute another model,
reasoning level, API surface or authentication mode silently.

This decision is architecture approval only. It does not approve packages, code, secrets,
staging enablement or production use.

## Sources checked

Planning/source-of-truth:

- `../../granit-plan-app/docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md` at
  `cf04541`;
- `../../granit-plan-app/docs/MASTRA_RESEARCH_TO_CURRENT_STATE_MAP_RU.md` at `cf04541`;
- `../../granit-plan-app/docs/tasks/AI_DIALOG_RISK_REDUCTION_TARGET_ARCHITECTURE_RU.md` at
  `cf04541`;
- `../../granit-plan-app/ai-agent-stack-wiki/wiki/15-observability-contract.md` at `cf04541`;
- `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md` at
  `cf04541`.

Additional decision evidence at `granit-ops-decisions` commit
`91dcfa1f19f229154ee7f857e798eced03c54868`, not accepted source of truth:

- `README.md`;
- `50-implementation/roadmap.md`;
- `40-decisions/adr/ADR-0003-structured-ai-decision-and-policy-boundary.md`;
- `40-decisions/adr/ADR-0004-approved-business-facts-and-price-ranges.md`;
- `40-decisions/adr/ADR-0005-ai-eval-corpus-and-release-gates.md`;
- `40-decisions/uxd/UXD-0001-website-widget-ai-stale-takeover.md`;
- `40-decisions/uxd/UXD-0006-widget-ai-negation-mixed-intent.md`.

The package above is a `Proposed` decision workspace, not an installable harness or implementation
authority. This plan adopts only the directions explicitly approved by the owner and re-verified
against current code.

Repo rules/current truth:

- `docs/AGENT_WORKFLOW.md`;
- `docs/source-of-truth.md`;
- `docs/AI_POLICY.md`;
- `docs/OBSERVABILITY_CONTRACT.md`;
- `docs/tasks/TEMPLATE_RU.md`;
- `docs/release/evidence/TEMPLATE_RU.md`;
- `.agents/state/granit-dev-workflow.json`;
- OpenAI latest-model guide, checked 2026-07-14:
  <https://developers.openai.com/api/docs/guides/latest-model>;
- official Codex authentication, SDK and non-interactive-mode docs, checked 2026-07-14:
  <https://learn.chatgpt.com/docs/auth>, <https://learn.chatgpt.com/docs/codex-sdk>,
  <https://learn.chatgpt.com/docs/non-interactive-mode>;
- code, schema, tests and evidence at `granit-operations` commit
  `6666a0b06c46b29ec764c3403b60153125fe125c`;
- `granit-site-cms` inspected read-only at HEAD
  `5c336109fc20549d0e618cb6834d24e0cc6b4ba0` (upstream
  `23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a`): `README.md`,
  `docs/HTML_IMPORT_AUDIT.md`, `docs/tasks/FULL_SITE_REDESIGN_BRANCH_RU.md`,
  `apps/cms/README.md`, `apps/site/public/assets/js/main.js` and selected candidate content under
  `apps/site/src/imported-pages/` (`index.html`, `vertikalnye-pamyatniki/index.html`,
  `gorizontalnye-pamyatniki/index.html`, `dvoinye-pamyatniki/index.html`,
  `memorialnye-kompleksy/index.html`, `blagoustroistvo-mogil/index.html`,
  `ustanovka-pamyatnikov/index.html`).

`AGENTS.md` is not tracked and was not present in this checkout. Therefore this plan follows the
tracked rules above and does not invent missing instructions.

## Verified current state

| Area | Current fact | Concrete evidence |
|---|---|---|
| Neutral boundary | Stage A `AiTurnInput` exists and is built after inbound persistence. | `apps/api/src/modules/ai/ai-turn.ts`, `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`, `docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md` |
| Context | `compactContext.messages` contains only the current inbound widget message; it is not yet a bounded recent-history loader. | `apps/api/src/modules/ai/ai-turn.ts`, `buildSiteWidgetAiTurnInput` in `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` |
| Candidate/applied contracts | `AiTurnDecision` aliases the current reply candidate; `AiTurnResult` is declared but not wired through persistence. | `apps/api/src/modules/ai/ai-turn.ts` |
| AI cohesion | `WidgetAiService` still combines deterministic policy choice, prompt assembly, provider call, fallback and unsafe-output checks. | `apps/api/src/modules/ai/services/widget-ai-service.ts` |
| Dialogue quality | Prompt describes an assistant for the first message, ignores persisted history/known slots, and broad manager/price/deadline/terms regexes perform primary semantic routing. Approved business facts are empty. | `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`, `apps/api/src/modules/ai/policy/widget-ai-policy.ts`, `apps/api/src/modules/ai/ai-turn.ts` |
| Approved facts | Operations has no approved facts asset. Site catalog/process HTML contains candidate copy, but the site README identifies it as imported baseline awaiting owner corrections, so it cannot be consumed as runtime truth. | `apps/api/src/modules/ai/ai-turn.ts`, `granit-site-cms@5c33610:README.md`, selected `apps/site/src/imported-pages/**/index.html` files above |
| Widget perceived latency | The consumer appends the visitor bubble only after the POST completes and aborts after 10 seconds, while the current provider budget may reach 15 seconds. No typing/pending state or token streaming exists. | `granit-site-cms@5c33610:apps/site/public/assets/js/main.js`, `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts` |
| Direct rollback path | Direct OpenAI Responses API adapter exists, uses server-only `OPENAI_API_KEY`, defaults `OPENAI_MODEL` to `gpt-5.5`, requests `reasoning.effort=low` and uses `store: false`. This independent current profile must not be silently changed by the Mastra slice. | `apps/api/src/config.ts`, `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`, `docs/ENVIRONMENT.md` |
| App authority | Inbound is persisted before AI. `persistAiReplyWithSendGate` checks `agent_allowed_to_reply=true` inside the outbound transaction. Telegram AI outbound throws `TelegramOutboundBlockedError`. | `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`, `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` |
| Runtime flags | `AI_WIDGET_ENABLED` defaults to false. There is no runtime selector, Mastra flag, trace-export flag or explicit staging tier. | `apps/api/src/config.ts`, `apps/api/src/index.ts`, `docs/ENVIRONMENT.md` |
| Schema | Latest migration is `0009_telegram_delivery_processing_uncertain.sql`. Current schema has leads, channel identities, conversations, messages, deliveries and manager state, but no `ai_runs`, trace spans, quality events, review labels or eval cases. | `packages/db/migrations/`, `packages/db/src/schema.ts` |
| Manager visibility | Manager detail exposes conversation `aiState`, send permission and messages, but no AI run/degradation/quality summary. | `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`, `apps/manager/src/types.ts`, `apps/manager/src/App.tsx` |
| Tests | Tests cover persistence-before-AI, neutral input, invalid candidate/source fail-closed, fallback, takeover/stale draft, public privacy and Telegram AI outbound block. | `apps/api/test/public-intake.test.ts`, `apps/api/test/modular-boundaries.test.ts` |
| Routes | Fastify registers health, public intake, manager auth/shell/leads and Telegram webhook routes. No Mastra/Studio route exists. | `apps/api/src/app.ts` and route modules under `apps/api/src/modules/**/routes/` |
| Dependencies | Neither root nor `@granit/api` package currently declares Mastra. | `package.json`, `apps/api/package.json`, `package-lock.json` |
| Acceptance gate | Operations has local/staging evidence for `site_widget.v1`, but this repo does not contain the owner-approved cross-repo acceptance record required by PR #5. | `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md`, `S05_WEBSITE_SAFE_AI_RU.md`, `S06_MANAGER_TAKEOVER_RU.md` |

Conclusion: Stage A and the app-owned send gate are real reusable seams. The app-owned run/trace,
manager-visible quality state, recent-history context, approved asset package and explicit
staging-only runtime selection are still prerequisites, not completed facts.

The inspected `granit-site-cms` HEAD `5c33610` is one commit ahead of upstream `23f2ee8`. W0 must
therefore be implemented later in a separate clean worktree/`codex/` branch; this planning task
must not modify that checkout.

## Chosen architecture and rejected alternatives

### Chosen: one app-owned turn port, two operational runners with separate behavior profiles

The app owns the turn lifecycle and selects one of two implementations behind the same typed
boundary:

1. `direct_openai` - existing behavior-preserving path, independently configured and the rollback
   default;
2. `mastra_openai_api` - in-process staging-only Mastra orchestration using server-only
   `OPENAI_API_KEY`, explicit `gpt-5.6-sol`, requested `reasoning.effort=medium` and `store:false`.

Both paths use the same app-owned execution envelope, normalized action/result boundary, base
safety checks, run recorder, send-time gate, persistence and public response mapping. Candidate
schemas and semantic validators are profile-versioned: `mastra_openai_api` consumes P1Q
`live_v2`, while `direct_openai` remains on its frozen, already evidenced S05 prompt/policy and
legacy candidate validator during this slice.

The OpenAI API key used by the Mastra runner must never enter prompts, tools, traces, logs,
evidence, browser responses or
persisted state. The direct and Mastra model profiles intentionally remain independent so the
known direct rollback behavior is preserved. A rollback may deliberately reduce dialogue quality,
but restores the previously tested path without depending on Mastra. Therefore M3 proves contract,
persistence, observability and rollback compatibility; it must not describe the two modes as a
controlled model-quality A/B test. Model-quality promotion belongs to later sanitized
eval/regression work.

`direct_openai` is not a user-facing product choice or a second long-term orchestration strategy.
It is an operations-only emergency bypass for failures introduced by the new Mastra layer. Do not
port `live_v2` into it in M1-M3 and do not create two competing quality implementations.

### Live Dialog Core exists before Mastra

P1Q owns the provider-neutral dialogue contract: bounded history, known slots, structured actions,
versioned tone/facts and app validation. It is implemented and tested with fakes before any Mastra
dependency. Mastra is the only first-slice runner authorized to execute that contract against a
live model, and does so first in M3; it does not own memory, policy, facts, handoff or publication.

For rollback compatibility, an app-owned legacy adapter performs only this structural mapping:

- legacy `reply_candidate` with `agentAllowedToReplyAfterSend=false` -> normalized
  `handoff_to_manager`;
- every other legacy `reply_candidate` -> normalized `answer`;
- legacy `no_reply` -> normalized `no_reply` with the existing controlled reason;
- legacy never emits `ask_clarifying_question`, and the adapter never parses text/punctuation to
  infer an action.

The mapped result remains tagged `decision_profile=legacy_s05` and passes the frozen legacy
validator before the common apply/send gate. `live_v2` uses its own strict four-action validator.
This gives the direct provider no `live_v2` prompt/facts or new semantic-routing responsibility.

### Rejected for the first slice: Mastra as a separate service

This adds network/auth/deploy failure modes, creates pressure for a second state store and makes
rollback harder. A separate service is not needed to prove the first bounded turn.

### Rejected for the first slice: Mastra routes or Studio

Public or staging-accessible Mastra/Studio routes broaden the attack surface and require separate
access, redaction, retention and lifecycle decisions. They remain a separate future task. The
first slice proves their absence through route inventory.

### Reserved future runner, outside the first slice: `codex_subscription`

The same app-owned turn port may later gain a separately reviewed `codex_subscription` runner
backed by Codex SDK/CLI and ChatGPT subscription authentication. It is not a Mastra provider,
Mastra tool, Mastra workflow or child process spawned by Mastra.

That future slice must define a dedicated OS/container identity, separate `CODEX_HOME`, isolated
subscription credentials, ephemeral or read-only workspace, explicit network and skill/layer
allowlists, resource/concurrency/time limits and typed input/output IPC. It must inherit no app
secrets and receive no direct Postgres, outbox, delivery or customer-send authority. M1-M3 must
not install, authenticate, spawn, configure or test this harness. First-slice config reserves the
name only in this architecture document; the implemented enum contains only first-slice modes,
so this and every other unknown value fail normal config validation. Official Codex docs
establish that ChatGPT and API-key authentication plus server-side SDK/non-interactive surfaces
exist; they do not by themselves approve reuse of a personal subscription as an application
service credential. The future task must re-check workspace/admin policy, provider terms,
account lifecycle and automation quotas before any server authentication.

## Target authority and data flow

```text
POST /public/intake/site-widget/messages
  -> validate site_widget.v1
  -> acceptInboundMessage (Postgres commit)
  -> load bounded recent history + known slots + approved assets
  -> build app-owned execution context + bounded AiTurnInput
  -> create app-owned ai_run + trace_id
  -> deterministic hard-safety prechecks
  -> selected runner/profile: frozen direct S05 OR in-process Mastra live_v2
  -> untrusted AiTurnDecision candidate
  -> app schema/policy/source validation
  -> app-owned send-time gate
  -> persist outbound OR handoff/blocked/fallback/degradation
  -> complete ai_run + quality event + sanitized trace linkage
  -> map to unchanged public site_widget.v1 response
```

| Responsibility | App/Postgres | Mastra OpenAI runner |
|---|---:|---:|
| Lead, conversation, message, takeover and delivery truth | owns | no write authority |
| App `trace_id` / `ai_run` / quality outcome | owns | may return runtime IDs/metadata |
| Policy, prompt, tool and approved asset selection | owns versioned selection | consumes selected versions |
| Candidate decision | validates and may reject | may propose |
| Send-time gate and outbound persistence | owns | forbidden |
| Direct channel send/outbox write | owns | forbidden |
| Redaction and retention | owns and enforces | cannot weaken |
| Public/staging routes | owns explicit inventory | none in this slice |

An app-generated `trace_id` is the canonical correlation ID. A Mastra/runtime ID is a nullable
external reference on that app record, not the primary business identifier.

## Prerequisite and integration gates

| Gate | Must be true | Evidence needed | Blocks |
|---|---|---|---|
| G0 `site_widget.v1` acceptance | Owner links the accepted cross-repo contract/provider/staging evidence; no backend or AI scope expansion is needed to obtain it. | Accepted evidence/PR link and exact contract version. | All prerequisite implementation. |
| G0W Live Widget UX | Consumer shows local pending visitor state and typing immediately, preserves idempotency/retry truth and obeys the timeout invariant without changing `site_widget.v1`. It may run in a separate repo PR after G0. | Consumer unit/browser smoke, exact consumer SHA and timing evidence. | Honest live-UX claim; does not block backend-only P1/P1Q work. |
| G1 neutral boundary complete | Bounded recent history, internal execution IDs, typed candidate/applied result and cohesive app-owned orchestration exist without Mastra. | Focused tests + prerequisite task/evidence. | P1Q and DB/run recorder work. |
| G1Q Live Dialog Core | Strict four-action `live_v2` candidate, separate app validator, tone/facts assets and 15-20 synthetic acceptance fixtures pass with no live provider; legacy S05 golden tests remain byte/behavior compatible. | Context/schema/validator/apply tests, versioned assets, fixture report and direct golden baseline. | App observability completion and Mastra package work. |
| G2 app-owned run/quality state | Direct path writes linked run, gate and manager-visible degradation/handoff records. | Migration review, DB tests, manager API/UI tests, direct-path smoke. | Mastra package work. |
| G3 privacy/assets/rollback ready | Approved `live_v2` repo assets, redaction allowlist, retention cleanup, route baseline and frozen direct rollback path pass. No runtime Sheet read exists. | Tests, sanitized evidence and owner review. | Mastra package work. |
| G4 package/API review | Implementation agent re-checks current official Mastra and OpenAI docs, package names, supported Node runtime, tracing hooks, license, documented API-key availability of `gpt-5.6-sol` and provider request/response-shape support for `reasoning.effort=medium`, `store:false` and model identity; exact versions are pinned. No live provider call occurs before G6. | Source links, date, selected versions, package/type/request-shape review and lockfile diff in implementation PR. | Mastra adapter code. |
| G5 code review | Mastra code is disabled by default; route inventory, no-direct-send/DB and rollback tests pass. | Reviewed PR and full local checks. | Staging enablement. |
| G6 staging approval | Owner explicitly approves enabling the exact reviewed SHA only in staging. | Owner sign-off. | Any staging config change/smoke. |

## Data contracts to finish before Mastra

Keep `AiTurnInput` model-safe and channel-neutral. Do not add raw Fastify, widget request or
Telegram update DTOs. Introduce an app-only execution wrapper so internal database IDs are
available to persistence/observability without being placed in the model prompt.

Conceptual groups:

- `AiTurnExecutionContext`: internal `leadId`, `conversationId`, `inboundMessageId`, public IDs,
  channel, app `traceId`, idempotency key and input fingerprint;
- `AiTurnInput`: bounded recent messages, safe known slots, gate snapshot and selected versioned
  assets; no secrets, contact values or unrestricted metadata;
- `AiTurnDecision`: a versioned app union. `legacy_s05` preserves the existing
  `reply_candidate|no_reply` schema; `live_v2` contains exactly one action - `answer`,
  `ask_clarifying_question`, `handoff_to_manager` or `no_reply` - plus nullable `replyDraft`,
  controlled reason, `missingSlots`, short evidence, negation/mixed-intent fields and used
  approved-source IDs. Both are untrusted and dispatch to their named app validator;
- `AiTurnResult`: app-applied `persisted`, `handed_off`, `blocked`, `fallback_unavailable` or
  `failed`, plus send-gate result and safe evidence references.

`AcceptInboundMessageResult` and `SaveSiteWidgetAiMessageResult` must gain internal message IDs
for app persistence linkage, but those IDs must never be added to `SiteWidgetResponse`.

## Proposed app-owned storage

Schema review is mandatory before migration work. The recommended additive migration is
`packages/db/migrations/0010_ai_run_quality_observability.sql`; the matching Drizzle definitions
belong in `packages/db/src/schema.ts`.

### `ai_runs` - durable app-owned turn summary

Required columns:

- `id` UUID primary key and app-generated unique `trace_id`;
- `lead_id`, `conversation_id`, required `inbound_message_id`, nullable `outbound_message_id`;
- `channel`, `runtime_mode` (`direct_openai` or `mastra_openai_api`) and optional
  `runtime_run_id`;
- `decision_profile` (`legacy_s05` or `live_v2`) and controlled normalized action;
- unique turn `idempotency_key` and `input_fingerprint`;
- `status`: `running`, `persisted`, `handed_off`, `blocked`, `fallback_unavailable` or `failed`;
- `policy_version`, `prompt_version`, `tool_version`, nullable `asset_version`, nullable
  `tone_version`, nullable `facts_version`, `disclosure_version`;
- `model_provider`, `requested_model_name`, nullable `provider_model_name`, controlled
  `reasoning_effort`, `model_profile_version` and nullable exact package/runtime version;
- input/output/total tokens, versioned `cost_estimate_microunits` and `cost_rate_version`;
- `send_gate_result`: `not_checked`, `allowed` or `blocked`, plus `send_gate_checked_at`;
- controlled `outcome_reason`, `failure_code`, `started_at`, `completed_at`, `latency_ms`;
- controlled profile-validator result; never raw model reasoning;
- allowlisted `sanitized_metadata` only; no raw message/provider payload.

Indexes: unique trace and idempotency indexes; conversation/time, inbound message and
status/time indexes. Foreign keys keep the app graph authoritative.

### `ai_run_spans` - short-lived sanitized observability

Required columns:

- `id`, `ai_run_id`, stable `span_id`, nullable `parent_span_id`;
- `kind`: `runtime`, `model`, `tool`, `validation` or `send_gate`;
- allowlisted `name`, nullable `tool_version`, `status`, `latency_ms`, controlled `error_code`;
- `used_in_final_answer` when applicable;
- optional sanitized input/output summaries produced by a named sanitizer, never generic raw JSON;
- `created_at` and `expires_at` with the 30-day first-release trace default.

Indexes: run/order and expiry. This table is evidence, not business state and not an eval corpus.

### `ai_quality_events` - manager-visible operational state

Required columns:

- `id`, `ai_run_id`, `lead_id`, `conversation_id`, nullable `message_id`;
- `event_type`: `handoff`, `degradation`, `blocked`, `policy_violation`, `model_failure`,
  `tool_failure` or `runtime_failure`;
- controlled `reason_code`, `severity`, `manager_visible`, `created_at`;
- optional resolution fields and allowlisted `sanitized_metadata`.

The manager API reads these events and shows an explicit degradation/handoff badge and reason.
S10 later adds `review_labels`/`eval_cases` that reference `ai_runs.id` and
`ai_quality_events.id`. The first slice must not implement manager label mutation, transcript
sanitization workflow or eval promotion early.

## Migration and backfill strategy

1. Add new tables/indexes only; do not rewrite existing lead/conversation/message rows.
2. Do not fabricate historical `ai_runs` from existing AI message metadata. Existing rows do not
   contain reliable start time, gate result, latency, failure path or trace lifecycle.
3. Before code rollout, record sanitized counts of existing `sender_role='ai_assistant'` messages
   only as a baseline. This is audit evidence, not a backfill.
4. Apply migration before code that requires the new repositories. Run schema/FK/index checks.
5. First deploy/verify recording with `runtime_mode=direct_openai`; Mastra remains disabled.
6. Forward rollback leaves the additive tables in place. Reverting code must not drop or mutate
   run evidence.
7. If migration or direct-path recording is inconsistent, stop before Mastra package work and use
   `AI_WIDGET_ENABLED=false` until the prerequisite slice is repaired.

## Redaction and retention contract

### Allowlisted trace data

- app/internal UUID references visible only through protected manager/diagnostic paths;
- channel and controlled reason/status enums;
- prompt/policy/tool/asset/runtime/model versions;
- hashes/fingerprints, timestamps, latency, token counts and versioned cost estimate;
- tool name/version, success/failure and whether output was used;
- source page origin/path only after query and fragment removal.

### Forbidden trace/export data

- message bodies, raw prompts containing customer text and full conversation snapshots;
- name, phone, email, external chat/user IDs or unmasked provider identifiers;
- cookies, auth headers, API keys, bot tokens, DB URLs, subscription identity, `CODEX_HOME`
  contents and environment values;
- raw provider/Mastra payloads, arbitrary exception objects and full logs;
- chain-of-thought or hidden model reasoning;
- generic tool input/output without a tool-specific sanitizer.

Implement one fail-closed sanitizer boundary for storage and any future export. Unknown keys are
dropped; they are not passed through. External trace export remains disabled in the first slice.

Retention:

- structured `ai_runs` and `ai_quality_events` follow the lead/message first-release retention
  baseline (24 months after last contact) because they are app-owned operational evidence;
- `ai_run_spans` expire after 30 days;
- sanitized eval cases may live longer only in S10;
- a one-shot, dry-run-capable cleanup command deletes expired spans in bounded batches; scheduler
  or deploy wiring is a separate operational decision and is not part of this slice.

## Runtime selection, kill switches and route inventory

Planned config, all default-safe:

- existing `AI_WIDGET_ENABLED=false` remains the global customer-AI switch;
- add `AI_RUNTIME_MODE=direct_openai|mastra_openai_api`, default `direct_openai`;
- keep `OPENAI_API_KEY` server-only and require its presence when
  `AI_RUNTIME_MODE=mastra_openai_api`; never persist or expose its value;
- add `MASTRA_OPENAI_MODEL`, with the only first-slice accepted value `gpt-5.6-sol`, and
  `MASTRA_OPENAI_REASONING_EFFORT`, with the only first-slice accepted value `medium`;
- keep the current direct adapter's independent `OPENAI_MODEL`/low-effort behavior unchanged in
  M1-M3 so rollback remains behavior-preserving;
- add `DEPLOYMENT_TIER=local|test|staging|production|unknown`, default `unknown`;
- allow `AI_RUNTIME_MODE=mastra_openai_api` only when `DEPLOYMENT_TIER=staging`; reject startup
  otherwise;
- reject missing API key, unsupported model/effort and every value outside the implemented
  two-mode runtime enum at startup; never downgrade or substitute silently;
- add `AI_TRACE_EXPORT_ENABLED=false`; first-slice acceptance requires it to remain false.

The first slice adds no Codex SDK/CLI dependency, runtime implementation, config value or
Codex/skills route. Future runner selection must be a new reviewed config/schema change, not an
environment value that dormant first-slice code already accepts.

Rollback order:

1. switch `AI_RUNTIME_MODE` from `mastra_openai_api` to `direct_openai` and restart the API;
2. if direct AI is also unsafe, set `AI_WIDGET_ENABLED=false` and restart;
3. do not delete inbound messages, outbound evidence, `ai_runs`, spans or quality events;
4. do not drop the additive migration during runtime rollback.

This is an explicit operator rollback, not an automatic per-turn retry through a second provider.
Automatic cross-runner retry would make latency, cost, idempotency and the actual reply profile
harder to prove.

`apps/api/src/app.ts` must continue to register routes explicitly. Add a route-inventory test and
capture `Fastify.printRoutes()` output in sanitized evidence. No path may contain `mastra`,
`codex`, `studio`, `workflow`, `trace` or an unauthenticated AI diagnostic endpoint.

## Implementation slices

Each slice is a separate reviewable PR/commit group with its own task/evidence update. The
operations backend chain is sequential. W0 is the one explicit cross-repo exception: after G0 it
may run in parallel with P1/P1Q, but it cannot satisfy any backend gate.

### Slice P0 - record `site_widget.v1` acceptance gate

Scope:

- link the owner-accepted cross-repo provider/consumer/staging evidence;
- record exact contract version and commit SHAs;
- confirm acceptance did not change backend or AI scope.

Files: this task's evidence links/status only; any consumer evidence remains in its owning repo.

Exit: owner marks G0 accepted. No operations runtime change.

### Slice W0 - Live Widget UX (cross-repo consumer-only)

External handoff target and verified current entry point:

- `granit-site-cms` at inspected HEAD `5c33610`;
- `apps/site/public/assets/js/main.js` plus the owning widget styles/tests discovered in the future
  clean implementation worktree.

The requirements below are an external interface/evidence dependency, not implementation
authority for this repo. Create the actual W0 task/PR in `granit-site-cms` after G0; do not modify
the currently inspected ahead-of-upstream checkout. It may run in parallel with operations
P1/P1Q.

Work:

1. On submit, append the local visitor bubble immediately with `pending` state and show a separate
   typing/loading indicator before awaiting the network.
2. Keep message text and idempotency key until the server returns accepted/replayed truth.
3. On accepted response, mark the local visitor bubble `saved` and render only the persisted AI
   reply returned by unchanged `site_widget.v1`.
4. On transport/server failure, retain a visible `not_confirmed/retryable` visitor message; do not
   fabricate an AI bubble or silently discard input.
5. Enforce and test `browser deadline > backend/provider deadline + bounded persistence/network
   allowance`; the current 10-second browser versus up-to-15-second provider inversion must not
   survive.
6. Preserve current idempotency, escaping and public response/privacy behavior.

Exit: consumer tests and a browser smoke prove pending/typing appears no later than 300 ms after
submit, accepted/replayed mapping remains correct, and failures remain honest. There is no API
schema, operations runtime, SSE/WebSocket or token-streaming change.

### Slice P1 - finish the app-owned neutral turn boundary

Modify:

- `apps/api/src/modules/ai/ai-turn.ts`;
- `apps/api/src/modules/conversations/repositories/conversation-message-repository.ts`;
- `apps/api/src/modules/conversations/repositories/public-intake-repository.ts`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`;
- `apps/api/test/helpers/memory-intake-repository.ts`;
- `apps/api/test/public-intake.test.ts`;
- new direct S05 golden/compatibility tests under `apps/api/test/`.

Create focused AI ports/services under `apps/api/src/modules/ai/` for execution context, bounded
recent-message context and typed candidate/application orchestration. Keep the existing
`PublicWidgetAiReplyGenerator` boundary or replace it only with an equally narrow app-owned port;
the public use case must not import provider or Mastra types.

Work:

1. Return internal inbound/outbound message IDs to app services without exposing them publicly.
2. Load bounded recent messages from Postgres by conversation with explicit count/character
   limits and stable ordering; exclude unnecessary PII/media payloads.
3. Make the versioned legacy/live `AiTurnDecision` union and common `AiTurnResult` real
   application contracts; implement the exact structural legacy mapping defined above.
4. Split orchestration from existing widget policy/prompt/provider functions while preserving
   S05/S06 inbound-first persistence, candidate validation, unsafe-output checks and send-time
   takeover behavior. This safety compatibility does not require P1Q to preserve broad
   regex/canned semantic routing.
5. Keep approved price/business sources empty and fail-closed until an owner-approved asset
   package exists.
6. Freeze the direct golden baseline: S05 prompt/policy/disclosure versions and generated text,
   direct request `gpt-5.5`/low/`store:false`, deterministic policy candidates, the three legacy
   mapping cases and public response/send-gate outcomes. P1/P1Q must not change this baseline.

Exit: direct path passes all existing tests; AI core has no `@granit/contracts`, Fastify,
Telegram update or provider payload dependency; compact context includes bounded persisted
history and current inbound exactly once.

### Slice P1Q - Live Dialog Core (provider-neutral, no live model)

Create only inside the app-owned AI boundary:

- context/history mapping around `apps/api/src/modules/ai/ai-turn.ts`;
- separate provider-neutral `live_v2` decision/validator/orchestrator/profile modules under a new
  app-owned subtree such as `apps/api/src/modules/ai/profiles/live-v2/`;
- versioned `live_v2` prompt, tone and facts assets inside that subtree;
- focused context/schema/validator/apply tests plus a fixed synthetic acceptance fixture suite
  under `apps/api/test/`.

P1Q must not modify `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`,
`apps/api/src/modules/ai/policy/widget-ai-policy.ts` or their S05 version constants. Those modules
remain owned by the frozen direct rollback profile. Shared hard-safety primitives may be extracted
only if the direct golden suite proves byte/behavior compatibility.

Work:

1. Bound recent context to 6-8 relevant text messages and a separately named character cap, in
   stable order, with the current inbound exactly once. Include the last AI question and controlled
   known slots; exclude unnecessary contacts, transport DTOs and unrestricted metadata.
2. Define the separate `live_v2` provider port and strict candidate containing exactly one action:
   `answer`, `ask_clarifying_question`, `handoff_to_manager` or `no_reply`.
3. Validate candidate schema, reason, reply/action consistency, approved-source IDs, forbidden
   claims, negation/mixed-intent flags and handoff semantics in app code before any apply/send.
4. Keep deterministic checks for hard output safety and explicit state gates. Text that mentions a
   manager, price or deadline is not by itself a state transition.
5. Add versioned `live_v2` behavior: acknowledge meaning without empty echo, give concrete domain
   value, ask at most one useful next question, reuse known slots and avoid questionnaire tone,
   fake empathy and premature phone pressure.
6. Add a schema-validated owner-approved facts snapshot for safe product types, materials,
   decoration options and process facts. Exclude prices, deadlines, availability, discounts,
   payments, contracts, warranties and legal promises.
7. Build 15-20 fixed synthetic acceptance fixtures covering context construction and predefined
   candidate/apply outcomes for continuation/no-repeat, typo/paraphrase, negated and explicit
   manager requests, mixed intent, safe general choice, missing fact, unsafe promise and takeover.

P1Q proves model-safe context, schema rejection, source/claim checks, structural negation flags,
action-to-apply mapping, blocked send and real handoff state for predefined candidates. Fakes do
not prove that a model understands negation/mixed intent or produces a natural tone. Those
input-to-decision and soft-quality claims are measured by the authenticated fixed corpus only in
M3. This is a repo-authored synthetic acceptance fixture suite, not a promotion of real customer
transcripts; bad-dialog sanitization/promotion remains S10. P1Q makes no OpenAI/Mastra call and
adds no provider package. The frozen direct golden suite must also remain green.

Candidate source material for item 6 is the inspected site catalog, благоустройство and установка
HTML listed in `Sources checked`. Because that bundle is an imported baseline awaiting owner
corrections, an implementation agent must extract a small normalized proposal, cite source path
and content hash for every fact, and obtain explicit owner approval before committing the
versioned operations snapshot. Use a 15-20-row review table with `candidate fact`, `source
path/line`, `allowed customer wording`, `forbidden extrapolation`, `owner approved`, `source
version`, `valid from` and `review by`. There is no runtime cross-repo, CMS, Sheet or HTML read.

### Slice P2 - add minimum app-owned run, span and quality persistence

Create/modify:

- `packages/db/migrations/0010_ai_run_quality_observability.sql`;
- `packages/db/src/schema.ts`;
- new AI repository ports/adapters under `apps/api/src/modules/ai/repositories/`;
- app-owned recorder/orchestrator services under `apps/api/src/modules/ai/services/`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` where the
  send-gate/outbound transaction must atomically complete the run linkage;
- matching memory repositories and focused tests.

Work:

1. Create `ai_run` only after inbound persistence and before runner invocation.
2. Generate app `trace_id`; never trust runtime-provided ID as canonical.
3. Complete direct path outcomes for success, handoff, blocked, unavailable and failure.
4. Record only enum/version/timing direct-path spans before G3; no text, provider payload or
   arbitrary metadata may enter span storage without the centralized sanitizer.
5. Record a controlled quality event for tested handoff, degradation, blocked and failure paths.
6. Record the final send-gate result. For a persisted reply, link outbound message and run in the
   same DB transaction; a process crash must not leave a sent/persisted reply falsely recorded as
   an unlinked successful run.
7. Make recorder failure fail closed to saved inbound + manager review, never false AI success.
8. Prove idempotency: replay reuses the existing terminal run/outbound and does not create a
   duplicate run or provider call.

Exit: `direct_openai` writes the minimum complete app-owned evidence for every tested outcome
before any Mastra dependency is added. This proves the recorder independently; it does not enable
`live_v2` on the frozen direct profile.

### Slice P3 - manager quality visibility, approved assets, redaction and retention

Modify/create:

- `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`;
- manager-detail query/mapping in
  `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- `apps/manager/src/types.ts`, `apps/manager/src/App.tsx`, `apps/manager/src/display.ts`;
- versioned, schema-validated assets under `apps/api/src/modules/ai/assets/`;
- sanitizer/retention services under `apps/api/src/modules/ai/observability/`;
- one-shot cleanup script under `apps/api/src/scripts/` and a root npm command;
- focused API/UI/sanitizer/retention tests.

Work:

1. Show latest unresolved AI degradation/handoff/blocked reason, run status and timestamp in the
   protected manager conversation view; do not show raw traces or hidden reasoning.
2. Load AI policy/prompt/tone/facts/disclosure/tool/asset versions only from versioned repo files validated
   at startup/test time. Google Sheet/TSV may be an offline approval input but is never read at
   runtime.
3. Apply the same allowlist sanitizer before DB span storage and any export adapter.
4. Implement bounded dry-run cleanup for expired spans and prove non-expired run/business state
   is untouched.
5. Surface only the minimum operational quality state needed before Mastra; keep P1Q synthetic
   fixture results in repo evidence rather than turning them into manager mutation workflow.
6. Add a forward linkage contract documenting that S10 `review_labels`/`eval_cases` will reference
   run/quality IDs; do not implement S10 mutation or promotion UI now.

Exit: direct path failure produces a manager-visible quality state, redaction canary tests pass,
approved asset versions appear on runs and expired spans can be cleaned safely.

### Owner gate before Mastra packages

Owner reviews G0/G1/G1Q-G3 evidence, schema/migration result, manager visibility,
privacy/retention, `live_v2` assets/synthetic fixtures and direct rollback smoke. W0 evidence is reviewed here
if its separate consumer PR is complete; otherwise it remains required before a combined live-UX
claim. Only an explicit approval starts the next slice.

### Slice M1 - verify and pin Mastra, then add the in-process adapter disabled

First action is a dated official-doc/package verification. Do not copy package/API assumptions
from archived research. Record exact official links, package names, versions, Node compatibility,
tracing hooks, OpenAI provider transport, support for `gpt-5.6-sol`, requested
`reasoning.effort=medium`, `store:false`, returned model identity and any storage/network defaults.
Pin exact versions in `apps/api/package.json` and `package-lock.json`; no ranges for the first
staging experiment. If the exact profile cannot be expressed and verified, stop at G4 rather than
falling back to another model, effort, endpoint or auth mode. G4 uses docs, package types and
request-shape tests only; it must not make a live OpenAI request before G6.

Create/modify only after G4:

- in-process Mastra runner/adapter under `apps/api/src/modules/ai/adapters/`;
- an app-owned runtime selector/assembly in `apps/api/src/app-context.ts` and
  `apps/api/src/index.ts`;
- `apps/api/src/config.ts` and names-only `docs/ENVIRONMENT.md`;
- modular boundary and runner contract tests.

Constraints:

- the first implemented Mastra provider uses server-only `OPENAI_API_KEY` and the app-owned
  `gpt-5.6-sol`/`medium` model profile; the key is injected only at the provider boundary;
- the provider call must preserve `store:false`; record requested profile and sanitized returned
  model identity without raw provider payloads;
- Mastra receives bounded input/assets and constrained app-approved tools only;
- Mastra is the only first-slice runner allowed to execute P1Q `live_v2` against a live model,
  first in M3; it does not recreate history, tone, fact selection or policy inside
  framework-owned code;
- first slice exposes no business-mutating tool; read-only tools, if any, return approved data;
- Mastra cannot import conversation repositories, Drizzle schema, delivery providers, Fastify or
  route modules;
- output is parsed as an untrusted `live_v2` member of `AiTurnDecision` and goes through the
  named `live_v2` app validator plus shared base safety/apply gates;
- no Codex SDK/CLI dependency, ChatGPT login or server-skill discovery is added;
- direct OpenAI classes remain assembled and tested;
- `AI_RUNTIME_MODE` remains `direct_openai` by default and `mastra_openai_api` cannot run outside
  staging.

Exit: local/test contract tests exercise the adapter with fakes; no staging or production is
enabled; route inventory is unchanged.

### Slice M2 - connect app-owned observability and prove contract parity locally

Work:

1. Map app `trace_id` to the optional Mastra runtime/run ID.
2. Record sanitized runtime/model/tool/validation/send-gate spans with versions and latency.
3. Record token usage and a cost estimate based on a dated, versioned provider pricing snapshot;
   do not silently use stale or hard-coded unversioned rates.
4. Run the profile-specific candidate validator, then the same normalized action,
   handoff/degradation and persistence path as direct mode. Do not claim model-quality parity
   because the candidate schemas and preserved direct model profile differ.
5. Run the fixed P1Q 15-20-case synthetic fixture suite through the Mastra adapter with
   deterministic candidates/request-shape fixtures. This proves contract wiring and app gates
   locally; it is not an input-to-decision or live-model quality claim. Manager-driven bad-dialog
   promotion remains S10.
6. Prove switching back to the frozen direct mode reuses the same public contract and does not
   lose or duplicate messages.

Exit: focused and full local suites pass in both runtime modes, route inventory has no new public
surface, and the direct rollback test passes.

### Slice M3 - controlled staging evidence

After G5 and explicit G6 only:

1. Apply the reviewed additive migration and verify schema/indexes with sanitized output.
2. Run one `direct_openai` staging turn first and prove app-owned run/quality linkage.
3. Capture route inventory before Mastra enablement.
4. Enable `mastra_openai_api` with `gpt-5.6-sol`/`medium` only for the exact reviewed staging SHA
   and test identities.
5. Make the first approved authenticated Mastra call, verify API-key entitlement and allowlisted
   returned model identity, and stop immediately on mismatch.
6. Run the approved fixed 15-20-input live corpus plus success, manager-request handoff, forced
   runtime/model failure, takeover-during-work and redaction canary scenarios; record semantic and
   app hard-gate pass/fail, soft labels, fallback rate, p50/p95 full-response latency, token/cost
   summary and returned identity. Any hard-gate failure stops the remaining run and starts direct
   rollback; do not average a safety failure into a pass rate.
7. Switch back to `direct_openai`, restart, and prove a new turn succeeds without replay/duplicate
   writes.
8. If W0 is complete, record its consumer SHA and pending-state timing against the same staging
   flow; otherwise state explicitly that backend evidence does not prove live widget UX.
9. Disable customer AI after evidence unless the owner separately approves continued staging use.

Write sanitized proof to
`docs/release/evidence/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`. Update this task's
checks/evidence status only after the evidence exists.

## BDD/test matrix

| Given | When | Then | Primary test location |
|---|---|---|---|
| accepted widget contract | visitor submits | local visitor bubble and typing/pending state appear before network result; accepted response marks it saved | `granit-site-cms` widget consumer tests/browser smoke |
| widget POST fails or times out | consumer settles request | visitor text remains retryable/not-confirmed and no fake AI bubble appears | `granit-site-cms` widget consumer tests |
| configured browser/backend/provider budgets | timeout invariant is checked | browser deadline exceeds the complete bounded server budget | consumer config/unit test + operations config test |
| valid `site_widget.v1`, AI disabled | inbound is accepted | inbound persists; no run/provider call; public response stays compatible | `apps/api/test/public-intake.test.ts` |
| frozen direct S05 golden inputs | direct service/request is assembled | prompt/policy/disclosure text+versions, `gpt-5.5`/low/`store:false`, candidates and public outcomes remain unchanged | direct golden + adapter request-shape tests |
| the three legacy candidate shapes | compatibility adapter normalizes | stop-AI reply maps to `handoff_to_manager`, other reply maps to `answer`, no-reply maps to `no_reply`; no text parsing occurs | legacy adapter table test |
| direct mode | safe turn runs | one app run links lead/conversation/inbound/outbound, versions, usage and allowed send gate | focused AI/repository tests + public intake |
| persisted recent history | next turn input is built | bounded ordered context includes history and current inbound once, without raw contact data | context builder/repository tests |
| previous 6-8 messages, last AI question and known slots | next decision input is built | ordered model-safe fields include them exactly as allowed and character/count caps hold; no model-quality claim is made | P1Q context/orchestrator tests |
| negated-manager fixture supplies predefined `answer` candidate | app validates/applies | no handoff state is created | P1Q synthetic fixture + apply tests |
| explicit-manager fixture supplies predefined `handoff_to_manager` candidate | app validates/applies | app state enters handoff/AI-stop behavior | P1Q synthetic fixture + apply tests |
| mixed-intent fixture supplies valid/invalid candidate variants | app validates | schema/source/claim/action consistency is deterministic and invalid variant is blocked | P1Q synthetic fixture + validator tests |
| fake returns invalid action/reply/evidence combination | app validates | candidate is blocked before persistence; controlled quality reason is recorded | P1Q validator tests |
| code before M1 | dependency/source inventory runs | no Mastra package, runner or `live_v2` provider assembly exists | dependency/modular-boundary tests |
| Mastra config is absent, disabled or non-staging | app assembles | direct remains default and non-staging Mastra is rejected without a provider call | config/app-context tests |
| same inbound idempotency key replay | request repeats | same terminal run/reply returns; no duplicate run, span or provider call | public intake/repository tests |
| invalid/unsafe candidate in either runner | app validates | no outbound; run becomes blocked/fallback; manager-visible quality event exists | runner contract + public intake |
| model/Mastra/tool throws | turn fails | inbound remains, public safe fallback returns, run failure and quality reason are visible | runner contract + public intake |
| manager takes over while runner works | candidate returns later | send gate blocks outbound; run records blocked gate; no AI message exists | existing stale-draft test extended to both modes |
| policy asks for manager | safe handoff reply/outcome applies | app owns `needs_manager`, quality event and gate state | policy/orchestrator tests |
| `mastra_openai_api` + staging + valid key/profile | provider adapter is invoked | request uses explicit `gpt-5.6-sol`, requested effort `medium` and `store:false`; app records sanitized requested/returned identity | runner contract + config tests |
| `mastra_openai_api` lacks API key | config loads | startup fails before serving routes; no secret value appears in the error | config tests |
| configured model/effort is outside the first-slice allowlist | config loads | startup fails locally without a provider call; no silent model, effort, endpoint or auth substitution occurs | config tests |
| authenticated staging response reports an unexpected model identity | candidate run returns | run fails closed, outbound is blocked, degradation is recorded, further Mastra evidence stops and direct rollback begins | runner contract + M3 staging evidence |
| authenticated M3 fixed inputs cover negation, explicit handoff and mixed intent | Mastra model returns decisions | input-to-decision semantic hard gates pass with recorded failures/fallbacks; app still validates every candidate | M3 sanitized staging evidence |
| authenticated M3 fixed inputs cover continuation and tone | replies are reviewed with stable labels | context retention, useful next step, no-repeat, natural tone/dryness/questionnaire labels and latency are recorded; fakes are not cited as this proof | M3 sanitized staging evidence |
| Mastra mode outside staging | config loads | startup fails before serving routes | config tests |
| Mastra mode disabled | app assembles | direct adapter remains selected with its preserved independent profile | app-context tests |
| unknown runtime value is selected | config loads | ordinary enum validation rejects it; only the two implemented first-slice modes exist | config tests |
| secret/PII canary in error, prompt or tool payload | sanitizer records/exports | API key and other forbidden values are absent from DB, trace, logs, evidence and response; unknown keys are dropped | observability sanitizer tests |
| expired and non-expired spans | cleanup dry-run/run executes | only expired spans are reported/deleted in bounded batches | retention repository/script tests |
| API route inventory | Mastra package is present | no Mastra/Codex/Studio/trace/workflow public route appears | new route inventory test |
| Telegram inbound exists | AI persistence is attempted | Telegram AI outbound remains blocked | `apps/api/test/public-intake.test.ts` |
| public response is inspected | any outcome occurs | no internal trace/run/lead/conversation/manager/eval fields leak | existing recursive privacy assertion |

Required commands for each implementation PR, adjusted only if scripts change intentionally:

```text
npm test -- <focused test files>
npm run typecheck
npm test
npm run build
git diff --check
```

Migration PR additionally runs migration on a disposable Postgres database, validates fresh and
upgrade paths, and records schema/index/FK results without DB URL or row content.

## Staging evidence checklist

The evidence file must contain:

- exact operations git SHA and, when W0 is complete, exact widget consumer SHA plus browser
  pending-state timing and timeout invariant;
- exact `site_widget.v1`, AI boundary, policy, prompt, tone, facts, tool and asset versions, requested
  `gpt-5.6-sol`/`medium`, sanitized returned model identity and pinned Mastra versions;
- exact runtime mode and config names; API-key presence may be recorded only as boolean, with the
  value and all other secrets redacted;
- migration applied/fresh-schema results and explicit no-historical-backfill statement;
- route inventory before/after and proof of no Studio/public Mastra or Codex routes;
- direct-path baseline run with its preserved profile and `mastra_openai_api` run linked to
  app-owned IDs; label this contract/rollback evidence, not a model-quality A/B comparison;
- P1Q 15-20-case synthetic fixture-suite ID/version and structural schema/source/apply results;
- M3 fixed live-corpus ID/version, case-level semantic/soft labels and 100% hard-gate result for
  schema, prohibited promises, blocked send, explicit handoff and negation;
- success, failure, fallback, handoff and takeover/send-gate outcomes;
- sanitized token/cost/span summary plus full-response p50/p95 and fallback rate;
- redaction canary result and 30-day expiry/cleanup proof;
- kill-switch switch to direct mode and no-loss/no-duplicate result;
- dependency/source/config/route inventory confirming that no Codex SDK/CLI or subscription/skills
  integration was added;
- confirmation that Telegram AI outbound, trace export and production remained disabled;
- owner/developer sign-off fields from the evidence template.

Do not store customer message text, contact data, external chat IDs, raw prompts, provider
payloads, secrets, DB URL or full logs in evidence.

## Rollback and stop gates

Immediate switch to `direct_openai`, followed by `AI_WIDGET_ENABLED=false` if needed, is mandatory
when any of these occurs:

- AI reply persists after takeover or with send gate blocked;
- any M3 live-corpus hard gate fails, including a prohibited promise, false/missed handoff,
  negation failure or reply-after-blocked-gate; stop the remaining corpus immediately and begin
  direct rollback;
- inbound or outbound message is lost/duplicated across runtime selection;
- public API leaks internal run/trace/business identifiers;
- trace/span/evidence contains a redaction canary, secret or raw customer content;
- Mastra/Codex/Studio/trace/workflow route becomes reachable;
- Mastra gains direct DB write, outbox/delivery or customer-send authority;
- requested `gpt-5.6-sol`/`medium`/`store:false` cannot be proven or any silent provider/model
  substitution occurs;
- a Codex SDK/CLI dependency, runtime/config path, subscription integration or skills route appears;
- app `ai_run` cannot be linked to the actual message outcome;
- direct rollback mode does not pass its smoke;
- Mastra starts outside explicit staging tier;
- migration/schema integrity checks fail.

Latency and cost are observed evidence in this first slice, not permission to weaken a safety
gate. Any unacceptable staging latency/cost requires owner review before continued staging use,
but does not authorize production tuning or rollout.

Rollback is code/config-forward: preserve app-owned rows and return to the reviewed direct path.
Do not drop tables, erase traces, rewrite message outcomes or fabricate completion statuses.
The direct path remains on the frozen S05 behavior profile; rollback restores availability/safety,
not `live_v2` quality. If W0 itself must roll back, revert only its consumer deployment and keep
server-accepted messages/business state unchanged. P1Q cannot require a runtime rollback before
M1 because it has no live provider or customer enablement.

## Planned implementation file inventory

Existing files that will likely change across approved slices:

- `apps/api/src/modules/ai/ai-turn.ts`;
- `apps/api/src/modules/intake/ports/public-widget-ai-reply-generator.ts`;
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`;
- conversation/public/manager repository contracts and Postgres adapter under
  `apps/api/src/modules/conversations/repositories/`;
- `apps/api/src/app-context.ts`, `apps/api/src/config.ts`, `apps/api/src/index.ts`;
- `packages/db/src/schema.ts`, new migration `0010_ai_run_quality_observability.sql`;
- `apps/manager/src/types.ts`, `apps/manager/src/App.tsx`, `apps/manager/src/display.ts`;
- memory repositories, `apps/api/test/public-intake.test.ts` and
  `apps/api/test/modular-boundaries.test.ts`;
- `package.json`, `apps/api/package.json`, `package-lock.json` only in approved Mastra/cleanup
  slices;
- `docs/ENVIRONMENT.md`, task/evidence indexes and the new evidence file.

Frozen direct baseline files are inspected and golden-tested but not changed by P1Q/M1-M3:

- `apps/api/src/modules/ai/services/widget-ai-service.ts`;
- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`;
- `apps/api/src/modules/ai/policy/widget-ai-policy.ts`;
- `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`.

If implementation cannot preserve them, it stops for owner review instead of weakening rollback.

Cross-repo W0 is owned separately by
`granit-site-cms@5c33610:apps/site/public/assets/js/main.js` and its discovered styles/tests. It
is not part of a `granit-operations` implementation PR.

Proposed new operations paths are provider-neutral decision/context/validator services, versioned
`live_v2` tone/facts assets and fixed synthetic fixtures under the existing AI/test module
structure. Exact filenames are selected in the P1Q task after checking then-current conventions;
Mastra types must not leak into them.

New module paths in this plan are proposed boundaries, not pre-created files. The implementation
agent must preserve the repo's modular-monolith rules and record an ADR only if a meaningful
operations boundary decision changes.

## Out Of Scope

- production enablement or production approval;
- continued staging enablement without a separate owner decision;
- token streaming, SSE or WebSocket transport in the first slice;
- vector RAG, long-term semantic memory, full catalog ingestion or a runtime Google Sheet;
- arbitrary tools, external browsing, skill/layer execution or autonomous multi-step workflows;
- Telegram AI outbound or S08 implementation;
- S10 manager review-label mutation, bad-dialog sanitization/promotion or full eval corpus;
- direct customer sends, delivery/outbox writes or business-table writes from Mastra;
- Mastra channels for widget/Telegram transport;
- Mastra schedules for cleanup, delivery or critical background work;
- separate AI runtime service in this first slice;
- any local, staging or public Mastra Studio;
- `codex_subscription`, Codex SDK/CLI harness, ChatGPT subscription auth, reuse of an installed
  server CLI/session, skill/layer execution and all related isolation/deployment configuration;
- external trace export or Mastra Cloud as source of truth;
- Google Sheet/TSV runtime reads;
- pricing, final deadline, contract, warranty, discount, availability, legal or payment authority;
- deploy config, proxy, Docker/systemd changes, secrets or server routing in this plan commit.

## Risks and explicit mitigations

| Risk | Mitigation / proof |
|---|---|
| Pending UI masks a failed save | Distinct `pending`, `saved` and `not_confirmed/retryable` states; never show fake AI text. |
| Browser timeout fires before bounded server work ends | Explicit cross-repo timeout invariant and tests before live UX evidence. |
| Recent history leaks or grows without bound | Separate message-count/character caps and model-safe field allowlist with PII canaries. |
| New model/framework still sounds robotic | P1Q removes context/schema/tone/facts wiring defects; only M3 live-corpus labels can prove model semantics and natural tone. |
| Two runtime paths drift | Same normalized result/apply/persistence tests run against both; candidate validators stay profile-specific and direct golden behavior stays frozen. |
| Quality logic is duplicated in direct and Mastra adapters | `live_v2` remains in its app-owned profile subtree and Mastra only executes its port; direct stays a legacy emergency bypass. |
| Different direct/Mastra model profiles are misreported as a quality A/B | Preserve and record each profile independently; M3 proves wiring/rollback only, while quality comparison waits for sanitized evals. |
| Trace becomes second CRM | Only IDs, versions, metrics and sanitized spans; business state remains existing tables/services. |
| Run/message partial write | Complete persisted outcome and outbound linkage in one DB transaction; test crash/error edges. |
| Historical backfill invents evidence | No backfill; record only baseline counts. |
| PII/secret leakage | Central allowlist sanitizer, canary tests, export off, no raw evidence. |
| Runtime enabled in production | Explicit deployment tier guard plus default direct mode and owner staging gate. |
| Mastra API research is stale | Dated official-doc verification immediately before pinning packages. |
| OpenAI model alias/provider fallback drifts | Request explicit `gpt-5.6-sol`/`medium`, record sanitized returned identity and stop on unsupported or unexpected substitution. |
| `medium` reasoning misses acceptable latency | Record p50/p95 and fallback rate; stop for owner review rather than silently switching effort/model. |
| Codex is accidentally nested under Mastra | Dependency/source/config/route inventory proves no Codex implementation exists in M1-M3. |
| Installed server Codex credentials or skills leak into app execution | Future runner requires isolated identity/`CODEX_HOME`/allowlists; first slice contains no integration path that reads them. |
| Manager-visible degradation becomes noisy | Controlled event/reason/severity set; show unresolved relevant events, not raw spans. |
| S10 pulled forward | Only stable run/quality IDs and forward linkage are created; label/eval workflow remains deferred. |
| Studio sneaks into first slice | Dependency/route inventory and explicit no-Studio acceptance test. |

## Files Touched By This Planning Commit

- `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
- `docs/tasks/README.md`
- `docs/superpowers/specs/2026-07-14-live-widget-ai-design.md`

## Checks Run For This Plan

| Command/check | Result | Notes |
|---|---|---|
| `git status --short --branch` | reviewed | Clean detached baseline before creating a dedicated `codex/` branch. |
| `ast-index rebuild --no-deps`, `ast-index conventions`, `ast-index map` | passed | Indexed current TypeScript code and verified repository/module patterns. |
| Targeted AST/file/source inspection | passed | Verified AI boundary, direct adapter, send gate, schema, manager view, routes and tests listed above. |
| `granit-ops-decisions` read-only audit | passed | Confirmed proposed structured-decision/eval sequence and that the repo is decision evidence, not an accepted harness. |
| `granit-site-cms` read-only inspection | passed | Verified delayed bubble/current 10-second timeout, candidate content/import caveat and the ahead-of-upstream checkout; future W0 needs a separate clean worktree. |
| `gh pr view 5`, branch/doc inspection at `cf04541` | passed | Verified draft PR metadata, owner-sequenced branch and source documents. |
| Independent plan delta review | passed after fixes | Reconciled two-lane sequencing, frozen S05/live_v2 isolation, M3-only semantic proof, SHA-pinned external evidence, G0 authority and fail-fast hard gates. |
| Placeholder/consistency/scope self-review | passed | No `TBD`/`TODO`; prerequisites, Mastra integration, S08/S10 and Studio scopes remain separated. |
| Official OpenAI latest-model verification | passed for planning; repeat at G4 | On 2026-07-14 official docs identify `gpt-5.6-sol` and support `medium`; no package/runtime capability is assumed from this planning check. |
| `git diff --check` | passed | No whitespace errors in the planning diff. |

## Evidence Links

- Source decision: <https://github.com/monaxovdulov/granit-plan-app/pull/5>
- Owner-approved accelerated design:
  `docs/superpowers/specs/2026-07-14-live-widget-ai-design.md`
- Owner-selected OpenAI profile source, checked 2026-07-14:
  <https://developers.openai.com/api/docs/guides/latest-model>
- Future Codex runner feasibility sources, not implementation approval:
  <https://learn.chatgpt.com/docs/auth>, <https://learn.chatgpt.com/docs/codex-sdk>,
  <https://learn.chatgpt.com/docs/non-interactive-mode>
- Existing Stage A evidence: `docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- Existing website AI/takeover evidence: `docs/release/evidence/S05_WEBSITE_SAFE_AI_RU.md`,
  `docs/release/evidence/S06_MANAGER_TAKEOVER_RU.md`
- Existing channel-neutral evidence:
  `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
- Planned implementation evidence:
  `docs/release/evidence/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`

## Blockers

- G0 owner-linked `site_widget.v1` acceptance is not recorded in this repo.
- App-owned run/quality state, manager-visible degradation, approved asset bundle and retention
  enforcement are not implemented.
- W0 consumer pending/error UX and P1Q Live Dialog Core are designed but not implemented.
- Official Mastra packages/docs have intentionally not been selected or pinned in this planning
  session.
- All schema, AI behavior, environment, staging and production changes require owner review under
  `docs/AGENT_WORKFLOW.md`.

## Owner Review Gate / Next Action

Owner should review and either approve or request changes to:

1. two-lane order after G0: external W0 in parallel, and sequential operations
   P1 -> P1Q -> P2 -> P3 -> M1 disabled -> M2 local/fake -> G6 -> M3 authenticated staging;
2. W0 as a separate `granit-site-cms` task with unchanged `site_widget.v1` and no streaming;
3. P1Q four-action contract, 6-8-message bounded context, `live_v2` tone/facts and fixed
   15-20-case synthetic fixture suite before a live model, followed by semantic/soft-quality proof
   only in M3;
4. the three-table app-owned storage shape and no-backfill strategy;
5. frozen `direct_openai` emergency rollback, exact structural legacy mapping and explicit
   staging-tier guard, accepting that rollback restores legacy quality rather than `live_v2`;
6. redaction allowlist, retention defaults and minimum manager-visible quality state now versus
   S10 review/eval workflow later;
7. first runtime profile `mastra_openai_api` + server API key + explicit
   `gpt-5.6-sol`/`medium`, with no silent substitution;
8. future isolated `codex_subscription` runner as architecture-only scope outside M1-M3;
9. explicit exclusion of separate/public Mastra Studio and exact staging latency acceptance after
   the first representative baseline.

After this plan is approved, obtain explicit owner acceptance/linkage for the paired provider,
consumer and staging evidence and record it through P0. Neither W0 nor P1 starts before that G0.
Once G0 is recorded, create separate W0 (`granit-site-cms`, clean worktree) and P1
(`granit-operations`) tasks; they may proceed in parallel. P1Q starts only after P1 evidence. Do
not install Mastra, write the P2 migration/runtime code, change staging config or start M1-M3 from
this planning commit.
