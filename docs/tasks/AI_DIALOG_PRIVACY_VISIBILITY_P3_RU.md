# Task: AI-DIALOG-PRIVACY-VISIBILITY-P3 - manager quality, approved assets, sanitizer и retention

Status: passed; exact implementation SHA is recorded by the follow-up evidence commit
Created: 2026-07-15
Repo: `granit-operations`
Slice: P3 after P2 at `c08128e`, before G4 and every Mastra dependency
Owner/agent: owner-approved implementation sequence / Codex orchestrator

## Цель

Закрыть G3 prerequisites поверх P2: показать менеджеру минимальное unresolved AI quality state,
закрепить repo-owned versioned assets на run, применить один fail-closed allowlist sanitizer перед
observability storage и дать bounded dry-run/execute cleanup только для истёкших spans.

## Scope

- Protected manager detail возвращает на каждый диалог только latest open manager-visible AI
  event: controlled type/reason/severity, terminal run status и timestamp.
- Manager UI показывает это состояние без raw traces, prompt, response, hidden reasoning,
  customer text или provider payload.
- Strict versioned manifest связывает legacy S05 policy/prompt/disclosure/tool/profile и
  owner-approved live_v2 prompt/tone/facts/profile; module-load validation является startup/test
  gate, Sheet/TSV runtime reads отсутствуют.
- Runs получают точный approved asset bundle version.
- Central sanitizer копирует только allowlisted run/span/event/outbound evidence fields и
  отбрасывает неизвестные ключи до DB storage; export остаётся disabled.
- Postgres-backed one-shot span cleanup поддерживает dry-run по умолчанию и explicit execute,
  bounded batch, stable non-future cutoff и удаляет только `ai_run_spans` с
  `expires_at <= cutoff`.
- Forward-only S10 contract документирует будущие ссылки review/eval на `ai_runs.id` и
  `ai_quality_events.id`, без mutation/promotion UI.
- Focused API/UI/assets/sanitizer/retention tests, disposable PostgreSQL proof, frozen/full
  regression, rollback/no-live-call evidence.

## Out Of Scope

- Mastra packages, G4/M1/M2, runtime selection, staging config/deploy или provider/model call.
- External trace exporter, scheduler/deploy wiring cleanup, manager label mutation, eval promotion.
- Изменение frozen direct S05 prompt/policy/disclosure/request profile.
- Удаление `ai_runs`, `ai_quality_events`, message/business state или production data.

## Files Touched

- Manager repository DTO/query, protected route integration and manager types/display/UI.
- `apps/api/src/modules/ai/assets/*` for strict approved manifest.
- `apps/api/src/modules/ai/observability/*` for sanitizer, retention and forward linkage contract.
- App assembly/run repositories and focused tests.
- One-shot script/root npm command plus task/evidence docs.

## Checks Run

Все Node/Vitest проверки выполняются последовательно с
`NODE_OPTIONS=--max-old-space-size=512`; Vitest/Postgres workers — один.

| Command/check | Result | Notes |
|---|---|---|
| AST-index manager/storage/assets map | passed | Existing protected manager and P2/P1Q seams mapped before edits |
| Focused P3 tests | passed | Protected API/UI, strict assets, raw/secret/PII canaries, dry-run/execute and approval-window fail-closed behavior |
| Disposable PostgreSQL P2+P3 suite | passed: 13/13 | Fresh `0001..0010`; atomic P2 regression, latest-open-event selection and expired-span-only deletion |
| Frozen direct/P1Q regression | passed in full suite | No direct behavior/profile drift and no live provider call |
| Full test/typecheck/build | passed | 262 passed, 7 conditional PostgreSQL skipped then passed separately; production manager build passed |
| Independent review | passed after fixes | Two cross-reviews; all P1 findings fixed; final narrow re-reviews returned no P0/P1 blockers |

## Evidence Links

- `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
- `docs/release/evidence/AI_DIALOG_OBSERVABILITY_P2_RU.md`
- `docs/architecture/AI_REVIEW_EVAL_LINKAGE_S10_RU.md`
- P3 exact-SHA evidence: follow-up commit under `docs/release/evidence/`

## Blockers

- None. P2 and P3 implementation checks pass. No Mastra package, runtime switch, provider call,
  staging mutation or production-data mutation occurred.

## Next Action

Commit/push the exact P3 implementation and evidence, then perform dated G4 review against current
official Mastra/OpenAI primary docs before pinning M1 dependencies. Do not call a model.
