# План реализации: живой grounded-консультант Granit

Design: `docs/superpowers/specs/2026-07-17-grounded-live-widget-consultant-design.md`

Status: реализован локально; уточнения 2026-07-18 отражены в design amendment

Финальная реализация отличается от первоначальной разбивки в трех местах: claims и offsets ответа извлекает только verifier; `handoff` исполняется сразу без repair; shadow не блокирует legacy-ответ. Дополнительно появились flexible requirements, rolling memory и migration `0013_live_widget_memory_shadow.sql`.

## Цель

Заменить semantic policy-regex двухпроходным generator + verifier pipeline, добавить доказательства для slots, подготовить пустую границу будущего каталога, показать structured intake менеджеру и сделать исполняемый eval-loop. Внешний machine-readable каталог и адаптер к его формату не создаются.

## Срез 1. Grounded core contracts

Файлы:

- `apps/api/src/modules/ai/ai-dialog-contract.ts`
- `apps/api/src/modules/ai/ai-turn.ts`
- `apps/api/src/modules/ai/catalog/catalog-knowledge-port.ts`
- `apps/api/src/modules/ai/catalog/empty-catalog-knowledge-provider.ts`
- `apps/api/src/modules/ai/grounding/ai-slot-evidence-service.ts`
- `apps/api/src/modules/ai/grounding/ai-decision-validator.ts`
- `apps/api/src/modules/ai/verification/widget-ai-semantic-verifier.ts`
- `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`
- focused tests under `apps/api/test/`

Работа:

1. Ввести normalized `CatalogSnapshot`, `CatalogRecord`, `CatalogReference` и `CatalogKnowledgePort` без внешней JSON schema.
2. Реализовать `EmptyCatalogKnowledgeProvider` с постоянным version/hash и пустой выдачей.
3. Обновить typed decision: обязательный `AiSlotEvidence` для каждого extracted slot/requirement; claim spans вынести из generator decision в verifier result.
4. Проверять message ownership, quote и UTF-16 offsets в отдельном сервисе.
5. Перенести structural/source checks из intake service в один `AiDecisionValidator`.
6. Добавить typed verifier request/result и controlled violations.
7. Обновить prompt так, чтобы отсутствующее знание обрабатывалось честно, без раннего handoff.

Проверка:

- unit tests для empty catalog, exact evidence, конфликтов и invalid references;
- JSON schema/provider contract tests;
- `npm test -- apps/api/test/<focused files>`;
- `npm run typecheck`.

## Срез 2. Generator, verifier и bounded repair

Файлы:

- `apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts`
- `apps/api/src/modules/ai/adapters/openai-widget-semantic-verifier.ts`
- `apps/api/src/modules/ai/services/widget-ai-service.ts`
- новые bounded orchestration helpers в `apps/api/src/modules/ai/services/`
- `apps/api/src/app-context.ts`
- `apps/api/src/config.ts`
- provider/service tests

Работа:

1. Оставить generator свободный `replyText` и потребовать evidence для извлеченной клиентской памяти; фактические spans ответа независимо извлекает verifier.
2. Реализовать отдельный strict JSON-schema call для verifier.
3. Ввести общий turn deadline 18 секунд и один repair только при достаточном остатке времени.
4. Вердикт `handoff` немедленно преобразовывать в safe app-owned handoff; repair выполнять ровно один раз только для `repair`; `block` никогда не отправляет draft.
5. Добавить режимы `off`, `shadow`, `enforce`, verifier model/config и version metadata.
6. Удалить semantic pre-policy interception и output regex из нового enforce path.
7. Сохранить детерминированные gate/idempotency/schema/length checks.

Проверка:

- pass, repair, handoff, block, timeout и verifier-error tests;
- тест, что слова `документ` и `свяж` сами по себе не создают handoff;
- тест, что unsupported fact блокируется даже при пустых self-reported claims;
- provider request schema tests.

## Срез 3. Intake boundary и persistence

Файлы:

