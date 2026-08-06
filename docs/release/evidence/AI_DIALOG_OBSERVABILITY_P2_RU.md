# Evidence: AI-DIALOG-OBSERVABILITY-P2

Status: local_implementation_passed
Date: 2026-07-15
Repo: `granit-operations`
Slice: P2 after accepted G1Q, before P3 and every Mastra dependency
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Implementation SHA: `c08128e6bdf3e1b8f859e6349b4d6fb626de1287`
Parent SHA: `fa10c7c1b9c9ac092f2b991eeb9a5fbaf55caf1f`

## Что Реализовано

- Additive `ai_runs`, `ai_run_spans` и `ai_quality_events` без JSON/raw columns и без
  исторического backfill.
- App-owned `trace_id`, idempotent begin/replay и terminal completion для `persisted`,
  `handed_off`, `blocked`, `fallback_unavailable` и `failed`.
- Неизменяемая configured truth (`configured_model_provider/name/reasoning_effort`) отделена от
  terminal observed truth (`observed_model_provider/name`); Postgres replay восстанавливает их
  раздельно.
- Observed provider/model/tokens принимаются только из typed app-owned provider adapter result,
  привязанного к точному result object. Произвольный candidate metadata не может подделать их.
- Несовпадение adapter/provider identity и невалидное observed model name дают fail-closed
  `no_reply/model_error`, без outbound. Невалидный configured model name запрещает production
  provider/executor assembly до любого provider call и никогда не заменяется фиктивным именем.
- Persisted outbound, send-gate result, terminal run linkage, spans и quality state завершаются
  атомарно. Ошибка terminal update откатывает outbound/gate и отдельно атомарно фиксирует
  controlled failed run + manager review.
- Running replay и terminal replay не вызывают generator повторно. Terminal manager-review
  classification использует `sendGateResult/outcomeReason`, поэтому policy/context rejection не
  маскируется под send-gate block.
- Manager takeover сохраняется; outbound idempotency lookup строго ограничен
  outbound/`ai_assistant`/conversation/lead и не переиспользует collision visitor inbound.

## Immutable Migration Identity

- Path: `packages/db/migrations/0010_ai_run_quality_observability.sql`
- Git blob: `947c2d869ef7f0bdb272a2ca10e47dca6419149d`
- SHA-256: `0f41ef870538c4d219faaece03506db01a39683157cca79796bc2bd611727223`

## Проверки На Exact Implementation Tree

Все Node/Vitest команды выполнялись с `NODE_OPTIONS=--max-old-space-size=512`; Vitest и
PostgreSQL suites использовали по одному worker. Тяжёлые команды запускались последовательно.

| Check | Result | Evidence |
|---|---|---|
| `npm test -- --maxWorkers=1 --minWorkers=1` | passed: 245; skipped: 5 | Exact committed tree; пять условных PostgreSQL tests запущены отдельно ниже. |
| `npm run build` | passed | API/packages/manager typecheck и manager Vite production build. |
| focused core/integration/adapter | passed: 26 | Trusted provider observation, invalid config zero-call, replay/raw and outbound behavior. |
| Memory repository focused | passed: 8 | Concurrent begin/replay, terminal transitions, reconstruction and invariant collisions. |
| disposable PostgreSQL P2 suite | passed: 5/5 | Success/replay, manager takeover, forced atomic rollback/raw canary, outbound collision, allowed runtime/profile pairs. |
| frozen direct/P1Q regression group | passed: 126 | Legacy decision/golden/orchestrator, direct adapter fetch mock, all live-v2 assets/context/validator/apply/synthetic fixtures and turn context. |
| `git diff --check` / staged `--check` | passed | Clean implementation commit. |
| independent read-only reviews | passed | Atomic/replay review found no P0/P1; provider-truth review found two P1 issues, both fixed, then focused re-review returned `NO BLOCKERS`. |

## Disposable PostgreSQL Proof

Container profile: `postgres:16-alpine`, `--memory=192m`, `--cpus=1`, no published port. The
container was stopped and auto-removed after the checks; unrelated/staging containers were not
changed.

Fresh `0001..0010` result:

```text
observability_tables=3
observability_columns=69
observability_constraints=54
observability_indexes=17
json_columns=0
runtime_profile_check=1
model_observation_state_check=1
```

Upgrade `0001..0009 -> 0010` result after inserting one pre-P2 historical AI outbound:

```text
historical_ai_messages=1
backfilled_ai_runs=0
observability_tables=3
```

## Atomicity, Replay И Privacy Canaries

- A forced PostgreSQL trigger rejects `persisted` run completion. Test proves zero outbound,
  closed gate, `needs_manager`, controlled timeline, failed run and no raw trigger/provider text in
  run/span/event/timeline evidence.
- Collision test inserts visitor inbound with the would-be AI idempotency key. It is not reused as
  outbound; the run fails closed and manager review is persisted.
- Terminal no-reply replay performs zero additional generator calls. Running replay closes the
  gate and is retryable; concurrent begin/replay creates one canonical run.
- Configured and observed provider/model names survive Memory/Postgres round-trip independently;
  terminal update cannot overwrite configured truth.
- Schema and app sanitizer accept only controlled enum/version/fingerprint/timing/token/linkage
  fields. Raw model response, exception text, response ID, arbitrary metadata and customer text
  canaries do not enter runs, spans, quality events, business metadata or controlled timeline.

## No-Live-Call Proof

- `OPENAI_API_KEY` was absent from the tmux environment throughout P2.
- No Mastra dependency, runtime selector, staging config or deploy was added.
- Provider behavior used local fakes. The frozen direct adapter test replaces `fetch` with a
  Vitest spy and uses a synthetic response; it cannot contact OpenAI.
- `direct_openai` remains the manual `legacy_s05` rollback only. Database constraints reject
  `direct_openai + live_v2`; no automatic retry/failover was added.

## Граница Evidence

P2 closes minimum persistence, atomicity, replay and controlled evidence. It does not claim that
manager quality UI, versioned approved-asset startup loading, one centralized export/storage
sanitizer or bounded retention cleanup are complete; those are P3. It also does not authorize
Mastra, `live_v2`, staging configuration, deployment or a real provider/model call.

## Rollback

- Before any deployment, revert implementation commit
  `c08128e6bdf3e1b8f859e6349b4d6fb626de1287`; no runtime/config rollback is needed because P2 did
  not enable AI or deploy anything.
- The forced-failure PostgreSQL test is the transaction rollback proof for outbound/gate/run.
- If migration `0010` is ever deployed, do not drop evidence tables as an automatic rollback.
  Disable the consumer path and preserve audit rows; destructive migration rollback requires a
  separate owner-approved data plan.

## Sign-Off

- P2 local implementation: passed at exact SHA above.
- Next slice: P3 only.
- Mastra/M1, staging/G6 and every real model call: not approved by this evidence.
