# Task: AI-DIALOG-APP-TURN-BOUNDARY-P1 - App-owned context and legacy compatibility

Status: local_implementation_passed; G1 passed; not deployed
Created: 2026-07-14
Repo: `granit-operations`
Slice: P1 before Live Dialog Core P1Q
Owner/agent: owner-approved sequence / Codex implementation agent

## Цель

Завершить provider-neutral границу одного AI-turn до изменения качества диалога: приложение
формирует bounded model-safe history после сохранения inbound, структурно нормализует legacy
решение и сохраняет точное поведение замороженного direct OpenAI rollback.

## Preconditions

- G0/P0 принят в
  `docs/release/evidence/SITE_WIDGET_V1_CROSS_REPO_ACCEPTANCE_RU.md` на commit `7bbbdb9`.
- Baseline после `npm ci` зеленый: typecheck, 84 tests, API smoke 44 tests и build.
- P1 не устанавливает Mastra, не меняет schema/public `site_widget.v1` и не выполняет model call.

## Scope

1. Добавить app-internal execution context и internal inbound message ID, не выводя internal IDs в
   public response, prompt metadata или manager API.
2. Читать recent conversation history только до принятого inbound включительно, в стабильном
   порядке `created_at, id`; текущий inbound присутствует ровно один раз и не выталкивается caps.
3. Ограничить context одновременно по числу сообщений и общему числу символов; передавать только
   model-safe role/direction/content/timestamp fields без contact PII и transport payloads.
4. Добавить versioned structural legacy mapping без анализа текста:
   `reply_candidate + stop=false -> answer`, `reply_candidate + stop=true -> handoff_to_manager`,
   `no_reply -> no_reply`.
5. Провести legacy decision через app-owned orchestration/apply seam, сохранив inbound-first
   persistence и существующий send-time takeover gate.
6. Golden-тестами заморозить direct profile: prompt/policy/disclosure versions, request shape,
   `gpt-5.5`, low reasoning, `store:false`, candidate/fallback и public outcomes.

## Invariants

- Replay anchored by accepted inbound ID cannot read later conversation messages.
- Client-controlled `submitted_at` is not the ordering cursor.
- Current inbound survives both count and character caps and appears once.
- Mastra/Fastify/public-contract/provider types do not enter the neutral decision module.
- Frozen direct runtime, prompt and policy source files are inspected/tested, not behaviorally
  changed by P1.
- No real OpenAI/Mastra request is allowed in tests or implementation.

## Out Of Scope

- `live_v2` dialogue actions, tone/facts assets and semantic fixtures (P1Q).
- `ai_runs`/trace/quality database state (P2), retention/runtime guards (P3).
- Mastra dependencies/runtime (M1+), staging config/deploy (G6/M3), production enablement.
- Token streaming, SSE/WebSocket and public `site_widget.v1` changes.

## Expected Files

- `apps/api/src/modules/ai/ai-turn.ts` and new provider-neutral orchestration/legacy adapter files;
- conversation/public intake repositories and memory test repository;
- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`;
- focused context, compatibility, adapter request-shape, public intake and boundary tests;
- task/evidence indexes and P1 evidence record.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `npm ci` | passed | 179 audited packages; lockfile unchanged. Audit reported 1 low, 1 high and 1 critical advisory; no automatic mutation applied. |
| `npm run typecheck` | passed | Pre-P1 baseline. |
| `npm run smoke:api` | passed, 44 tests | Pre-P1 public intake baseline; providers are injected fakes. |
| `npm test` | passed, 84 tests | Pre-P1 full Vitest baseline; no production adapter import/call path. |
| `npm run build` | passed | Pre-P1 manager production build. |
| final full Vitest, one worker | passed, 12 files / 99 tests | Post-P1 local suite. |
| final build with 512 MiB Node heap cap | passed | Includes full typecheck and manager Vite build. |
| independent adversarial review | two findings addressed | Causal replay and internal-ID consistency findings fixed; bounded post-fix checks passed before sign-off. |

## Evidence Links

- Parent plan: `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`.
- G0 evidence: `docs/release/evidence/SITE_WIDGET_V1_CROSS_REPO_ACCEPTANCE_RU.md`.
- P1 evidence: `docs/release/evidence/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md`.

## Blockers

- None for P1. G1 evidence passed; P1Q may start.

## Next Action

Start P1Q from reviewed P1 code head `84e61de`; keep direct S05 golden tests green and do not add
Mastra packages or live model calls.
