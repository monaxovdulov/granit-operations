# Карточка среза AI Runtime Convergence: CONV-2 — turn contract и direct cutover

Статус: `accept`; owner stop-gate утверждён 2026-08-05, стабильный fingerprint
прошёл повторную свежую независимую проверку 2026-08-05.

Goal: `AI-RUNTIME-CONVERGENCE`.

Base SHA: `b678a37bfa7bbba66c9b416aa0c44743b9b51495`
(`HEAD == origin/main`; tracked tree до карточки содержал только owner-approved
изменения Goal/state этого среза; три user-owned `output/share/*` не изменяются).

## Один результат

Default `direct_openai` выполняет один app-owned pipeline
`ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn`; проверенный клиентский
текст атомарно сохраняется без последующей смысловой мутации и без implicit
fallback в legacy/Mastra.

## Утверждённое решение

- strict internal schema `granit_model_turn.v1` с отдельными answer/question,
  текущими set-slot/upsert-requirement seams, recommendation IDs и handoff intent;
- deterministic validation/composition, SHA-256 canonical `finalText` и запрет
  text mutation после hash;
- `CommittedTurn` использует существующую атомарную границу
  `conversation_messages + ai_runs + widget_ai_jobs`, без таблицы `ai_turns`;
- constraint-only migration разрешает `direct_openai + live_v2` и честный
  runtime linkage;
- prompt v2 меняется только под новый contract;
- модель `gpt-5.6-luna`, reasoning `medium`; это owner hypothesis, проверяемая
  обычными критериями CONV-2, без отдельного слоя и без подмены на Sol;
- ошибки завершаются fail-closed без запуска legacy/Mastra.

## Область и исключения

В области: live-v2 contract/validator/composer, direct production assembly,
production PostgreSQL recorded boundary, минимальная DB constraint migration,
metadata commitment, перенос применимых queue/replay/takeover tests.

Вне области: public contract, новая business/privacy/send/takeover policy,
corrections/retractions и persistent pending questions PR4, recommendations/tools
PR5, semantic verifier PR6, удаление rollback comparators CONV-3, secrets,
платные model calls, production activation и deploy.

## Проверки успеха

- strict schema и deterministic canonical text/hash;
- persisted body байт-в-байт совпадает с hashed final text;
- production direct assembly использует live-v2 Luna/medium без implicit fallback;
- PostgreSQL atomicity/replay/latest-wins/takeover invariants остаются зелёными;
- применимые unit/integration tests, migrations, typecheck, build и diff check;
- свежий независимый Reviewer выполняет Code Scout и даёт `accept`.

## Риски, непроверенное и откат

До реализации непроверены compile/runtime behavior, PostgreSQL migration и
concurrency paths, а также качество Luna на representative fixtures. External
runtime, staging/production, load и provider calls не проверяются.

До accepted commit откат — удалить только CONV-2 diff. После commit — отдельный
`git revert`; до CONV-3 legacy/Mastra остаются rollback comparators, но не
неявным runtime fallback.

## Evidence перед завершением

Фактическая модель Исполнителя: предыдущая Codex-сессия; точный runtime model
identifier в переданном состоянии не зафиксирован.

Фактическая модель независимого Reviewer: GPT-5 в новой Codex-сессии; точный
runtime model identifier интерфейсом не раскрыт. Reviewer не был автором
переданного рабочего diff и не изменял рабочий код.

Base SHA: `b678a37bfa7bbba66c9b416aa0c44743b9b51495`.

Итоговый commit и remote `main`:
`4d567d8acfef3718d92358c3980430539aea367d`; ordinary fast-forward push
`b678a37..4d567d8`, без force-push, deploy и внешней runtime-активации.

Прямое влияние: direct production assembly теперь использует
`granit_model_turn.v1`, Luna/medium, deterministic validator/composer и общую
атомарную PostgreSQL границу reply/run/job/state patches. Косвенное влияние:
runtime linkage `ai_runs`, sanitized message metadata, replay, worker
cancellation, latest-wins и manager takeover.

Проверки стабильного fingerprint:

- полный `npm test -- --maxWorkers=1`: `457 passed`, `15 failed`, `2 skipped`;
  все 15 падений совпадают с отдельно воспроизведённым чистым baseline на
  `b678a37` (modular boundaries 2, manager controls/quality 4, context 3,
  legacy golden 3, memory 2, approved assets 1), новых падений нет;
- focused non-PostgreSQL matrix: `62/62` (`model-turn`, direct adapter, M2
  integration, runtime assembly, config и sanitizer);
- real PostgreSQL: `25/25` runtime invariants, `10/10` observability atomicity и
  `6/6` migration reconciliation;
- `npm run build`: API source/tests bounded typecheck, manager typecheck и Vite
  production build прошли;
- `git diff --check HEAD`: прошёл;
- AST/caller audit подтвердил единственный production constructor direct adapter,
  direct assembly через `RecordedLiveV2TurnService`, общий recorded executor и
  две repository implementations (PostgreSQL и тестовая memory).

Состав commit diff: `34 files changed, 2435 insertions(+), 200 deletions(-)`.

Полный список затронутых файлов:

```text
.agents/state/granit-dev-workflow.json
apps/api/src/app-context.ts
apps/api/src/config.ts
apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts
apps/api/src/modules/ai/observability/ai-observability-sanitizer.ts
apps/api/src/modules/ai/ports/recorded-ai-turn.ts
apps/api/src/modules/ai/profiles/live-v2/assets/model-turn-prompt.v1.ts
apps/api/src/modules/ai/profiles/live-v2/live-v2-orchestrator.ts
apps/api/src/modules/ai/profiles/live-v2/live-v2-validator.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-contract.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-orchestrator.ts
apps/api/src/modules/ai/profiles/live-v2/model-turn-validator.ts
apps/api/src/modules/ai/repositories/ai-run-repository.ts
apps/api/src/modules/ai/repositories/postgres-ai-run-repository.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/src/modules/ai/services/recorded-public-widget-ai-turn-executor.ts
apps/api/src/modules/conversations/repositories/conversation-message-repository.ts
apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts
apps/api/src/widget-ai-runtime-assembly.ts
apps/api/test/ai-observability-sanitizer.test.ts
apps/api/test/ai-schema-migration-reconciliation.test.ts
apps/api/test/helpers/memory-intake-repository.ts
apps/api/test/helpers/postgres-widget-ai-test-harness.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/mastra-runtime-config.test.ts
apps/api/test/model-turn-validator.test.ts
apps/api/test/openai-live-v2-decision-generator.test.ts
apps/api/test/p2-observability-postgres.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
apps/api/test/widget-ai-runtime-assembly.test.ts
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_2_TURN_CONTRACT_RU.md
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md
packages/db/migrations/0020_direct_live_v2_turn_contract.sql
packages/db/src/schema.ts
```

Непроверено: реальные платные provider calls, staging/production activation,
load/latency и субъективное качество Luna; они явно вне области среза.

Rollback: до CONV-3 — отдельный `git revert` accepted commit CONV-2; legacy и
Mastra остаются только явными comparator paths, implicit fallback отсутствует.

Итоговый independent verdict: `accept`. Повторный проход стабильного fingerprint
не нашёл блокирующих дефектов по callers, failure paths, concurrency/replay,
migration/schema, privacy/sanitization, send gate, takeover и false-green tests.
Следующий срез — `CONV-3`; commit/push и remote SHA зафиксированы.
