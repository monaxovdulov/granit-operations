# Reconcile remaining branches: аудит и матрица переноса

Дата аудита: 2026-07-20 UTC.

Цель: безопасно разобрать оставшиеся ветки `granit-operations`, сохранить локальные Mastra-коммиты и переносить в `main` только актуальные изменения небольшими PR.

## Проверенное состояние

- `main` / `origin/main`: `e65a6b8` (`Merge pull request #3 from monaxovdulov/agent/live-grounded-widget-assistant`).
- PR #1 `codex/public-intake-preview-cors`: draft, head `2528e43`, `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`.
- PR #2 `codex/mastra-observability-first-slice`: draft, remote head `2a50643`, `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`.
- Локальная ветка `codex/mastra-observability-first-slice` в worktree `/home/devuser/.codex/worktrees/0c00/granit-operations`: чистая, head `ade81eb`, на 5 коммитов впереди remote.
- Safety ref: `origin/safety/mastra-observability-first-slice-ade81eb-20260720` указывает на `ade81eb`.
- Detached release-worktrees под `/srv/botops/releases/operations/*` проверены read-only; изменять и удалять их нельзя.
- В `main` уже есть миграции `0010_ai_dialog_stage_b.sql` .. `0013_live_widget_memory_shadow.sql`; новые DB-изменения начинаются с `0014`.

## Решения

Статусы:

- `keep`: переносится без смены смысла.
- `adapt`: переносится заново поверх текущего `origin/main`.
- `superseded`: не переносится, потому что main уже содержит более актуальную реализацию или старый подход конфликтует с новым runtime.
- `evidence-only`: историческое доказательство/план; не считается текущим runtime evidence без повторной проверки.

### PR #1: `codex/public-intake-preview-cors`

| Коммит | Статус | Файлы | Решение |
| --- | --- | --- | --- |
| `0ff2548` Document staging public intake CORS design | evidence-only | `docs/superpowers/specs/2026-07-13-public-intake-staging-cors-design.md`, `docs/ENVIRONMENT.md`, `docs/env/secrets-inventory.example.md` | Не сливать старую ветку. Использовать как контекст для нового CORS PR, если текст остается фактически верным. |
| `2528e43` Scope public intake CORS to exact origins | adapt | `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/modules/intake/routes/public-intake-routes.ts`, `apps/api/test/config.test.ts`, `apps/api/test/public-intake-cors.test.ts`, `apps/api/package.json`, `package-lock.json` | Перенести на свежую ветку от `origin/main`: сохранить текущий grounded AI config, добавить exact-origin CORS только на public intake routes, обновить dependency/lockfile и tests. |

### PR #2 remote: `codex/mastra-observability-first-slice`

