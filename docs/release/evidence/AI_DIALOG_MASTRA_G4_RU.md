# AI dialog Mastra G4 evidence

Status: `passed`

Review date: `2026-07-15` UTC

Implementation commit: `aed13036a19490d8b8b0311fd1d2dbba93a5d39e`

Reviewed predecessor: `c7a3e5a9098645a0a4ac3f433aef01a113ba7cc7`

## Result

The dated official-doc/package review passed and the minimum runtime graph is pinned without
enabling Mastra in the application:

- `@mastra/core@1.51.0` exact;
- `zod@3.25.76` exact in the API and contracts workspaces;
- project Volta Node `22.22.0`, engine floor `>=22.22.0`;
- no Mastra CLI/server/Studio/storage/observability package and no separate AI SDK/OpenAI package;
- exact future request profile is type-tested as `openai/gpt-5.6-sol`, `medium`,
  `store:false`, `transport:"fetch"`, one step and zero retries;
- app-owned persistence/observability remains the only approved evidence path.

The full dated source analysis, package integrity, network/storage defaults, telemetry opt-outs
and G6 re-check obligation are in
`docs/tasks/AI_DIALOG_MASTRA_G4_REVIEW_RU.md`.

## Locked artifacts

```text
@mastra/core 1.51.0
npm shasum 32261516397da0003138a65e6ab68d9e1564ed45
npm integrity sha512-MmY2/cA97y8KSJ9w/GlMRKTBNsglO1XHI5zv8oVcYQhGr6AFZ/jnAbKzjIEEBrofRca7TXYYvg6YeZCCY4fBvg==
package-lock.json sha256 187f692a8d1f4ab29b9f8e63d3a21461417e4f99cf8706c5b12eab52893edcb1
```

Installation used `npm install --ignore-scripts --no-audit --no-fund`; dependency lifecycle
scripts were not run.

## Verification

All heavy checks were sequential with the project Node pin and `NODE_OPTIONS=--max-old-space-size=512`.

```text
npm run typecheck
PASS

npx vitest run apps/api/test/mastra-g4-package-contract.test.ts --maxWorkers=1 --minWorkers=1
1/1 PASS; Agent construction and exact typed options caused zero fetch calls

npm test -- --maxWorkers=1 --minWorkers=1
262/262 executed tests PASS; 7 conditional PostgreSQL tests skipped

npm run build
PASS; manager production bundle built

npm audit --omit=dev --audit-level=high
PASS at requested threshold; 0 high/moderate, two dependency paths to one known low advisory

git diff --check
PASS
```

The low advisory is `GHSA-866g-f22w-33x8`, affects Mastra's pinned provider-utils aliases and
lists no patched version. It is unreachable in disabled M1 and zero-network M2; it is an explicit
G6 package/advisory re-check item before M3, not silently waived for a real call.

## Independent review

Two read-only audits were run separately from the implementation:

- package/type audit: no P0 blocker for M1/M2; required explicit
  `MASTRA_TELEMETRY_DISABLED=true`, `MASTRA_AUTO_REFRESH_PROVIDERS=false`, absent enterprise
  license variables, fetch transport, all retry bounds and G6 advisory re-check;
- runtime seam audit: Mastra must not be inserted through legacy `WidgetAiProvider`; M1 needs a
  disabled separate `live_v2` adapter and M2 needs neutral app-owned execution/persistence ports.

Those constraints are mandatory inputs to M1/M2.

## No-call / no-enable proof

- `OPENAI_API_KEY` was unset in the tmux environment.
- No application source, route, runtime selector or deployment configuration changed in G4.
- The only Mastra runtime test constructed an Agent with a non-secret sentinel and did not call
  `generate()`; a fetch spy observed zero calls.
- No staging/production configuration, secret, database or external trace export was changed.
- Frozen direct OpenAI remains `legacy_s05` manual rollback; no `live_v2` or automatic retry was
  added to it.

G4 authorizes M1 disabled and M2 local/fake only. G6 still blocks every real provider/model call.
