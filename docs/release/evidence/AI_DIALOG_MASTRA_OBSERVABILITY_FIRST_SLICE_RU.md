# AI dialog Mastra M3 staging evidence

Status: `blocked_after_possible_provider_exposure`

Approved G6 base: `ad40c27ad2cb97b5f2249f263a64073feaea1fcf`

G6 transition commit: `a8cd55cc88fa53c4a6b4b46ed3ab67c2388536e5`

Exact implementation used for the call: `08224e9c72de25ea0c1acd626c12080f7d5149f8`

Date: `2026-07-15`

## Result

The first authenticated M3 `live_v2` attempt ran through the app-owned widget path and the
existing in-process Mastra adapter. It did not use the direct OpenAI adapter. The call did not
produce a trusted model result, so M3 is not passed and the widget AI path is not claimed working.

The failure was fail-closed:

- configured runtime/profile: `mastra_openai_api` / `live_v2`;
- configured provider/model/effort: `openai` / `gpt-5.6-sol` / `medium`;
- terminal run: `fallback_unavailable`, action `no_reply`, reason `generator_failed`;
- controlled failure: `runtime_failure`; validator `not_run`;
- observed provider/model: `none` / absent;
- runtimeRunId and usage: absent;
- send gate: `not_checked`; outbound linkage: absent;
- model span: `failed`, `model_error`, 1648 ms;
- runtime span: `failed`, `runtime_failed`, 1656 ms;
- total app-run latency: 1657 ms;
- manager state: `needs_manager`, AI replies disabled;
- one open manager-visible critical `runtime_failure/runtime_failed` quality event;
- no automatic retry or cross-provider fallback occurred.

The current sanitized boundary does not retain provider exception text or a provider payload.
Therefore this evidence cannot distinguish API-key entitlement, provider request rejection or a
Mastra/provider-runtime failure. A second provider call was not made.

Guard classification after the first attempt:

```text
provider_exposure_possible: true
classification_basis: model_generation span entered and failed after 1648 ms
pre_provider_failure_proven: false
second_live_provider_call_authorized: false
```

The absence of a trusted observed provider/model is not proof that the provider was unexposed.
The app entered the model-generation boundary and no sanitized evidence proves a harness-only or
pre-provider failure. The attempt is therefore counted conservatively as possible provider
exposure. No second live/provider call is permitted without new explicit owner approval.

After the stop gate, the exact factory was exercised without network access by intercepting
`globalThis.fetch` and returning a local synthetic 401. This proves that the reviewed Mastra path
constructs exactly one `POST` to the OpenAI Responses endpoint with allowlisted request facts:

```text
transport: fetch
endpoint class: api.openai.com / v1 / responses
model: gpt-5.6-sol
reasoning effort: medium
store: false
max retries: 0
sanitized local 401 category: auth_or_entitlement
network/provider exposure: false
```

The test parsed those fields in memory and did not print or retain the request body. This local
proof rules out a wrong Mastra provider route or chat-completions transport in the current
candidate. It does not retroactively identify the first live error and is not live M3 success.

## Secret and call boundary

`OPENAI_API_KEY` presence was checked as boolean only. The value was inherited by the one-shot
server process through environment memory and was never printed, written to a file, committed or
copied into evidence. `OPENAI_BASE_URL`, Mastra license variables and external trace export were
absent/disabled. Provider auto-refresh was disabled.

The request profile was pinned in code to:

```text
model: gpt-5.6-sol
reasoning effort: medium
store: false
agent max retries: 0
model max retries: 0
max processor retries: 0
provider timeout: 15000 ms
trace export: false
provider auto-refresh: false
```

No raw model output, synthetic input text, prompt body, customer text, DB URL, secret, runtime ID
or full provider payload appears in this record.

## Staging database

The existing `granit-staging-postgres-1` container remained unexposed on the host. The reviewed
additive migrations were applied sequentially:

```text
0010_ai_run_quality_observability.sql: applied
0011_live_v2_controlled_no_reply.sql: applied
ai_runs / ai_run_spans / ai_quality_events / decision_action: present
pre-smoke ai_runs: 0
historical backfill: none
```

The smoke created exactly one app-owned AI run. A same-idempotency replay created no second run
and made no second provider call.

## Public response and observability

The same-idempotency replay returned only sanitized public state:

```text
http_status: 202
public_ok: true
public_status: replayed
automation_status: fallback
reply_present: false
internal_ids_exposed: false
ai_run_count_after_replay: 1
```

The app-owned run preserved configured and observed identities separately. Spans, the controlled
quality event, manager review state and no-send outcome were durable. No raw exception, provider
payload or response text was written to run/span/quality metadata.

## Runtime and route boundaries

- `mastra_openai_api` is accepted only with `DEPLOYMENT_TIER=staging` and the exact pinned profile.
- Production/non-staging assembly fails before dynamic provider import or fetch.
- The public staging API container was not switched to the candidate and production was untouched.
- No Mastra Studio, Mastra/Codex/workflow/trace route, trace exporter, license path or public runner
  was added.
- The direct adapter remains the frozen manual `legacy_s05` rollback and contains no `live_v2`
  profile or automatic failover.

## Verification

Commands used `NODE_OPTIONS=--max-old-space-size=512`; Vitest used one worker. Heavy commands were
returned to sequential execution after a redundant parallel typecheck/build was stopped for host
memory pressure.

```text
npx vitest run <M3 assembly/adapter/config/boundary/M2 files> --maxWorkers=1 --minWorkers=1
78/78 PASS

npx vitest run <M3 evidence/provenance/adapter files> --maxWorkers=1 --minWorkers=1
26/26 PASS

npx vitest run <M3 boundary/evidence files> --maxWorkers=1 --minWorkers=1
30/30 PASS

npx vitest run apps/api/test/mastra-live-v2-decision-generator.test.ts --maxWorkers=1 --minWorkers=1
10/10 PASS after adding the allowlisted failure classifier and intercepted exact-transport proof;
no provider call

npm run typecheck:api
PASS (source/packages and test batches 1-40), including the post-guard diagnostic change

npm test -- --maxWorkers=1 --minWorkers=1
PASS before the evidence-only harness correction

npm -w @granit/manager run typecheck
PASS

npm -w @granit/manager run build
PASS

git diff --check
PASS
```

## Stop gate and next action

The M3 success gate remains closed because no trusted observed provider/model, runtimeRunId,
usage or validated reply exists. Continued staging AI and production remain disabled.

A strictly allowlisted provider-error classification is now prepared for a future separately
authorized attempt. It emits only one enum from
`auth_or_entitlement|identity_mismatch|invalid_request|provider_rate_limited|provider_unavailable|provider_sdk_error|runtime_error|timeout_or_abort`
and retains no message text, exception text, response body or payload. This diagnostic change does
not retroactively classify the first attempt and does not authorize another call. Any future call
requires a new one-shot synthetic identity, an exact clean reviewed SHA and explicit owner
approval. Do not reinterpret this failed attempt as model-quality or latency success evidence.
