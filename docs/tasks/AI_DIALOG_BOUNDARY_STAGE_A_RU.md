# Task: AI-DIALOG-BOUNDARY-STAGE-A - Neutral AI turn boundary

Status: local_implementation_passed; not production approval
Created: 2026-05-29
Repo: `granit-operations`
Slice: AI dialog risk reduction Stage A
Owner/agent: Codex

## Цель

Закрыть первый implementation slice из planning brief `AI_DIALOG_BOUNDARY_STAGE_A_RU`: AI для website widget должен работать через neutral app-owned `AiTurnInput` после inbound persistence, а не через raw widget DTO. Customer-facing widget behavior остается совместимым.

## Scope

- Расширить Stage A `AiTurnInput` contract: `version`, `turn`, `gateSnapshot`, `knownSlots`, `boundaryConfig`, `approvedSources`, `evidence`.
- Централизовать сборку site widget AI turn input в `apps/api/src/modules/ai/ai-turn.ts`.
- Передавать AI input fingerprint в `AiTurnInput.turn.inputFingerprint` и в persisted AI reply metadata отдельно от outbound persistence fingerprint.
- Сохранить validation/fail-closed path для invalid candidate decisions and missing approved price/business sources.
- Обновить focused public widget test evidence for neutral boundary fields.

## Out Of Scope

- Production deploy or production approval.
- Mastra runtime, Mastra Studio, scorer/eval runner or new runtime dependency.
- Telegram AI outbound or any new reply-capable channel.
- DB schema/migration/env/secret changes.
- Approved price source, price orientation, binding terms, payment, warranty, availability or legal/funeral advice.
- Public widget contract changes.

## Files Touched

- `apps/api/src/modules/ai/ai-turn.ts`
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/test/helpers/memory-intake-repository.ts`
- `apps/api/test/public-intake.test.ts`
- `docs/tasks/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- `docs/tasks/README.md`
- `docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- `docs/release/evidence/README.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `npm test -- apps/api/test/public-intake.test.ts apps/api/test/modular-boundaries.test.ts` | passed, 56 tests | Widget baseline, Stage A neutral input assertions, invalid candidate/source fail-closed, Telegram AI outbound block and module boundary tests. |
| `npm run typecheck` | passed | API/packages and manager TypeScript. |
| `npm test` | passed, 84 tests | Full local Vitest suite after Stage A contract changes. |
| `git diff --check` | passed | No whitespace errors in `granit-operations`. |

## Evidence Links

- `docs/release/evidence/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- Planning brief: `../../granit-plan-app/docs/tasks/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
- Target architecture: `../../granit-plan-app/docs/tasks/AI_DIALOG_RISK_REDUCTION_TARGET_ARCHITECTURE_RU.md`

## Blockers

- Production remains blocked until separate production gates, backup/restore/rollback evidence and explicit owner sign-off.
- Telegram AI outbound remains blocked.
- Mastra runtime/eval runner remains blocked until app-owned `ai_runs` / `review_labels` / `eval_cases`, approved asset import, redaction/retention rules and owner decision exist.
- Stage A still has no approved app-owned price source, so price amount/range/orientation remains fail-closed.

## Next Action

Next AI slice should add app-owned review/eval/degradation linkage or approved AI asset import as a separate task. Do not enable Mastra runtime, Telegram AI outbound or production AI from this Stage A implementation.
