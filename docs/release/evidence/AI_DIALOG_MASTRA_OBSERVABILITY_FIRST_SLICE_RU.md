# AI dialog Mastra M3 staging evidence

Status: `passed_controlled_m3_staging_smoke`

Approved G6 base: `ad40c27ad2cb97b5f2249f263a64073feaea1fcf`

G6 transition commit: `a8cd55cc88fa53c4a6b4b46ed3ab67c2388536e5`

Exact successful implementation: `9f52bfbe8cb77c3bb0a9e39f3d66882936c0f6e5`

Date: `2026-07-15`

## Result

The controlled staging M3 smoke passed through the public widget route, app-owned `live_v2`
orchestrator and existing in-process Mastra factory. It did not use the direct OpenAI adapter or
any automatic retry/fallback. The successful run recorded:

```text
http status: 202
public status: accepted
automation status: replied
runtime/profile: mastra_openai_api / live_v2
configured provider/model: openai / gpt-5.6-sol
observed provider/model: openai / gpt-5.6-sol
reasoning effort: medium
run status/action: persisted / ask_clarifying_question
outcome: reply_persisted
validator: passed
send gate: allowed
runtimeRunId: present
usage: 1589 input / 373 output / 1962 total tokens
latency: 7480 ms
spans: 5 total / 0 failed
quality events: 0
manager review required: false
reply persisted: true
outbound linked: true
```

The owner replaced the consumed single-call authority with a bounded `$5` provider budget. Work
stopped on the first successful end-to-end result after three additional provider exposures. At
standard pricing, the two attempts with observed usage consumed approximately `$0.0344`; the
invalid request returned no usage. This is far below the authorized budget.

## Sanitized failure-to-fix chain

1. The original attempt at `08224e9c72de25ea0c1acd626c12080f7d5149f8` remained classified
   `provider_exposure_possible=true` because app-owned evidence could not prove a pre-provider
   failure.
2. After the new owner budget, attempt `002` at
   `4c6eb35098b847ae97eb6169a6349e1e8c980b6d` returned enum-only
   `invalid_request` in 1645 ms and failed closed with no usage/outbound.
3. Offline inspection found that the provider-facing Zod discriminated union became a forbidden
   root `anyOf`. OpenAI Structured Outputs requires a root object. Commit
   `1e6f56aab4dc75e355df0fe49e85d21bbec00df0` introduced a provider-facing root object while
   preserving the stricter app-owned action validator.
4. Attempt `003` reached the model and recorded `1589/243/1832` tokens plus runtimeRunId, then
   failed closed on provider identity normalization. Pinned Mastra 1.51 reports its Responses
   router as `openai`, while the SDK model may report `openai.responses`; `openai.chat` remains
   rejected.
5. Commit `9f52bfbe8cb77c3bb0a9e39f3d66882936c0f6e5` allowlisted only those two proven Responses
   identities. Attempt `004` then passed end to end.

Before the additional live calls, the exact factory was exercised without network access by
intercepting `globalThis.fetch` and returning a local synthetic 401. This proved that the reviewed
Mastra path constructs exactly one `POST` to the OpenAI Responses endpoint:

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

The test parsed those fields and the root schema shape in memory without printing or retaining the
request body. The outgoing schema is now `type: object` without root `anyOf`. Official references:
[Structured Outputs root rule](https://developers.openai.com/api/docs/guides/structured-outputs#root-objects-must-not-be-anyof-and-must-be-an-object),
[GPT-5.6 Sol model](https://developers.openai.com/api/docs/models/gpt-5.6-sol), and
[reasoning parameters](https://developers.openai.com/api/docs/guides/reasoning).

## Secret and call boundary

`OPENAI_API_KEY` presence was checked as boolean only. The value was inherited by the one-shot
server processes through environment memory and was never printed, written to a file, committed or
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

The isolated staging database contains four app-owned M3 runs: three fail-closed
`fallback_unavailable` runs and one successful `persisted` run. A sanitized SQL aggregate confirms
exactly one `mastra_openai_api/live_v2` run with matching configured/observed `gpt-5.6-sol`, passed
validator and allowed send gate.

## Public response and observability

The successful first response returned only the public accepted/reply contract. The harness
reduced it to allowlisted booleans and enums and did not print the reply text:

```text
http_status: 202
public_ok: true
public_status: accepted
automation_status: replied
reply_present: true
run/runtime identifiers in public evidence: absent
```

The app-owned run preserved configured and observed identities separately. Spans, the controlled
validator/send-gate result, usage, latency, outbound linkage and manager-review state are durable.
No raw exception, provider payload or response text was written to run/span/quality metadata.
Existing route tests prove same-idempotency replay returns the persisted reply without invoking
the generator, including when current AI configuration is disabled.

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
10/10 PASS after adding the allowlisted failure classifier, intercepted exact-transport proof and
root-object schema assertion; no provider call

npx vitest run apps/api/test/mastra-live-v2-decision-generator.test.ts apps/api/test/modular-boundaries.test.ts --maxWorkers=1 --minWorkers=1
26/26 PASS on the final provider schema/identity candidate

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

## Gate result and latency interpretation

The controlled single-call M3 success gate is passed. `7480 ms` is below the 15-second provider
timeout, the documented 20-second server budget and the widget's 25-second browser timeout. This
leaves more than 12 seconds of server-budget headroom and more than 17 seconds before the browser
deadline, so the architecture is not blocked or timeout-tight for this representative call.

This is a single staging sample, not p50/p95 or semantic-corpus proof. Continued staging AI,
production enablement and the planned 15-20-input authenticated corpus remain separate gates.
Provider calls stopped immediately on success; unused owner budget was not spent.
