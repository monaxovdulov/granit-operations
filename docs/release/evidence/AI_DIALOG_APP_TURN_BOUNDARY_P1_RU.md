# Evidence: AI-DIALOG-APP-TURN-BOUNDARY-P1

Status: local_implementation_passed
Date: 2026-07-14
Repo: `granit-operations`
Slice: P1 before Live Dialog Core P1Q
Task link: `docs/tasks/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md`
Implementation head: `84e61de`
Contracts: `granit_ai_turn_input.stage_a.v1`, `granit_ai_turn_execution_context.v1`,
`legacy_s05`

## Что Проверяли

- app-only execution identity содержит internal lead/conversation/inbound message IDs, но не
  попадает в model input или public `site_widget.v1` response;
- inbound/outbound persistence возвращает internal message IDs приложению;
- recent text history ограничена 8 сообщениями и 8000 символами, идет oldest-first, содержит
  current inbound ровно один раз и не использует client `submitted_at` как курсор;
- replay строит history только до принятого inbound и не подтягивает более поздние сообщения;
- legacy candidate проходит app-owned цепочку generate -> validate -> structural map -> apply;
- exact mapping: обычный reply -> `answer`, stop-AI reply -> `handoff_to_manager`, no-reply ->
  `no_reply`, без анализа текста для выбора action;
- internal identity mismatch закрывается fallback до generator/persistence;
- direct S05 prompt/policy/disclosure и OpenAI Responses request остаются заморожены:
  `gpt-5.5`, low reasoning, `store:false`;
- existing inbound-first persistence, unsafe-output checks, takeover send gate, replay и public
  response states остаются совместимы.

## Implementation Commits

- `f8f95d4` - bounded app-owned turn context and internal persistence IDs;
- `bae2418` - causal replay cursor correction;
- `84e61de` - versioned legacy mapping, validator, orchestrator/apply seam and direct golden tests.

## Causal Replay Proof

Новые conversation message timestamps сериализуются update-lock по conversation и вычисляются как
максимум DB wall clock, предыдущего `conversation.updated_at + 1 ms` и последнего message timestamp
`+ 1 ms`. Это сохраняет строгий порядок через PostgreSQL -> JavaScript `Date` precision boundary.

Новый inbound помечен cursor version `conversation_updated_at.v1`. Для pre-P1 anchor без этой
гарантии repository fail-safe возвращает только current inbound вместо потенциально причинно
неверной history. Query использует строгий `created_at < anchor.created_at`; случайный UUID
остается только стабильным вторичным sort key и не определяет причинность.

## Команды И Проверки

Все тяжелые проверки выполнялись последовательно с ограничением heap/workers.

| Check | Result | Notes |
|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=512 npx vitest run --maxWorkers=1 --minWorkers=1` | passed, 12 files / 99 tests | Full local suite; fetch in direct adapter golden is intercepted. |
| `NODE_OPTIONS=--max-old-space-size=512 npm run build` | passed | Includes API/packages and manager typecheck plus manager Vite build. |
| focused P1 context/public/legacy/direct suite | passed, 6 files / 58 tests | Count/char/replay/privacy, identity mismatch, mapping/orchestration and request shape. |
| independent adversarial review | two findings addressed | Replaced equal-time random-UUID causality and added internal-ID fail-closed check; bounded post-fix checks passed. |
| `git diff --check` / commit `--check` | passed | No whitespace errors. |

## No-Live-Call Proof

- No Mastra dependency/runtime/config exists in P1.
- Context/history and orchestration tests use memory repositories and fake generators.
- The only new direct adapter test installs a `fetch` spy before invoking the adapter and asserts
  one synthetic request/response; it cannot contact OpenAI.
- No `OPENAI_API_KEY` value, live POST, provider request or staging mutation was used.

## Evidence Limits

- This is local implementation evidence, not deployment, staging enablement or production approval.
- No external Postgres smoke was run in P1; the SQL path is typechecked, independently reviewed,
  protected by source regression assertions and mirrored by deterministic memory tests.
- P1 makes history available but frozen direct S05 prompt intentionally still uses its legacy
  single-turn shape. Natural multi-turn behavior, no-repeat rules and one-useful-question quality
  belong to P1Q `live_v2` and its synthetic fixtures.
- No Mastra/model semantic quality claim is made.

## Rollback

Revert `84e61de`, `bae2418` and `f8f95d4` in reverse order. No migration, package, environment,
public contract or deploy rollback is required. Frozen direct runtime/prompt/policy source files
were not changed.

## Sign-Off

- G1 local implementation: passed.
- P1Q: authorized to start from code head `84e61de`.
- Staging/production: not approved by this evidence.
