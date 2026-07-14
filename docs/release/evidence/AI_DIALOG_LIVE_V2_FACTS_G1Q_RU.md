# Evidence: AI-DIALOG-LIVE-V2-FACTS-G1Q

Status: passed; exact owner acceptance recorded; 15-row repo snapshot verified; P2 unblocked; runtime disabled; not deployed
Date: 2026-07-14
Repo: `granit-operations`
Gate: G1Q
Source review: `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md`
Source audit: `docs/release/evidence/AI_DIALOG_P1Q_FACTS_SOURCE_AUDIT_RU.md`
Implementation commit: `1d737e0b8a055bd5ff313584540d30d4cc85be0a`

## Owner Decision

Владелец отправил точную all-row phrase для текущей audited table:

> Принимаю все 15 фактов P1Q из таблицы на source commit 23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a без изменений.

Decision date: `2026-07-14`. Принятие относится только к allowed wording и явно указанным
forbidden extrapolations. Оно не утверждает цены, сроки, наличие, скидки, оплату, договор,
гарантии, юридические правила, размеры или другие исключённые claims.

## Snapshot

- Path: `apps/api/src/modules/ai/profiles/live-v2/facts.v1.ts`.
- Version: `granit_live_v2_facts.v1`.
- Owner review ID: `G1Q-2026-07-14-owner-accepted-all-15-23f2ee8c`.
- Source repo/commit: `granit-site-cms@23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a`.
- Valid from: `2026-07-14`; review by is exclusive at `2026-10-14`.
- Exact composition: 15 unique facts — 6 product type, 3 material, 3 decoration, 3 process;
  16 source objects across five exact Git blobs.
- Git blob: `a65bb7d1f4b370d981885625360c919423b23a7f`.
- File SHA-256: `c93c94723cd9f5bdda8b0372e5f01b5c108df19bb353aaac3d098eb7daff2451`.

`live-v2-assets.test.ts` contains an independent full-object expected table and compares all 15
normalized rows with `toEqual`. This pins order, category, every allowed wording and forbidden
string, all 16 source path/line/blob/commit objects, approval flags and dates. A separate
independent review found no row-level mismatch.

The asset is validated deterministically at its approval date when loaded. Before every
`executeLiveV2Turn`, the orchestrator reparses it against the injected/current date; the snapshot
is accepted on `2026-10-13` and rejected on `2026-10-14` until a new owner review.

## Post-Snapshot Checks

All Node checks ran sequentially with `NODE_OPTIONS=--max-old-space-size=512`; Vitest used one
worker.

| Check | Result |
|---|---|
| Focused P1Q suite | passed, 5 files / 112 tests |
| Frozen `legacy_s05` suite | passed, 3 files / 9 tests |
| Full Vitest suite on implementation commit | passed, 17 files / 211 tests |
| `npm run typecheck` | passed |
| `npm run build` on implementation commit | passed |
| Exact 15-row independent review | passed after full-object assertion; no blockers |
| `git diff --check` / cached implementation diff | passed |

## No-Live-Call And Scope Proof

- `LIVE_V2_PROFILE.runtimeEnabled` remains `false`; provider remains `null`.
- The snapshot is not wired into the active frozen `direct_openai` runtime.
- No config, environment, package, lockfile, provider request, route, DB schema or deployment file
  changed in implementation commit `1d737e0`.
- No OpenAI, Mastra or other model endpoint was called.
- Customer-safe projection strips owner review, source paths/SHA, approval and date metadata.
- Frozen direct S05 remains the manual rollback profile and did not receive `live_v2` facts.

## Gate Result

G1Q is passed. P2 app-owned run/span/quality persistence is unblocked and is the next backend
slice. This evidence does not approve Mastra packages, staging config, deployment, production or
any real `live_v2` model call; those remain gated by P2, P3, M1 disabled, M2 local/fake and G6.
