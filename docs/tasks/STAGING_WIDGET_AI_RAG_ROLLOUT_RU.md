# Task: STAGING-WIDGET-AI-RAG-ROLLOUT - Staging-включение website widget AI и catalog/RAG

Status: ready_for_next_agent; docs-only guidance, runtime actions not performed
Created: 2026-07-20
Repo: `granit-operations`
Slice: customer-facing staging widget AI after grounded runtime reconciliation
Owner/agent: owner request + next deployment/RAG agent

## Цель

Дать следующему агенту безопасный маршрут для задачи:

```text
deploy current granit-operations main to staging
  -> enable website widget AI on staging
  -> connect owner-approved catalog/RAG knowledge layer
  -> pair-smoke with landing-granit-static
  -> record evidence
```

Этот документ не выполняет deploy, не применяет staging/production migrations, не меняет env/secrets и не включает customer traffic сам по себе.

## Текущий Факт

- `main` содержит app-owned grounded website widget AI runtime.
- Primary runtime: `PublicWidgetIntakeService -> PublicWidgetAiReplyGenerator -> GroundedWidgetAiService -> semantic verifier -> send-time gate -> Postgres`.
- `ai_runs`, `ai_quality_events`, manager controls and manager-visible safe summaries уже находятся в app-owned boundary.
- Website widget AI по умолчанию выключен через env.
- `CatalogKnowledgePort` существует, но server assembly пока не передаёт реальный catalog provider, поэтому grounded runtime использует `EmptyCatalogKnowledgeProvider` / `empty.v1`.
- Текущий customer-facing лендинг: `monaxovdulov/landing-granit-static`, локально `/home/devuser/ai-projects/landing-granit-static`.
- `granit-site-cms` не является текущим landing smoke target.
- Mastra не является runtime. Mastra-like observability возможна только как optional sink/export layer после отдельного решения.

## In Scope Для Следующего Агента

Если владелец явно просит выполнить staging rollout:

- read-only audit текущего `main`, staging host/worktree and `landing-granit-static`;
- локальные checks перед staging;
- deploy текущего `granit-operations` candidate на staging;
- применение только staging migrations, если они требуются и входят в approved staging scope;
- настройка staging env names без записи значений в repo/evidence;
- implementation PR для catalog/RAG provider behind `CatalogKnowledgePort`;
- paired smoke с `landing-granit-static`;
- release evidence без secrets/PII.

## Out Of Scope Без Отдельного Разрешения

- production deploy или production migrations;
- изменение production config/secrets;
- wildcard CORS;
- Telegram AI outbound;
- Mastra/live-v2 как primary orchestration;
- raw provider traces/prompts в manager payload или long-retention storage;
- удаление release worktrees под `/srv/botops/releases/operations/`;
- использование `granit-site-cms` как текущего лендинга;
- выдача старой evidence за текущий staging proof.

## Read First

1. `README.md`
2. `docs/source-of-truth.md`
3. `docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md`
4. `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md`
5. `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md`
6. `docs/ENVIRONMENT.md`
7. `docs/SMOKE_TESTS.md`
8. `docs/AI_ASSISTANT_OWNER_ARCHITECTURE_GUIDE_RU.md`
9. `docs/AI_ASSISTANT_OWNER_INPUT_GUIDE_RU.md`
10. `docs/BACKUP_RESTORE_ROLLBACK.md`
11. `docs/tasks/STAGING_GO_LIVE_READINESS_RU.md`

## Code Entry Points

| Purpose | Path |
|---|---|
| API runtime assembly | `apps/api/src/index.ts` |
| App context / AI wiring | `apps/api/src/app-context.ts` |
| Public widget intake sequencing | `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts` |
| AI reply generator port | `apps/api/src/modules/intake/ports/public-widget-ai-reply-generator.ts` |
| Grounded AI service | `apps/api/src/modules/ai/services/grounded-widget-ai-service.ts` |
| Catalog port | `apps/api/src/modules/ai/catalog/catalog-knowledge-port.ts` |
| Current empty catalog fallback | `apps/api/src/modules/ai/catalog/empty-catalog-knowledge-provider.ts` |
| Prompt with catalog records | `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts` |
| Semantic verifier | `apps/api/src/modules/ai/verification/widget-ai-semantic-verifier.ts` |
| Eval corpus | `apps/api/src/modules/ai/eval/widget-ai-regression-corpus.ts` |
| Env names | `docs/ENVIRONMENT.md` |

