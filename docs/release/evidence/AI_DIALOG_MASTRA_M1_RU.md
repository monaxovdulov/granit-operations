# AI dialog Mastra M1 evidence

Status: `passed`

Implementation commit: `de45913cd269c939f819e44dfb5aa774cab97231`

Reviewed G4 evidence predecessor: `b190ef7`

## Result

M1 adds an in-process Mastra `live_v2` adapter while keeping it genuinely disabled in the API
runtime:

- `AI_RUNTIME_MODE` defaults to frozen `direct_openai`;
- selecting `mastra_openai_api` is config-valid only for staging with the server-only key and all
  exact safety values, then `index.ts` still stops before DB/provider/app assembly with the M1
  disabled error;
- the public app context accepts only the direct legacy assembly in M1;
- the real Mastra module is dynamically imported only inside the guarded provider factory;
- no route, Mastra server, Studio, storage, memory, tool or external exporter was added.

The adapter fixes the request profile to:

```text
model                openai/gpt-5.6-sol
reasoningEffort      medium
store                false
transport            fetch
maxSteps             1
agent retries        0
provider retries     0
processor retries    0
maxOutputTokens      4000
max serialized input 64000 characters
```

Only the bounded app-owned turn, tone and approved model facts enter the model message. The app
trace ID is passed as Mastra `runId` outside that message. Candidate content is untrusted; provider,
returned model, runtime ID and usage come only from the injected agent result/onFinish boundary.
Unknown usage keys and unsafe identifiers are dropped.

## Explicit network and privacy controls

The real factory checks all controls before dynamic import:

- `MASTRA_TELEMETRY_DISABLED=true`;
- `MASTRA_AUTO_REFRESH_PROVIDERS=false`;
- no `MASTRA_LICENSE_KEY` or `MASTRA_EE_LICENSE`;
- external trace export false;
- exact model/effort/key config.

The exact pinned `noopLogger` is registered on the Agent before any generation and is also passed
to the structured-output path. Raw Mastra/provider errors are normalized to the generic
`MastraLiveV2GenerationError` with no cause. This closes the independent review finding that a
bare Agent could log an upstream error before the app catch boundary.

## Verification

All heavy checks ran sequentially with `NODE_OPTIONS=--max-old-space-size=512`; Vitest used one
worker.

```text
npm run typecheck
PASS

npx vitest run \
  apps/api/test/mastra-runtime-config.test.ts \
  apps/api/test/mastra-live-v2-decision-generator.test.ts \
  apps/api/test/mastra-g4-package-contract.test.ts \
  apps/api/test/modular-boundaries.test.ts \
  --maxWorkers=1 --minWorkers=1
41/41 PASS

npm test -- --maxWorkers=1 --minWorkers=1
289/289 executed tests PASS; 7 conditional PostgreSQL tests skipped

npm run build
PASS; manager production bundle built

git diff --check
PASS
```

The safe real-factory construction test uses only a non-secret sentinel, observes zero fetch calls
and never invokes `generate()`. The raw error canary proves no adapter `console.error` and no raw
error/cause escapes.

## Route inventory

`Fastify.printRoutes()` under the memory repository remained:

```text
/health
/public/intake/site-form
/public/intake/site-widget/messages
/auth/yandex/start
/auth/yandex/callback
/auth/logout
/manager
/manager/me
/manager/me/telegram-bind-token
/manager/leads
/manager/leads/:leadId
/manager/leads/:leadId/status
/manager/leads/:leadId/conversations/:publicConversationId/takeover
/manager/assets/*
/telegram/webhook
```

There is no Mastra, Studio, workflow, trace, Codex or AI diagnostic route.

## Independent review

The first review found one P1 raw-error logger boundary. It was fixed with the Agent and
structured-output `noopLogger` controls plus a raw canary. Re-review verdict: no P0/P1.

Non-blocking follow-up for M2: replace the M1 direct-only app-context marker with an exhaustive
app-owned runtime selector; connect only the deterministic fake locally, preserve no-fallback
semantics and keep the real factory staging-bound.

## No-call / rollback proof

- `OPENAI_API_KEY` remained unset in this tmux environment.
- No generator test invoked the real Agent's `generate()` method.
- `index.ts` rejects the Mastra runtime before DB/provider/app assembly.
- The direct provider, `OPENAI_MODEL` default `gpt-5.5`, `legacy_s05` mapping and manual rollback
  path were not changed; no automatic cross-provider retry was added.
- No staging/production config, secret, database or deployment was changed.

M1 authorizes M2 local/fake only. G6 still blocks every real provider/model call.
