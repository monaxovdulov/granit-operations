# Карточка среза AI Runtime Convergence: CONV-1 — direct live-v2 adapter parity

Статус: `accepted` и опубликован.

Goal: `AI-RUNTIME-CONVERGENCE`.

Позиция в roadmap: `PR2 accept/published -> CONV-1 -> CONV-2`.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`d91558c5ef5047a312ea0dffb4648aa2dac42253` /
`aff347bb00d07f8ee40f86203bd27a6a99b5b40f`.

Фактическая модель Исполнителя: текущая Codex-модель, high reasoning.

Фактическая модель принявшего независимого Reviewer: `gpt-5.6-sol`, effort
`high`, session `019fcf37-2b94-7250-af80-ae5a8a13b33e`.

## 1. Один результат

Существующий app-owned live-v2 pipeline может выполнить тот же bounded
structured model turn через прямой OpenAI Responses adapter, без Mastra
и без изменения public/runtime behavior.

Это следующий заранее указанный срез Goal: он создаёт direct
comparator до cutover CONV-2 и до удаления Mastra/legacy в CONV-3.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | tracked tree clean; три исходных user-owned `output/share/*` не изменяются |
| Base/head SHA | `d91558c5ef5047a312ea0dffb4648aa2dac42253`; `HEAD == origin/main` |
| PR2 prerequisite | repair `ca1cdb798829674e40b4eab7e4e948476e71d61c`, independent `accept`, publication record `d91558c5ef5047a312ea0dffb4648aa2dac42253` |
| Текущие обязательные тесты | adapter + direct golden + synthetic live-v2 + runtime assembly + M2 integration: `51/51` |
| Известный gap | `live_v2` OpenAI adapter существует только через Mastra; direct Responses client обслуживает legacy/grounded path |
| Незавершённые пользовательские изменения | только три исходных untracked `output/share/*`; вне области |

Источники истины по приоритету:

