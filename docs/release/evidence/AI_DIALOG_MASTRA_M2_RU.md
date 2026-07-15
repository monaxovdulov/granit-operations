# AI dialog Mastra M2 local/fake evidence

Status: `passed`

Implementation commit: `b16ee6de8bf8e733b84fe6a5443828b5ce6e405c`

Reviewed M1 evidence predecessor: `32feb5a0d0d169373babe4cb67400a1492663918`

## Result

M2 connects the app-owned `live_v2` path to the in-process Mastra adapter only through an
explicit deterministic local fake. It does not enable the environment-selected Mastra runtime,
staging or a real provider:

- the app context selects `direct_openai` or `mastra_openai_api` exhaustively and never falls back
  from an invalid/unknown Mastra selection to direct;
- M2 Mastra assembly requires an injected fake agent, an exact safe fake model identity and an
  explicit approved facts snapshot;
- disabled/direct startup does not import the dated `facts.v1` snapshot, so expiry of that asset
  cannot break the emergency direct path;
- `index.ts` still rejects environment-selected Mastra before DB/provider/app assembly with the
  exact-SHA G6 message;
- the public route and immutable `site_widget.v1` contract remain unchanged.

The canonical 18-case `LV2-SYN-001..018` corpus runs through the real
`MastraLiveV2DecisionGenerator` contract with deterministic candidates. This proves bounded
request, validator, action, handoff, send-gate and persistence wiring. It is not a claim about a
live model's tone, latency or semantic quality.

## Honest run evidence

The local path records configured and observed truth independently as `fake` plus the exact fake
model. Candidate metadata cannot spoof provider/model/runtime evidence. The app trace ID becomes
the Mastra invocation run ID; a sanitized returned runtime ID and token counts are stored when
present. A safe but unexpected returned model is rejected and still recorded as the observed
identity; unsafe/unknown identity remains fail-closed without raw payload.

Valid `no_reply` decisions are no longer labelled invalid. Migration 0011 permits the exact
internal reasons `no_safe_answer` and `missing_approved_fact` with validator `passed` and no
failure code. For compatibility, immutable `site_widget.v1` maps these to its existing public
`unsafe_model_response` bucket, while manager/run/quality evidence preserves the exact reason.

Pricing is deliberately fail-closed. The dated official snapshot records standard input/output
rates of USD 5/30 per million tokens, the documented 1.25x cache-write premium and the >272k
surcharge boundary. The estimator requires trusted proof of zero cache-write tokens. Current
Mastra usage does not provide that proof, so M2 emits no OpenAI cost estimate; local fake runs
also have no cost. M3 must obtain trusted billing evidence before recording a cost.

Official pricing source checked 2026-07-15:
<https://developers.openai.com/api/docs/models/gpt-5.6-sol>.

## Atomicity, replay and rollback

- the fresh app-owned gate and final atomic write both require `agentAllowedToReply=true` and
  `aiState=ai_collecting_info`;
- manager takeover before the fresh read and in the race after that read both produce zero
  outbound messages;
- answer/clarification/handoff, valid no-reply, invalid candidate, generator failure, gate-reader
  failure, terminal replay and concurrent replay are covered;
- terminal replay never calls the generator again, and concurrent begin creates one run;
- PostgreSQL writes outbound, terminal run, spans/events and gate transition in one transaction;
- raw canaries do not appear in run, spans, events, message metadata, timeline or public response;
- manual `direct_openai` rollback remains `legacy_s05`, has no `live_v2` fallback and no automatic
  cross-provider retry.

## Migration evidence

```text
file    packages/db/migrations/0011_live_v2_controlled_no_reply.sql
blob    ec6e30fdac5a9863494ac8b82bcedf179a417444
SHA256  720d73db8f622e1dd538fa9a0e7ccaef1dff6943989268fbc5553d8c0b5be587
```

Disposable `postgres:16-alpine` ran with `--memory=192m --cpus=1`, reduced buffers, no published
port and no retained container:

```text
fresh:   0001..0011 applied, 11/11
upgrade: 0001..0010 then 0011 applied, 10+1
constraints after upgrade:
  ai_quality_events_reason_code_check
  ai_runs_outcome_reason_check
  ai_runs_terminal_evidence_check
PostgreSQL suites: 16/16 PASS
container_removed: PASS
```

The migration changes only controlled checks; it does not backfill or invent historical run
evidence.

## Verification

All heavy commands ran sequentially with `NODE_OPTIONS=--max-old-space-size=512`. Vitest used one
worker. The repository-wide TypeScript check is split into deterministic source/test batches by
`tooling/typecheck-bounded.mjs`; it covers every API source, package and test `.ts` file without
raising the requested heap limit.

```text
npx vitest run <final affected M2/public/adapter/pricing files> --maxWorkers=1 --minWorkers=1
67/67 PASS

npm test -- --maxWorkers=1 --minWorkers=1
313 PASS; 10 conditional PostgreSQL tests skipped in the local-only run

P2_TEST_DATABASE_URL=<disposable-container> npx vitest run \
  apps/api/test/p2-observability-postgres.test.ts \
  apps/api/test/p3-manager-ai-quality-visibility.test.ts \
  apps/api/test/p3-ai-run-span-retention.test.ts \
  --maxWorkers=1 --minWorkers=1
16/16 PASS

npm run typecheck
PASS

npm run build
PASS; 2477 manager modules transformed

git diff --check
PASS
```

## Dependency and security re-check

- installed/latest `@mastra/core`: `1.51.0` / `1.51.0`;
- installed `@mastra/schema-compat`: `1.3.4`;
- `npm audit --omit=dev --audit-level=high`: exit 0, no high/moderate findings;
- the three previously recorded low advisory paths through provider-utils remain; no unreviewed
  override or broad `audit fix` was applied.

The low advisory must be re-checked at G6 immediately before any M3 staging action.

## Independent review

The first final review found four P1 issues: dated facts on direct startup, false no-reply
classification, cache-write underestimation and lost mismatch identity. All were fixed. A second
review caught an attempted extension of immutable `site_widget.v1`; the extension was removed and
the exact internal/public compatibility split was added. Final read-only verdict: `PASS`, no
P0/P1.

## No-call / G6 boundary

- `OPENAI_API_KEY` remained absent from this tmux environment;
- M2 fetch spies observed zero calls;
- the real factory and real Agent `generate()` were not invoked;
- no staging/production config, deployment, secret, production data or route was changed;
- no Mastra/Studio/workflow/trace/Codex route or runner was added.

This evidence closes M2 local/fake only. It does not approve M3. The owner must explicitly approve
the exact reviewed G6 candidate SHA before any staging config/deploy or authenticated provider/model
call. The first real `live_v2` call remains M3 through Mastra plus server-only `OPENAI_API_KEY`.

## Post-evidence G6 transition

On 2026-07-15 the owner explicitly approved exact candidate SHA
`ad40c27ad2cb97b5f2249f263a64073feaea1fcf` for the bounded M3 staging transition. This dated
note does not rewrite the historical M2 no-call result. The current authorization permits one
synthetic real `live_v2` call through Mastra only; it does not permit a pre-Mastra direct call,
the full live corpus, continued staging enablement or production.