| Коммит(ы) | Статус | Файлы / область | Решение |
| --- | --- | --- | --- |
| `2a8026d`, `faea9e0`, `8a9b46d`, `7bbbdb9`, `4003ed4`, `85df710`, `cb0568e`, `12742ae`, `f4e30c0`, `2047a0a`, `3aa7d93`, `fa10c7c`, `368b967`, `c7a3e5a`, `b190ef7`, `32feb5a`, `ad40c27`, `a8cd55c`, `fff1406`, `544a5f4`, `fd491f5`, `4c6eb35`, `f1871d5`, `59552bb`, `2a50643` | evidence-only | `docs/tasks/*`, `docs/release/evidence/*`, `.agents/state/granit-dev-workflow.json` | Исторические планы и staging evidence не выдавать за актуальный runtime. Переносить только если будет новая проверка на текущем `main`. |
| `f8f95d4`, `bae2418`, `84e61de` | superseded | `apps/api/src/modules/ai/ai-turn.ts`, `apps/api/src/modules/ai/ports/*`, `apps/api/src/modules/ai/services/*`, `apps/api/src/app-context.ts`, `apps/api/test/ai-turn-context.test.ts` | Текущий `main` уже содержит app-owned grounded AI boundary, generator/verifier contract, send gate и memory shadow. Не восстанавливать legacy boundary. |
| `78c9947`, `1d737e0`, `aed1303` | superseded | `apps/api/src/modules/ai/profiles/live-v2/*`, approved facts/assets, legacy-s05 profile files | Конкурирует с текущим grounded AI implementation. Live-v2 факты/профили не переносить как runtime. |
| `c08128e` Persist app-owned run observability | adapt | `apps/api/src/modules/ai/repositories/*`, `apps/api/src/modules/conversations/repositories/*`, `apps/api/test/p2-*`, DB schema | Не дублировать существующие `ai_runs`, verifier/eval и send gate. Переносить только узкие observability поля/события, совместимые с текущими таблицами. |
| `56a81eb` Complete P3 AI privacy and manager visibility | adapt | `apps/api/src/modules/ai/observability/*`, manager lead DTO, manager UI quality notice, tests | Перенести privacy/manager-quality поверх текущих `ai_runs` и manager detail без старого run repository contract. |
| `de45913`, `b16ee6d`, `08224e9`, `1e6f56a`, `9f52bfb` | superseded | `apps/api/src/modules/ai/adapters/mastra-live-v2-decision-generator.ts`, `apps/api/src/widget-ai-runtime-assembly.ts`, Mastra config/tests/scripts, `package.json`, `package-lock.json` | Mastra adapter можно рассматривать только как отключаемый optional provider после проверки совместимости с текущими contracts/evals. На текущем проходе не переносить старый live-v2 orchestration. |
| `6f04e0b` Scope public intake CORS to exact origins | adapt | Та же область, что PR #1 CORS | Дубликат CORS поверх Mastra ветки; переносится через отдельный свежий CORS PR, не через PR #2. |

### Локальные 5 коммитов на `ade81eb`

| Коммит | Статус | Файлы | Решение |
| --- | --- | --- | --- |
| `37974c6` docs: design manager AI control switches | evidence-only | `docs/superpowers/specs/2026-07-16-manager-ai-control-switches-design.md` | Использовать как дизайн-контекст; не считать текущим evidence без новой проверки. |
| `0073cb5` feat: add manager AI control switches | adapt | `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`, `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`, `apps/api/src/modules/manager/routes/manager-routes.ts`, `apps/api/src/modules/manager/use-cases/manager-lead-use-cases.ts`, `apps/manager/src/*`, `packages/db/src/schema.ts`, old `packages/db/migrations/0012_manager_ai_runtime_controls.sql` | Перенести как отдельный PR, но migration перенумеровать в `0014`; global switch должен участвовать в текущем grounded send gate, а не возвращать старый runtime. |
| `5d55bb6` тест: покрыть переключатели управления ИИ | adapt | `apps/api/test/manager-ai-control.test.ts`, `apps/api/test/helpers/memory-intake-repository.ts`, `apps/api/test/p2-observability-postgres.test.ts` | Адаптировать тесты под текущие helper/repository contracts. |
| `3169024` тест: уточнить ответ при глобальной остановке ИИ | adapt | `apps/api/test/p2-observability-postgres.test.ts` | Перенести смысл: global stop не вызывает generator и не создает outbound; не тащить старый P2 run repository. |
| `ade81eb` документация: зафиксировать проверку управления ИИ | evidence-only | `docs/release/evidence/MANAGER_AI_CONTROL_SWITCHES_RU.md` | Не переносить как доказательство до повторных проверок на новом PR. Safety ref сохраняет исходный коммит. |

## План PR

1. Docs audit matrix: этот файл.
2. Fresh CORS PR: exact-origin CORS для public intake.
3. Manager AI control PR: global switch + per-conversation manager switch, migration `0014`, tests.
4. Observability/privacy/manager-quality PR: только совместимые события/санитизация/manager summary поверх текущего grounded runtime.

## Явно устаревшие части

- Старые migration номера `0010`/`0011` из Mastra PR не переносить.
- Старый live-v2 orchestration, legacy-s05 profile routing и Mastra staging smoke scripts не сливать.
- Старые staging evidence файлы не использовать как актуальное доказательство production/staging runtime.