1. `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`;
2. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
3. `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
4. `docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md`;
5. current code/tests на base SHA выше.

## 3. Область

Разрешены:

- provider-neutral live-v2 generation/observation/error port, сейчас связанный
  с Mastra adapter;
- direct OpenAI Responses implementation того же input, instructions,
  structured-output schema, model/reasoning, timeout, cancellation и no-retry contract;
- узкое расширение общего direct Responses client для safe HTTP status,
  reasoning effort и bounded usage, без раскрытия raw body/errors;
- dependency injection и tests, позволяющие сравнить direct с
  текущим Mastra comparator без production cutover.

Явно вне области:

- переключение `AI_RUNTIME_MODE`/default/production assembly;
- удаление Mastra, `mastra_openai_api`, `legacy_s05` или их tests;
- изменение prompt, model, reasoning profile, AI-policy, validator,
  public contract, DB schema/migration, privacy, send gate и manager takeover;
- deploy, secrets/runtime configuration, external DB и реальный/платный model call.

Ожидаемый размер diff был средним adapter slice на 5–8 файлов.
Фактически получилось 14 files из-за явного выноса shared port/error helpers,
отдельного direct adapter/test, exact provider JSON Schema и обязательных
task/index/state records. Это не расширило runtime behavior: schema, public
contract, policy и runtime selector не изменились.

## 4. Критерии успеха

- [x] Direct adapter принимает тот же `LiveV2GeneratorInput` и возвращает
  тот же provider-neutral candidate/observation contract.
- [x] Golden request совпадает по model, medium reasoning, `store:false`,
  max output, instructions, serialized turn/assets и strict object JSON Schema.
- [x] Caller cancellation и 15-second timeout прерывают один direct
  fetch; automatic retry отсутствует.
- [x] Unsafe/mismatched model identity, malformed output, HTTP/provider failure и
  raw canary завершаются fail-closed только sanitized category/observation.
- [x] Существующие Mastra, legacy direct, live-v2 orchestration,
  recorded runtime, queue/cancellation и runtime assembly tests остаются green.
- [x] Typecheck, production build, applicable architecture checks и `git diff --check`
  зелёные; исходный stale modular baseline остался `12/14`.

## 5. Стоп-гейты

- [ ] Архитектурная развилка / roadmap / ownership.
- [ ] Migration/schema БД или public contract.
- [ ] Prompt/tool/model-policy/privacy/send gate/takeover.
- [ ] Deploy/secrets/runtime config/платный вызов/другой repo.
- [x] Нового стоп-гейта нет.

Уже одобрено: Goal точно задаёт CONV-1 как parity-only direct
adapter без cutover, prompt/model/policy/schema/deploy и без provider call.

## 6. Выполнение

Фактически затронуты:

```text
.agents/state/granit-dev-workflow.json
apps/api/src/app-context.ts
apps/api/src/config.ts
apps/api/src/modules/ai/adapters/mastra-live-v2-decision-generator.ts
apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts
apps/api/src/modules/ai/adapters/openai-structured-response-client.ts
apps/api/src/modules/ai/ports/live-v2-runtime.ts
apps/api/src/modules/ai/profiles/live-v2/live-v2-validator.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/src/scripts/run-m3-mastra-smoke-once.ts
apps/api/src/widget-ai-runtime-assembly.ts
apps/api/test/openai-live-v2-decision-generator.test.ts
docs/tasks/AI_RUNTIME_CONVERGENCE_CONV_1_DIRECT_LIVE_V2_ADAPTER_RU.md
docs/tasks/README.md
```

Краткое решение:

- `ObservedLiveV2DecisionGenerator`, candidate/observation/error types, bounded request
  serialization, usage/identity sanitization и failure classification вынесены из
  Mastra adapter в app-owned provider-neutral port;
- Mastra adapter остался поведенческим comparator и сохранил
  compatibility exports;
- добавлен direct OpenAI Responses adapter с теми же `gpt-5.6-sol`,
  medium reasoning, instructions/input bounds, strict structured output, 15-second
  timeout, caller cancellation и без retry;
- shared Responses client сохранил legacy default `low`, но принял явный
  reasoning effort и возвращает только safe HTTP status без raw body/cause;
- provider JSON Schema материализован как root object, а app-owned Zod
  validation осталась authoritative;
- production/default assembly не создаёт direct adapter: это comparator seam,
  а не cutover CONV-2.

Соседние находки, не выполненные в этом diff:

- runtime mode и recorded service всё ещё названы `mastra_openai_api`; это cutover
  CONV-2 и cleanup CONV-3, не parity adapter CONV-1;
- actual assembly/cutover direct live-v2 остаётся CONV-2: в CONV-1
  намеренно нет production caller direct adapter, чтобы не изменять runtime.

## 7. Evidence

| Проверка | Результат | Примечание |
|---|---|---|
| Baseline targeted tests | `51/51` | Mastra adapter, direct golden, synthetic live-v2, runtime assembly, M2 recorded integration |
| Целевые тесты | `60/60` | baseline `51/51` + direct live-v2 `9/9`: exact request, cross-adapter parity, timeout/cancel/no-retry, explicit/missing identity, malformed output, HTTP sanitization |
| Полная applicable matrix | `161/161` | 13 suite: CONV-1 adapters/synthetic + PR2 queue/recorded/runtime matrix после identity repair |
| Real PostgreSQL | `39/39` | runtime `24/24`, migration reconciliation `5/5`, P2 observability `10/10`; disposable Testcontainers |
| Typecheck | green | bounded API source/packages и 56 test files; manager typecheck |
| Build | green | full typecheck + manager Vite production build, 2476 modules |
| Modular boundaries | baseline `12/14` | те же два stale assertions: запрет уже существующего live-v2/Mastra и требование старого `SENSITIVE_STRING`; новых failures нет |
| `git diff --check` | green | включая new files через intent-to-add |
| `git diff --stat` и file list | `14 files changed, 1158 insertions(+), 239 deletions(-)` | полный list в разделе 6; снимок после identity repair перед повторным review |

Непроверенные области: реальный OpenAI call, staging/production runtime
activation, external DB, deploy, secrets и production load.

Rollback до commit: удалить только CONV-1 diff. После accepted commit:
отдельный `git revert`; Mastra comparator и default runtime не меняются.

## 8. Независимая проверка

Свежий Reviewer должен выполнить Code Scout и проверить:

- [x] production/test callers обоих adapters и общего port;
- [x] exact request/schema/model/reasoning и provider identity;
- [x] cancellation, timeout, one-call/no-retry и error classification;
- [x] raw errors, response body, prompt, secrets и metadata не попадают в logs/persistence;
- [x] recorded service, commit fence, send gate и takeover не обойдены;
- [x] Mastra comparator/default runtime не переключены;
- [x] false-green tests, rollback и отсутствие external impact.

Первый свежий review: `needs_fix` (`medium`), модель `gpt-5.6-sol`, effort
`high`, session `019fcf28-751f-7aa3-84f7-b907ddb7f3f2`. Reviewer независимо
прошёл focused `59/59`, полный matrix `160/160`, PostgreSQL `39/39`,
typecheck/build и baseline `12/14`, но воспроизвёл false-green identity path:
shared Responses client подставлял requested model при отсутствии `body.model`,
после чего direct adapter принимал сконструированное имя как observed identity.

Второй свежий review после repair: `accept`; blocker/high/medium findings нет.
Reviewer независимо воспроизвёл missing-model fail-closed path, прошёл focused
`60/60`, полный matrix `161/161`, PostgreSQL `39/39`, config `35/35`,
typecheck/build и baseline `12/14`. Точный проверенный diff SHA-256 до и после
review совпал:
`d2adae764401ef765f09b703192f6e0540f3fa520f0480b4693c465b024229d7`.
Staged diff был пуст, пользовательский `output/share/*` не менялся.

Публикация: после `git fetch origin main` remote base остался
`d91558c5ef5047a312ea0dffb4648aa2dac42253`. Accepted-срез зафиксирован commit
`aff347bb00d07f8ee40f86203bd27a6a99b5b40f` (`AI convergence CONV-1: add
direct live-v2 adapter`) и опубликован обычным fast-forward push в
`origin/main`; итоговый remote `main` совпал с commit. Commit stat:
`14 files changed, 1172 insertions(+), 239 deletions(-)`. Force-push, deploy,
external DB и model call не выполнялись.

## 9. Repair

Подтверждённое замечание первого Reviewer:

- `medium`: ответ OpenAI без `body.model` не должен создавать trusted model
  observation из requested model.

Исправление в прежнем срезе:

- shared Responses client больше не подставляет requested model и fail-closed
  завершает malformed response до возврата candidate/observation;
- regression использует валидный candidate без `body.model` и требует
  sanitized `runtime_error` без observation, configured model и raw output.

## 10. Передача Goal

Изменение нужно, чтобы live-v2 не зависел от Mastra runtime перед
cutover и cleanup. Принятие требует зелёной матрицы и свежего
independent `accept`. После `accept` Goal автоматически переходит к
CONV-2, где действует отдельный output-contract stop-gate.

```text
Goal: AI-RUNTIME-CONVERGENCE
Текущий срез: CONV-1
Статус: accepted and published
Base/head SHA: d91558c5ef5047a312ea0dffb4648aa2dac42253 / aff347bb00d07f8ee40f86203bd27a6a99b5b40f
Результат: direct live-v2 adapter parity без runtime cutover
Изменённые области: provider-neutral port, Mastra comparator, direct Responses adapter/client, provider schema, tests/docs/state
Evidence: targeted 60/60; applicable matrix 161/161; PostgreSQL 39/39;
          typecheck/build/diff-check green; modular baseline 12/14 unchanged
Непроверено: external model/staging/production/deploy/load
Rollback: удалить CONV-1 diff; comparator/default runtime не меняются
Verdict: second fresh independent Reviewer accept; no blocker/high/medium findings
Следующий срез или stop-gate: CONV-2 output-contract owner stop-gate
```
