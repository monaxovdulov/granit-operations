# granit-operations

Статус: рабочий `main` для backend operations и staging-кандидат website widget AI. Это не production approval.

Этот README — входная точка для следующего агента. Если задача звучит как “выкатить AI на staging”, “включить AI-агента в виджете”, “подключить каталог/RAG для ответов”, сначала читать этот файл, затем идти по индексу ниже.

## 1. Что это за репозиторий

`granit-operations` владеет операционной частью бизнеса:

- public intake API для формы и виджета сайта;
- Postgres operational state: leads, channel identities, conversations, messages, manager takeover, AI runs, AI quality events;
- manager backend и manager panel;
- app-owned website widget AI runtime;
- Telegram inbound / manager delivery path;
- CORS, migrations, smoke/evidence, evals and release docs.

Этот репозиторий не владеет текущим customer-facing лендингом.

## 2. Не перепутать репозитории

| Что | Источник истины сейчас |
|---|---|
| Operations backend, AI runtime, DB, manager, CORS | этот repo: `monaxovdulov/granit-operations` |
| Текущий customer-facing лендинг и browser widget/form integration | `monaxovdulov/landing-granit-static`, локально `/home/devuser/ai-projects/landing-granit-static` |
| Старый/отдельный Astro/CMS baseline | `granit-site-cms`; не использовать как текущий лендинг для AI/widget staging без новой ADR/task |

Решение зафиксировано в [ADR-011](docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md).

Перед staging smoke агент обязан перепроверить актуальную ветку и SHA `landing-granit-static`, а не полагаться на исторические упоминания `granit-site-cms`.

## 3. Текущее состояние AI в `main`

В `main` уже есть app-owned website widget AI runtime на durable PostgreSQL
очереди:

```text
PublicWidgetIntakeService
  -> сохраняет inbound и durable job в Postgres
  -> supersede/coalescing для устаревших pending jobs
  -> WidgetAiJobWorker claim-ит актуальный response window
  -> fresh assembler читает текущее состояние разговора
  -> direct OpenAI boundary по умолчанию
  -> app-owned validator / send gate / manager takeover
  -> атомарно сохраняет outbound и terminal job state
  -> пишет ai_runs / ai_quality_events
  -> показывает менеджеру sanitized quality summary
```

Важно:

- AI для website widget по умолчанию выключен: `AI_WIDGET_ENABLED=false` или env отсутствует.
- Когда `AI_WIDGET_ENABLED=true`, режим задаёт `AI_WIDGET_GROUNDED_MODE`.
- Допустимые режимы: `off`, `shadow`, `enforce`.
- Отсутствующий, пустой или неизвестный `AI_WIDGET_GROUNDED_MODE` трактуется как `off`; неизвестное значение также пишет sanitized startup error без самого env value. Для customer-visible grounded AI режим `shadow` или `enforce` должен быть задан явно.
- OpenAI ключ — только server-side: `OPENAI_API_KEY`; он не должен попасть в лендинг, frontend, docs или логи.
- Primary runtime и orchestration принадлежат приложению: PostgreSQL queue,
  fresh context, validation, commit fence и send gate.
- `direct_openai` является runtime mode по умолчанию. Существующий
  `mastra_openai_api` разрешён только как bounded staging adapter и не владеет
  очередью, business state, send gate или roadmap.
- Актуальное owner-решение об источниках истины и роли runtime зафиксировано в
  [ADR-012](docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md).

## 4. Текущее состояние знаний / RAG

Каталог подключён как детерминированный versioned snapshot из проверенных артефактов `pdf-analiz`. Runtime не читает HTML и не использует память модели как источник бизнес-фактов.

Смотреть код:

- `apps/api/src/modules/ai/catalog/catalog-knowledge-port.ts` — app-owned `CatalogKnowledgePort`;
- `apps/api/src/modules/ai/catalog/file-catalog-knowledge-provider.ts` — production-shaped in-process provider с published-only retrieval;
- `apps/api/src/modules/ai/catalog/snapshots/catalog-knowledge.v1.json` — воспроизводимый snapshot с version/content hash;
- `apps/api/src/scripts/build-catalog-knowledge.ts` — детерминированная сборка snapshot из reviewed JSON/JSONL;
- `apps/api/src/modules/ai/services/grounded-widget-ai-service.ts` — где runtime запрашивает snapshot/search и передаёт selected catalog records в prompt/verifier;
- `apps/api/src/app-context.ts` — сборка AI runtime принимает `catalog?: CatalogKnowledgePort`;
- `apps/api/src/index.ts` — server assembly передаёт `FileCatalogKnowledgeProvider`; `empty.v1` остаётся только явным безопасным fallback для изолированных тестов/rollback-кода.