- `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts`
- `apps/api/src/modules/conversations/repositories/conversation-message-repository.ts`
- `apps/api/src/modules/conversations/repositories/public-intake-repository.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/test/helpers/memory-intake-repository.ts`
- `packages/db/migrations/0012_grounded_widget_ai.sql`
- `packages/db/src/schema.ts`
- integration tests

Работа:

1. Удалить legacy source evidence и semantic regex validation из intake use case.
2. Принимать только уже validated grounded decision из AI core.
3. Расширить slots evidence quote/start/end и хранить конфликты/версии без молчаливого overwrite manager value.
4. Расширить `ai_runs` verifier/generator/catalog identities и verdict metadata.
5. Добавить `ai_review_labels`, `ai_eval_cases`, `ai_eval_runs`.
6. Сохранить атомарный send-time gate, outbound, handoff, slots и run.
7. Verifier degradation не выключает AI навсегда, но создает manager-visible event/notification.

Проверка:

- migration/schema tests;
- persistence и replay/idempotency tests;
- stale takeover regression;
- verifier failure не теряет inbound;
- полный `public-intake.test.ts`.

## Срез 4. Structured intake для менеджера

Файлы:

- `apps/api/src/modules/conversations/repositories/manager-lead-repository.ts`
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`
- `apps/api/src/modules/manager-notifications/services/manager-notification-sender-service.ts`
- `apps/manager/src/types.ts`
- `apps/manager/src/display.ts`
- `apps/manager/src/App.tsx`
- API/manager/notification tests

Работа:

1. Добавить `structuredIntake` в `ManagerLeadDetail`.
2. Возвращать current slots, evidence, conflicts, missing fields, handoff reason и verifier verdict.
3. Показать карточку над диалогом с раскрытием evidence.
4. Добавить controlled review labels к конкретному `ai_run`.
5. Включить ключевые slots и summary в Telegram manager notification.

Проверка:

- manager API detail assertions;
- manager typecheck/build;
- notification text tests;
- отсутствие PII/provider secrets в техническом evidence.

## Срез 5. Исполняемые evals

Файлы:

- `apps/api/src/modules/ai/eval/widget-ai-regression-corpus.ts`
- `apps/api/src/modules/ai/eval/widget-ai-eval-runner.ts`
- `apps/api/src/scripts/run-widget-ai-evals.ts`
- `apps/api/test/widget-ai-eval.test.ts`
- `package.json`

Работа:

1. Заменить пустые baseline inputs реальными turn-by-turn диалогами.
2. Добавить 30–50 cases по grounding, slots, manager request, commercial boundaries, missing catalog, repair и degradation.
3. Запускать тот же generator + verifier pipeline.
4. Добавить opt-in `eval:widget-ai:live` с отчетом versions/latency/tokens/failures.
5. Оставить unit test runner полностью offline.

Проверка:

- offline corpus tests;
- live command dry-run/config validation;
- live eval только при наличии owner-provided credentials.

## Срез 6. Paired widget UX

Репозиторий: `/home/devuser/ai-projects/granit-site-cms`

Файлы:

- `apps/site/public/assets/js/main.js`
- при необходимости `apps/site/scripts/smoke-routes.mjs`

Работа:

1. Делать pending state зависимым от server-owned conversation state.
2. Не показывать AI-анимацию после `manager_pending`/`manager_active`.
3. Менять заголовок и status text по server state.
4. Отдельно показывать degraded turn без ложного handoff.
5. Синхронизировать frontend expectation с 18-second backend budget.

Проверка:

- Astro check/build;
- route smoke;
- focused state-transition smoke для `ai_active`, `manager_pending`, `manager_active`, degraded.

## Финальная проверка

1. `npm test` и `npm run typecheck` в `granit-operations`.
2. `npm run build` в `granit-operations`.
3. `npm run build` и `npm run smoke:site` в `granit-site-cms`.
4. Поиск подтверждает отсутствие semantic policy-regex в public send path.
5. Git diff review отдельно для каждого репозитория.
6. Live model eval отмечается как выполненный только при реальном вызове; иначе явно фиксируется как внешний verification step.

## Коммиты

Изменения группируются по смыслу: grounded contracts/core, persistence/manager, evals, paired widget UX. Production deploy, push и включение `enforce` не выполняются.