## Ordered Work

### 1. Audit

Run:

```bash
git status -sb
git rev-parse HEAD
git rev-parse origin/main
git log --oneline -5
git -C /home/devuser/ai-projects/landing-granit-static status -sb
git -C /home/devuser/ai-projects/landing-granit-static rev-parse HEAD
```

If SHA or branches changed, use actual state and record it in evidence.

### 2. Local Checks Before Staging

Run from `granit-operations`:

```bash
npx vitest run --maxWorkers=1
npm run build
npm run eval:widget-ai:dry-run
git diff --check
```

If catalog/RAG code changes include DB schema, also run a migration/schema smoke. New migrations must start at `0016_*` unless `main` has advanced further.

### 3. Catalog/RAG Implementation

Implement catalog/RAG behind `CatalogKnowledgePort`.

Minimum requirements:

- catalog snapshot has schema version, catalog version, content hash and creation time;
- each record has stable `id`, `revision`, `kind`, `status`, aliases/search text, qualifiers and data;
- only `published` and currently valid records can be used for customer answers;
- `draft`, `retired`, expired or invalid records are ignored or blocked;
- price/deadline/warranty/availability/final commercial terms require explicit catalog support or safe handoff/limitation;
- verifier must reject unsupported facts and invalid catalog references;
- app-owned send gate and manager takeover remain final authority.

Do not make the model browse/scrape the site at answer time. Do not make HTML the source of truth without reviewed catalog conversion.

### 4. Staging Enablement

Only with explicit staging authority:

- deploy the current candidate to staging;
- apply approved staging migrations only;
- configure env values outside git/docs;
- set exact `PUBLIC_INTAKE_ALLOWED_ORIGINS` for the active landing origin;
- set `AI_WIDGET_ENABLED=true`;
- set `AI_WIDGET_GROUNDED_MODE=enforce` for customer-visible grounded AI;
- use `AI_WIDGET_GROUNDED_MODE=off` or `AI_WIDGET_ENABLED=false` as rollback;
- keep `TELEGRAM_BOT_ENABLED` and Telegram AI outbound out of scope unless separately approved.

### 5. Paired Smoke

Use `landing-granit-static`.

Smoke checklist:

- browser request reaches staging operations API;
- CORS accepts exact origin and rejects unrelated origin;
- inbound widget message persists before AI;
- public response is safe and has no internal ids/traces/eval labels;
- AI disclosure is visible;
- AI reply persists before being returned to the widget;
- manager can see conversation, messages, extracted fields/evidence and quality summary;
- takeover blocks subsequent AI reply;
- provider/verifier/catalog error still preserves inbound and returns safe fallback;
- RAG answer cites only allowed catalog-backed facts;
- unsupported price/deadline/warranty/availability/final terms do not get invented.

### 6. Evidence

Create a new evidence file under `docs/release/evidence/` using `docs/release/evidence/TEMPLATE_RU.md`.

Record:

- `granit-operations` branch/SHA;
- `landing-granit-static` branch/SHA;
- staging migration status;
- env names only, no values;
- checks and smoke results;
- sanitized customer-visible response summary;
- manager-visible result;
- rollback switch used/tested;
- remaining blocked items.

## Acceptance Criteria

- README remains the clear Russian entrypoint for the next agent.
- Staging AI enablement uses current `main`, not old Mastra/live-v2 branches.
- Catalog/RAG uses `CatalogKnowledgePort`, not model memory or direct HTML scraping.
- Paired smoke uses `landing-granit-static`, not `granit-site-cms`.
- All required checks pass or failures are recorded with exact blockers.
- Evidence is current, sanitized and does not reuse old staging proof as if it were fresh.

## Checks For This Docs Task

This document itself is docs-only. Required check:

```bash
git diff --check
```

Runtime checks are required only for the later implementation/deploy/RAG task.

## Staging deployment update — 2026-08-18

Владелец явно поручил без отдельного regression-smoke развернуть на staging
актуальный audit snapshot и оставить ручную проверку ему.

- `granit-operations@d3ce2908faeb2905c54e635cf5b00925296eed3a`
  развернут вместо `b72d526a1ac166afd800b79f3315ac4d3e14657f`;