Текущий snapshot: `granit-cha.catalog.2026-07-20.v1`, 481 запись (465 published, 16 draft по `review.required=true`). Коммерческие условия по-прежнему можно отвечать только при наличии отдельной явной published-записи; их отсутствие означает честное ограничение или передачу менеджеру.

HTML сайта не является автоматическим источником истины. Если данные берутся из сайта, их надо превратить в reviewed catalog records с `id`, `revision`, `status`, `validFrom/validUntil` при необходимости, provenance and owner approval.

## 5. Индекс: куда идти следующему агенту

Для AI-задач читать в таком порядке:

1. [Этот README](README.md) — текущая карта и маршрут.
2. [source-of-truth.md](docs/source-of-truth.md) — repo-local hierarchy, runtime и boundaries.
3. [ADR-012](docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md) — owner-решение: code-first facts, app-owned queue, direct runtime и roadmap `PR0a-PR9`.
4. [AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md](docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md) — подробный актуальный план.
5. [AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md](docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md) — порядок срезов `PR0a-PR9`.
6. Текущая карточка среза из `docs/tasks/AI_REF_*.md` и её exact-SHA evidence.
7. [ADR-011](docs/adr/ADR-011-CUSTOMER_FACING_LANDING_SOURCE_RU.md) — настоящий лендинг: `landing-granit-static`.
8. [ENVIRONMENT.md](docs/ENVIRONMENT.md) — env names без secret values.
9. [SMOKE_TESTS.md](docs/SMOKE_TESTS.md) — smoke expectations.
10. [BACKUP_RESTORE_ROLLBACK.md](docs/BACKUP_RESTORE_ROLLBACK.md) и [STAGING_GO_LIVE_READINESS_RU.md](docs/tasks/STAGING_GO_LIVE_READINESS_RU.md) — staging safety gates.
11. [release evidence index](docs/release/evidence/README.md) — куда писать новую evidence после smoke.

Исторический план [SERIOUS_AI_LAYER_RU.md](docs/tasks/SERIOUS_AI_LAYER_RU.md) можно читать как background, но он не является актуальным статусом runtime.

## 6. Маршрут выполнения: staging AI + catalog/RAG

Следующий агент должен идти небольшими проверяемыми шагами.

### Шаг 0. Read-only audit

Минимум:

```bash
git status -sb
git rev-parse HEAD
git rev-parse origin/main
git -C /home/devuser/ai-projects/landing-granit-static status -sb
git -C /home/devuser/ai-projects/landing-granit-static rev-parse HEAD
```

Если `main` изменился, использовать актуальное состояние.

### Шаг 1. Локальная проверка `granit-operations`

Перед staging-действиями:

```bash
npx vitest run --maxWorkers=1
npm run build
npm run eval:widget-ai:dry-run
git diff --check
```

Если добавляются DB changes для catalog/RAG или observability, новая migration должна идти после уже существующих `0014` и `0015`, то есть начинать с `0016_*`. Старые альтернативные Mastra migrations `0010/0011` не переносить.

### Шаг 2. Подключить catalog/RAG правильно

Нельзя делать RAG так, чтобы модель сама считала HTML/веб/память модели источником бизнес-истины.

Правильная граница:

```text
owner-reviewed catalog source
  -> app-owned CatalogKnowledgePort
  -> selected records with id/revision/status/provenance
  -> grounded prompt
  -> semantic verifier checks every business claim
  -> send-time gate
  -> persisted safe answer
```

Минимальный implementation target:

