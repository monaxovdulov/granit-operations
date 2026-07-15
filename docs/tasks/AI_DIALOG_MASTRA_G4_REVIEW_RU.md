# G4 — dated Mastra/OpenAI compatibility review

Status: `passed`

Review time: `2026-07-15T00:43Z` UTC

Reviewed source HEAD before dependency changes: `c7a3e5a9098645a0a4ac3f433aef01a113ba7cc7`

## Gate

This review authorizes only the disabled M1 adapter and deterministic M2 local/fake wiring.
It does not authorize staging configuration, an authenticated provider call or a real
`live_v2` turn. Those remain behind the exact-SHA G6 owner gate.

## Official sources reviewed

Mastra:

- manual installation and model-router configuration:
  <https://mastra.ai/docs/getting-started/manual-install>;
- agent construction and `generate()` contract:
  <https://mastra.ai/docs/agents/overview> and
  <https://mastra.ai/reference/agents/generate>;
- observability configuration and tracing hooks:
  <https://mastra.ai/docs/observability/overview>,
  <https://mastra.ai/docs/observability/config> and
  <https://mastra.ai/docs/observability/tracing/overview>;
- official core repository, license boundary and telemetry source:
  <https://github.com/mastra-ai/mastra> and
  <https://github.com/mastra-ai/mastra/blob/main/packages/core/src/telemetry/posthog.ts>.
- dependency advisory reviewed during lock audit:
  <https://github.com/advisories/GHSA-866g-f22w-33x8>.

OpenAI:

- current model guidance: <https://developers.openai.com/api/docs/guides/latest-model>;
- exact model page: <https://developers.openai.com/api/docs/models/gpt-5.6-sol>;
- Responses API and returned `model` identity:
  <https://developers.openai.com/api/reference/resources/responses/methods/create>;
- server-side bearer authentication:
  <https://developers.openai.com/api/reference/overview#authentication>;
- response storage defaults and `store:false`:
  <https://developers.openai.com/api/docs/guides/conversation-state> and
  <https://developers.openai.com/api/docs/guides/your-data#v1responses>;
- reasoning effort:
  <https://developers.openai.com/api/docs/guides/reasoning>.

## Exact package decision

- Pin `@mastra/core` to exact `1.51.0` in `apps/api/package.json`.
- Pin its shared Zod 3 peer to exact `zod@3.25.76` in API and contracts workspaces.
- Pin project Node to exact Volta `22.22.0` and declare `node >=22.22.0`.
  Mastra core declares `>=22.13.0`, while the resolved `posthog-node@5.42.0`
  dependency declares `^20.20.0 || >=22.22.0`; the stricter installed graph wins.
- Do not install `mastra` CLI, `@mastra/observability`, `ai`, `@ai-sdk/openai`, a
  Mastra storage adapter, Studio or server packages. Core 1.51.0 contains the model router and
  the first slice keeps app-owned storage and observability.

Locked core artifact:

```text
@mastra/core 1.51.0
resolved https://registry.npmjs.org/@mastra/core/-/core-1.51.0.tgz
integrity sha512-MmY2/cA97y8KSJ9w/GlMRKTBNsglO1XHI5zv8oVcYQhGr6AFZ/jnAbKzjIEEBrofRca7TXYYvg6YeZCCY4fBvg==
license Apache-2.0
```

No `ee` entry point is allowed in this slice. The npm manifest declares `Apache-2.0`; the
published tarball does not include a standalone license file, so this manifest plus the official
repository license boundary is retained as the compliance evidence for the experiment.

`npm audit --omit=dev --audit-level=high` reports no high/moderate issue and two paths to the
same low-severity `@ai-sdk/provider-utils <=3.0.97` resource-consumption advisory through the
exact Mastra core graph. The reviewed advisory declares no patched version. M1/M2 make no remote
provider call, so the affected response-handler path is unreachable there. Do not apply an
unreviewed override to Mastra's exact internal aliases. Re-run the package/advisory review at G6
before authorizing M3; a fixed official Mastra release should replace this pin if one exists then.

## Verified request/response contract

The installed package types and bundled OpenAI Responses transport express the required profile:

```text
model.id              = openai/gpt-5.6-sol
model.apiKey          = server-only OPENAI_API_KEY at the provider boundary
providerOptions       = { openai: { reasoningEffort: "medium", store: false, transport: "fetch" } }
maxSteps              = 1
maxRetries            = 0
maxProcessorRetries   = 0
structuredOutput      = app-owned live_v2 schema
runId                 = app-owned trace_id mapping
```

The generated model registry contains `openai/gpt-5.6-sol`. The bundled OpenAI option schema
accepts `medium` and `store`; its transport defaults `store` to `true`, so the adapter must always
pass explicit `false`. The adapter also pins `transport:"fetch"` rather than permitting a future
transport default to select WebSocket. It maps `reasoningEffort` to Responses `reasoning.effort` and exposes the
returned identity as `result.response.modelId`. M1/M2 tests must fail if any of these exact values
drift.

The adapter must not retain `result.request`, `providerMetadata`, messages, reasoning or raw
errors. Only the app allowlist may retain the returned model identity, runtime/run ID, bounded
usage counters, latency and controlled statuses.

## Network, storage and tracing defaults

- A model-router agent can reach the provider when `generate()` is executed. M1 construction is
  disabled and M2 uses only an injected deterministic fake; no real `generate()` is permitted.
- OpenAI Responses application state is on by default unless `store:false` is explicit.
- No Mastra storage, memory, server, route, exporter or observability package is configured.
- Mastra core ships optional PostHog feature telemetry whose official source treats telemetry as
  enabled unless `MASTRA_TELEMETRY_DISABLED` is truthy. The Granit adapter therefore requires
  exact `MASTRA_TELEMETRY_DISABLED=true` before dynamically importing/constructing the real
  runner. M1/M2 tests use fakes and prove no telemetry/provider fetch occurs.
- Provider-registry refresh can make a `models.dev` request in dev mode unless
  `MASTRA_AUTO_REFRESH_PROVIDERS=false`; the real runner requires that exact opt-out before its
  dynamic import. `MASTRA_LICENSE_KEY` and `MASTRA_EE_LICENSE` are rejected for this Apache-core
  slice so no enterprise license validation loop can start.
- `AI_TRACE_EXPORT_ENABLED` remains exact `false`; any other value is a startup error for the
  Mastra mode. App-owned sanitized P2/P3 spans remain the only observability path.

## G4 conclusion

The exact target profile is expressible without a silent model/effort/endpoint/auth fallback.
G4 passes with the constraints above. M1 may now add an in-process adapter disabled by default;
M2 may exercise it only through local deterministic fakes. G6 still forbids staging and every
real provider/model call.

Installation was performed with `npm install --ignore-scripts --no-audit --no-fund`; package
scripts were not executed. `OPENAI_API_KEY` was absent and no application/provider code ran.
