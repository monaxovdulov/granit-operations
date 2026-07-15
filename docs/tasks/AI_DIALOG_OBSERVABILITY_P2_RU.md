# Task: AI-DIALOG-OBSERVABILITY-P2 - минимальная app-owned запись AI run, span и quality event

Status: passed at `c08128e6bdf3e1b8f859e6349b4d6fb626de1287`
Created: 2026-07-14
Repo: `granit-operations`
Slice: P2 after accepted G1Q, before P3 and every Mastra dependency
Owner/agent: owner approved P2 continuation / Codex implementation agent

## Цель

Сделать frozen `direct_openai` path наблюдаемым и идемпотентным на стороне приложения:
каждая реально запущенная AI-попытка получает app-generated trace/run, терминальный исход и
контролируемое quality evidence, а сохранённый AI-ответ связывается с run атомарно в том же
send-gate transaction. Это prerequisite persistence slice, а не включение `live_v2` или Mastra.

## Scope

- P2A: additive migration `0010` и Drizzle parity для `ai_runs`, `ai_run_spans`,
  `ai_quality_events`, без исторического backfill.
- P2B: строгие repository ports и app-owned recorder/orchestrator для начала, replay и
  терминального завершения direct run.
- P2C: интеграция после сохранения inbound и до legacy runner; app-generated `trace_id`;
  атомарная связь persisted outbound + run + send-gate result.
- Терминальные исходы: `persisted`, `handed_off`, `blocked`, `fallback_unavailable`, `failed`.
- Только контролируемые enum/version/timing/fingerprint/token поля; без текста сообщения,
  prompt/response, provider payload, произвольного metadata или raw exception.
- Fail-closed: ошибка recorder не может превратиться в ложный AI success; inbound остаётся
  сохранённым, а controlled quality state переводит обработку к manager review.
- Replay терминального turn не создаёт новый run и не вызывает generator/provider повторно.
- Focused memory/Postgres tests, frozen legacy checks и последовательные bounded-memory проверки.

## Out Of Scope

- `live_v2` runtime enablement, Mastra package/adapter, `OPENAI_API_KEY` или любой реальный
  provider/model call.
- Изменение frozen direct prompt/profile или автоматические retry/failover.
- Manager UI/API badge, centralized sanitizer, retention cleanup и полное закрытие G2/G3 — P3.
- Telegram AI outbound, production/staging deploy и runtime config changes.
- Исторический backfill существующих AI-сообщений.

## Files Touched

- `packages/db/migrations/0010_ai_run_quality_observability.sql` and Drizzle parity in
  `packages/db/src/schema.ts`.
- `apps/api/src/modules/ai/repositories/*`: neutral run contracts plus Memory/Postgres adapters.
- `apps/api/src/modules/ai/services/*`: app-owned recorder, trusted provider observation,
  strict terminal evidence and replay handling.
- `apps/api/src/modules/ai/ports/*` and `apps/api/src/modules/intake/ports/*`: neutral atomic
  reply and manager-review boundaries.
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` and the memory
  test adapter: atomic outbound/run completion, recovery and manager takeover behavior.
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`: fail-closed executor,
  manager-review and terminal replay routing.
- `apps/api/src/app-context.ts`, `apps/api/src/index.ts` and the direct adapter: production
  assembly with exact configured model truth and no unsafe model-name substitution.
- P2 core, Memory, integration and PostgreSQL tests plus frozen-boundary regression updates.

## Checks Run

Все Node/Vitest проверки выполняются последовательно с
`NODE_OPTIONS=--max-old-space-size=512`; Vitest/Postgres workers — один.

| Command/check | Result | Notes |
|---|---|---|
| AST-index integration/schema map | passed | Recorder, replay, send-gate, assembly and schema seams reviewed before edits |
| P2 focused app checks | passed | Core 12, integration 12, Memory repository 8, modular boundaries 13; trusted-provider/config regression included |
| Disposable PostgreSQL suite | passed | 5/5: success/replay, takeover, atomic rollback/raw canary, outbound collision and runtime/profile checks |
| Fresh migrations `0001..0010` | passed | 3 tables, 69 columns, 54 constraints, 17 indexes, zero JSON columns; runtime/profile and observation-state checks present |
| Upgrade `0001..0009 -> 0010` | passed | Historical AI message preserved; zero synthetic run backfill; all 3 observability tables created |
| Full bounded regression | passed | 245 passed; 5 conditional PostgreSQL tests skipped here and passed separately above; one Vitest worker |
| Typecheck and production build | passed | Root/API/manager TypeScript plus manager Vite build |
| Independent review | passed | Replay/atomicity review and focused blocker re-review report no P0/P1 findings |
| No-live-call proof | passed | `OPENAI_API_KEY` absent; only local fakes/static fetch mock; no staging/runtime config or provider call |

## Evidence Links

- `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
- `docs/release/evidence/AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md`
- `docs/release/evidence/AI_DIALOG_OBSERVABILITY_P2_RU.md` pins the immutable implementation SHA,
  migration blob/SHA256, fresh/upgrade schema output, rollback/raw canaries and no-live-call proof.

## Blockers

- None. Exact G1Q facts acceptance is recorded, and the owner explicitly approved continuing to
  P2 on 2026-07-14.

## Next Action

Push the exact P2 implementation/evidence commits, then start P3. P2 closes
persistence/atomicity; manager UI and complete sanitizer/retention remain deliberately P3.