- provider реализует `CatalogKnowledgePort`;
- `getSnapshot()` возвращает version/hash/schema;
- `search()` возвращает только опубликованные и применимые records;
- records имеют стабильные `id`, `revision`, `kind`, `status`, `aliases`, `searchText`, `qualifiers`, `data`;
- verifier получает catalog references и блокирует claims без подтверждения;
- eval corpus содержит cases по missing catalog, invalid reference, price/deadline/warranty/availability, manager handoff.

### Шаг 3. Staging enablement

Это уже внешняя runtime-операция, не docs-only изменение. Перед ней нужны явные staging credentials / server access и owner-approved scope.

Env names смотреть в [ENVIRONMENT.md](docs/ENVIRONMENT.md). Значения секретов не записывать в repo, chat, PR, evidence или логи.

Ключевые env для website widget AI staging:

- `DATABASE_URL`
- `PUBLIC_INTAKE_ALLOWED_ORIGINS` — точные origin лендинга, без wildcard;
- `AI_WIDGET_ENABLED=true`
- `AI_WIDGET_GROUNDED_MODE=enforce` для customer-visible grounded ответов;
- `AI_WIDGET_GROUNDED_MODE=off` или `AI_WIDGET_ENABLED=false` как rollback;
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_VERIFIER_MODEL`
- `AI_WIDGET_GENERATOR_TIMEOUT_MS`
- `AI_WIDGET_VERIFIER_TIMEOUT_MS`
- `AI_WIDGET_DEADLINE_MS`
- `AI_WIDGET_JOB_WORKER_ENABLED` (default `false`; enable for `site_widget.v2` processing)
- `AI_WIDGET_JOB_POLL_INTERVAL_MS`
- `AI_WIDGET_JOB_LEASE_MS`
- `AI_WIDGET_JOB_RETRY_BACKOFF_MS`
- `AI_WIDGET_JOB_MAX_ATTEMPTS`

Для первого preflight можно использовать `shadow`, но customer-visible grounded AI надо проверять именно в `enforce`.

### Шаг 4. Paired smoke с настоящим лендингом

Paired smoke делать с `landing-granit-static`, а не с `granit-site-cms`.

Проверить:

- browser widget отправляет запрос в staging `granit-operations`;
- CORS разрешает exact origin лендинга;
- inbound message сохраняется до AI;
- public response не содержит internal ids/traces/eval labels;
- AI disclosure показывается;
- AI ответ сохраняется как outbound message до ответа виджету;
- manager видит lead/conversation/message, slots/requirements/evidence, handoff/takeover state и safe quality summary;
- manager takeover блокирует следующий AI reply;
- fallback при provider/verifier/catalog ошибке не теряет inbound;
- RAG answer содержит только подтверждённые catalog claims;
- price/deadline/warranty/availability/final commercial terms уходят в safe limitation/handoff, если catalog не подтверждает точное условие.

### Шаг 5. Evidence

После staging smoke создать новый файл в `docs/release/evidence/` на базе [TEMPLATE_RU.md](docs/release/evidence/TEMPLATE_RU.md).

Evidence должна содержать:

- ветку/SHA `granit-operations`;
- ветку/SHA `landing-granit-static`;
- какие migrations применены на staging;
- env names без values;
- smoke commands/results;
- sanitized request/response summary без PII/secrets;
- manager-visible result;
- rollback switch;
- что осталось blocked.

## 7. Что запрещено без отдельного явного разрешения

- production deploy;
- production migrations;
- изменение secrets или production config;
- broad CORS wildcard;
- отправка `OPENAI_API_KEY` или DB credentials в frontend;
- Telegram AI outbound;
- Mastra как primary runtime/orchestrator;
- удаление или переписывание release worktrees под `/srv/botops/releases/operations/`;
- использование `granit-site-cms` как текущего landing smoke target без новой ADR/task;
- выдавать исторические staging evidence за доказательство текущего runtime.

## 8. Быстрые команды

Основные проверки:

```bash
npx vitest run --maxWorkers=1
npm run build
npm run eval:widget-ai:dry-run
git diff --check
```

Запуск API локально:

```bash
npm run dev:api
```

Live eval требует явного разрешения платных model calls:

```bash
AI_WIDGET_EVAL_LIVE=true npm run eval:widget-ai:live
```

Не запускать live eval без `OPENAI_API_KEY` и явного понимания, что это внешний платный вызов.