- применены принятые миграции `0017`—`0022` и восстановлен отсутствовавший в
  `public` экземпляр принятого gate из `0014`;
- старый Mastra selector удалён из staging compose, активен единый direct
  runtime с закреплённой моделью `gpt-5.6-luna`;
- live preview уже использовал новый каталог
  `landing-granit-static@b990f16bb9443979d83ac32df96b56a871e341b9`
  и widget `1.1.4@c44f99637e097a47b3c53099c95d7e8e01701ad8`;
- health, exact-origin CORS и отсутствие worker errors после исправления
  staging schema drift подтверждены; платный/model и mutation smoke по прямому
  указанию владельца не выполнялся.

Первый реальный owner POST после rollout вернул `503`: canonical `public`
содержал новые `widget_ai_jobs`/`ai_runs`, но исторические вспомогательные
`conversation_slots` и `conversation_requirements` остались только в
`grounded`. Исправление не меняло код или данные: search path установлен в
`public,grounded`, поэтому новые canonical таблицы имеют приоритет, а
сохранившиеся support tables доступны как fallback. После recreate resolution
обоих наборов таблиц и startup logs проверены; исходный отклонённый POST нужно
повторить из widget.

Существенная непроверенная граница: текущий audit runtime использует
owner-approved статический 15-фактный snapshot из исторического
`granit-site-cms@23f2ee8...`, а не RAG/snapshot нового каталога от 2026-08-16.
Это implementation gap, не deployment gap. Точная операционная запись и rollback
находятся в `docs/release/evidence/AUDIT_STAGING_DEPLOY_20260818_RU.md`.

## Текущий срез — invalid candidate repair, 2026-08-18

Статус: `technical_done`, ожидает fresh independent review; active
AI-RUNTIME-CONVERGENCE Goal и её accepted CONV-5 card не переоткрываются.

Один результат: фраза посетителя «Здравствуйте, у меня есть вопрос по заказу»
и эквивалентный безопасный ход получают один уточняющий AI-ответ, а не manager
fallback из-за дублированного вопроса в structured model output.

Baseline:

- `HEAD == origin/main == 2122ce143129492797514bb73bdf4a1069e273a2`;
- пользовательский untracked `output/` не читается и не изменяется;
- два live staging run завершились `candidate_invalid` после успешного вызова
  `gpt-5.6-luna`; send gate не запускался;
- provider response хранится с `store:false`, поэтому raw candidate исходного
  run отсутствует по принятой privacy policy;
- ограниченный диагностический вызов воспроизвёл корень: Luna повторила один
  вопрос в `answerText` со строчной буквы и в отдельном `question.text` с
  прописной; byte-exact suffix repair не удалил дубликат и вернул
  `duplicate_question`.

Точный allowlist среза:

- `apps/api/src/modules/ai/profiles/live-v2/model-turn-validator.ts`;
- `apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts`;
- целевые tests этих путей;
- `tooling/ai-architecture-contract.json` только для reviewed runtime closure
  hash после production diff;
- эта task card, sanitized release evidence и machine state.

Вне области: public contract, DB schema/migrations, model/reasoning, catalog/RAG,
manager takeover/send gate, production, Telegram и `output/`.

Критерии:

- case/punctuation-equivalent duplicate question canonicalizes to one question;
- второй самостоятельный вопрос всё ещё отклоняется;
- known-slot, unsafe claim, tone и repeated-reply guards не ослаблены;
- failed validation span сохраняет конкретный allowlisted diagnostic code без
  raw output, prompt или PII;
- focused tests, typecheck/build, architecture guard и diff check проходят;
- после fresh independent review commit публикуется и разворачивается только на
  staging, где live smoke получает persisted AI reply.

Разрешения: владелец явно поручил системно исправить AI validation defect; ранее
он поручил commit/push/merge и staging deploy текущего audit-кандидата. Один
минимальный live staging smoke/model call входит в проверку. Новые migration,
public contract и production не разрешены и не требуются.

Rollback: предыдущий staging backend image/SHA; DB rollback не нужен.

Executor evidence:
`docs/release/evidence/STAGING_WIDGET_AI_INVALID_CANDIDATE_FIX_20260818_RU.md`.

Technical runtime commit:
`1eb99c36b35bd7f40171964e73fd5ec9e91f073e` на base
`2122ce143129492797514bb73bdf4a1069e273a2`.
