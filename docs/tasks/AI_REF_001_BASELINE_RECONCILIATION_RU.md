# Срез AI-рефакторинга: AI-REF-001 — Сверка противоречивого AI-baseline

Статус: `teaching_deferred`

Создан: 2026-07-31

Репозиторий: `granit-operations`

Владелец: владелец проекта

Ветка: `codex/ai-refactor-agent-governance-design`

Наблюдавшийся HEAD: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`

Предлагаемый исходный SHA следующего запуска:
`origin/main@3ead589a8975944000d14e0cdb25c480afa73bcc`

Текущий SHA: `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`

Дерево HEAD и `origin/main` одинаково:
`d7c772b701e2c047298352e87eb2ad1c2ec6402c`.

Примечание о запуске Архитектора: требуемая роль Архитектора предполагает
GPT-5.6 Sol `medium`. Точная модель архитектурного запуска не была подтверждена.
Владелец дважды поручил продолжить после предупреждения и затем одобрил вариант A
и область среза.

Примечание о запуске Исполнителя 2026-08-02: требуемая роль Исполнителя
предполагает GPT-5.5 `xhigh`. Точная модель текущей среды не была подтверждена.
После предупреждения владелец подтвердил продолжение на текущей модели. Это
зафиксировано как отклонение; рабочий код не изменялся.

Решение владельца 2026-08-03 UTC: прежний `lazy_teach_back` заменён единым
минимальным Goal-контуром. AI-REF-001 сохраняет технический `accept`, а его
понимание проверяется в общем Teach-back после roadmap. Это решение не
разрешает commit/push/merge/deploy само по себе.

Допустимые статусы:

```text
baseline_checked
slice_proposed
scope_approved
implementing
technical_done
code_scout_done
independent_review
needs_fix
repairing
needs_evidence
needs_redesign
needs_human_decision
accept
teaching
teaching_paused
teaching_deferred
understanding_verified
stopped
```

Режим: одна Goal `AI-LIVE-REF-ROADMAP`.

- thread ID: `019fc912-6005-73f2-ba46-ccb40eb26334`;
- одновременно изменяется один срез;
- после независимого `accept` Goal автоматически переходит к следующему
  заранее записанному срезу;
- старый четырёхсрезовый `AI-LIVE-REF-FOUNDATION` больше не ограничивает
  roadmap и остаётся исторической записью.

Утверждённый порядок Goal:

1. PR 0a — настоящий PostgreSQL test harness;
2. PR 0b — canonical AI schema/migration reconciliation;
3. PR 0c — короткие hotfix-ы;
4. PR 1 — `message_sequence`, `generation_epoch` и commit fence;
5. PR 2 — latest-wins и fresh context;
6. PR 3 — `ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn`;
7. PR 4 — state patches, corrections и retractions;
8. PR 5 — bounded tools и retrieval v2;
9. PR 6 — risk-only verifier;
10. PR 7 — sticky runtime и read-only shadow;
11. PR 8 — observability и handoff UX;
12. PR 9 — structural cleanup.

Общий checklist понимания Goal:

- [ ] PR 0a: владелец объяснил, какие реальные PostgreSQL race/lease evidence
  получены и почему memory tests их не заменяют.
- [ ] PR 0c: владелец назвал исправленные hotfix-сценарии и границу, за которой
  начинается архитектурное изменение.
- [ ] PR 1: владелец объяснил identity поколения, invalidating events и условие
  commit fence.
- [ ] PR 2: владелец разобрал latest-wins, fresh context, burst и takeover во
  время генерации.
- [ ] PR 3–PR 9: владелец объяснил контракт хода, память, tools/retrieval,
  verifier, rollout, observability и границу structural cleanup.
- [ ] Общий результат: владелец назвал сквозные доказательства, непроверенные
  области, rollback и сигнал, который опроверг бы корректность Goal.

Условие окончания: независимый `accept` каждого среза, затем один общий Учитель
и `understanding_verified`. Goal можно остановить отдельной командой владельца;
тогда следующий срез автоматически не начинается.

## 1. Один ожидаемый результат

На одном закреплённом SHA существует проверяемая и одобренная владельцем карта
текущего AI-слоя, которая:

- называет один основной runtime;
- отделяет его от optional, legacy и противоречащих путей;
- фиксирует красные baseline-проверки и дубли миграций;
- определяет один следующий технический срез;
- не меняет рабочий код и не реализует runtime v2.

## 2. Почему этот срез нужен

Проблема:

- код одновременно содержит grounded, legacy, shadow и Mastra/live-v2 пути;
- accepted ADR-010 называет app-owned grounded runtime основным, а canonical
  wiki всё ещё описывает Mastra-based workflow;
- архитектурный тест запрещает Mastra/live-v2 в primary assembly, но текущий
  код этот тест не проходит;
- сфокусированный baseline имеет 9 падающих тестов;
- миграции `0010`, `0011` и `0012` имеют дубли номеров;
- `0016_widget_ai_jobs.sql` уже существует;
- job сохраняет полный `AiTurnInput`, поэтому во время выполнения использует
  старый снимок разговора;
- последние owner-review документы ещё не входят ни в один git SHA.

Почему это возникло:

- несколько исторических AI-веток и решений были частично объединены;
- runtime продолжил развиваться после ADR-010;
- исторические task/evidence документы сохранили статусы старых срезов;
- тестовые ожидания и фактический runtime изменялись неатомарно;
- новая owner-spec была подготовлена по статическому архиву, а затем уточнена
  более поздним итоговым ревью.

Почему её нельзя безопасно оставить как есть:

- новый runtime v2 нельзя строить поверх baseline, где не определён единственный
  основной runtime;
- красные архитектурные тесты не позволяют использовать текущий SHA как
  воспроизводимую точку до изменений;
- миграция, добавленная без сверки истории, может конфликтовать с уже
  применённой схемой;
- исправление stale replies затрагивает send gate, manager takeover,
  idempotency, lease и транзакционную запись.

## 3. Исходное состояние

| Проверка | Факт |
|---|---|
| `git status --short --branch` | Ветка `codex/ai-refactor-agent-governance-design`; tracked diff пустой; untracked: три architecture docs, этот task document и существующий `output/`. |
| Наблюдавшийся HEAD | `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`. |
| Локальный `origin/main` | `3ead589a8975944000d14e0cdb25c480afa73bcc`; на один merge-коммит впереди HEAD. |
| Сравнение деревьев | `git diff --quiet HEAD origin/main` вернул `0`; tree SHA одинаковый. |
| Незавершённые пользовательские изменения | `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`, `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`, `docs/architecture/CODEX_SDK_PREFECT_GATED_REFACTOR_PIPELINE_RU.md`, этот task document и `output/`; не изменять и не удалять. Pipeline document здесь является только dirty inventory, а не утверждённым source of truth AI-REF-001. |
| Machine state | `.agents/state/granit-dev-workflow.json` устарел: `updated_at=2026-07-22`, `git_head=a475f1c`, другая задача. Не использовать как текущую истину. |
| Действующий grounded путь | `app-context.ts -> GroundedWidgetAiService` при `groundedMode=enforce`. |
| Legacy/shadow путь | `WidgetAiService` остаётся legacy generator; `ShadowWidgetAiReplyGenerator` возвращает legacy и параллельно наблюдает grounded. |
| Mastra/live-v2 путь | В коде присутствуют `mastra_openai_api`, `widget-ai-runtime-assembly.ts`, Mastra adapter, live-v2 profiles/services/scripts, но production `PostgresIntakeRepository` не предоставляет recorded reply/gate capabilities, обязательные для этого executor. |
| `site_widget.v1` путь | Synchronous HTTP path: inbound сохраняется, после чего AI исполняется в request path; `widget_ai_jobs` не создаётся. |
| `site_widget.v2` путь | Durable ack/history path: job создаётся только при `aiCanRun`; HTTP сразу возвращает ack, дальнейшая обработка зависит от `WidgetAiJobWorker`. |
| Intake/job snapshot | В `widget_ai_jobs.input_payload` записывается полный `AiTurnInput`; worker позже использует его без fresh assembly. |
| Claimed job context | `ClaimedSiteWidgetAiJob` содержит `AiTurnInput`, но не `AiTurnExecutionContext`; queued recorded path не может восстановить обязательный execution context. |
| Worker startup | `AI_WIDGET_JOB_WORKER_ENABLED` по умолчанию `false`; worker запускается только при `true` и не запускается для `mastra_openai_api`. |
| Внешний consumer | Read-only проверка `landing-granit-static@628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8` подтвердила, что текущий vendored widget отправляет `site_widget.v2` и опрашивает `site_widget.history.v2`; другой репозиторий не изменялся. |
| Send gate | Проверяет `agent_allowed_to_reply=true` и global runtime control, но не проверяет latest inbound, generation epoch, job lease/claim version или conversation revision. |
| Job ordering | Старый pending/processing/retrying job блокирует claim более нового job той же conversation. |
| Worker concurrency | Один `WidgetAiJobWorker` в API-процессе; `run()` последовательно вызывает один `runOnce()`. |
| Миграции | Дубли номеров `0010`, `0011`, `0012`; максимальный текущий номер `0016_widget_ai_jobs.sql`. |
| Focused tests | 95 тестов: 86 passed, 9 failed; failed files: `public-intake.test.ts` и `modular-boundaries.test.ts`. |
| Typecheck | `npm run typecheck` passed. |
| PostgreSQL race evidence | Не запускалось: `P2_TEST_DATABASE_URL` отсутствует. |

### 3.1. Карта фактических AI-путей

Поддерживаются две разные версии public widget contract. Их нельзя объединять
в один job path.

```text
site_widget.v1 synchronous HTTP path
  -> POST /public/intake/site-widget/messages
  -> AnySiteWidgetMessageRequestSchema accepts site_widget.v1
  -> PublicWidgetIntakeService.acceptSiteWidgetMessage
  -> PostgresIntakeRepository.acceptInboundMessage
  -> persist inbound + build AiTurnInput + build AiTurnExecutionContext
  -> PublicWidgetIntakeService.processAcceptedSiteWidgetMessage(saved)
  -> PublicWidgetAiReplyGenerator or recorded turn executor if available
  -> persistAiReplyWithSendGate
  -> outbound + slots + requirements + AI evidence before HTTP response
```

```text
site_widget.v2 durable ack + history polling path
  -> POST /public/intake/site-widget/messages
  -> AnySiteWidgetMessageRequestSchema accepts site_widget.v2
  -> PublicWidgetIntakeService.acceptSiteWidgetMessage
  -> PostgresIntakeRepository.acceptInboundMessage
  -> persist inbound + build AiTurnInput + build AiTurnExecutionContext
  -> if aiCanRun: widget_ai_jobs.input_payload stores AiTurnInput only
  -> HTTP 202 show_widget_saved
  -> if job exists: automation.status=processing + next_step=poll_history
  -> WidgetAiJobWorker only when AI_WIDGET_JOB_WORKER_ENABLED=true
     and runtimeMode != mastra_openai_api
  -> claim returns AiTurnInput without AiTurnExecutionContext
  -> PublicWidgetIntakeService.processClaimedSiteWidgetAiJob
  -> processAcceptedSiteWidgetMessage(reconstructed saved object)
  -> generator / turn executor
  -> persistAiReplyWithSendGate
  -> history endpoint returns site_widget.history.v2
```

Runtime branches found in assembly:

```text
AI_RUNTIME_MODE=direct_openai + groundedMode=enforce
  -> GroundedWidgetAiService
  -> app-owned grounded generator/verifier path

AI_RUNTIME_MODE=direct_openai + groundedMode=shadow
  -> WidgetAiService result
  -> GroundedWidgetAiService observation in background

AI_RUNTIME_MODE=direct_openai + groundedMode=off
  -> WidgetAiService legacy path

AI_RUNTIME_MODE=mastra_openai_api
  -> separate recorded/live-v2 assembly candidate
  -> requires RecordedSiteWidgetAiReplyRepository
  -> live-v2 additionally requires RecordedSiteWidgetAiGateRepository
  -> production Postgres wiring does not provide those capabilities
  -> worker startup excludes mastra_openai_api
```

Read-only external consumer fact:

```text
landing-granit-static@628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8
  -> current vendored loader sends site_widget.v2
  -> current vendored loader polls site_widget.history.v2
```

#### 3.1.1. Матрица contract / runtime / queue / capability / rollback

| Contract | Runtime branch | Generator / executor / profile | Queue behavior | Production capability на наблюдавшемся SHA | Rollback / safe-off switch |
|---|---|---|---|---|---|
| `site_widget.v1` | `direct_openai`, `enforce` | `GroundedWidgetAiService`; grounded prompt/policy/tool assets; production recorded executor отсутствует из-за Postgres capability gap. | Без `widget_ai_jobs`; synchronous AI после persistence inbound. | App-owned grounded generator доступен при включённом AI и настроенных provider/verifier. | `AI_WIDGET_GROUNDED_MODE=off` для legacy compatibility или `AI_WIDGET_ENABLED=false`. |
| `site_widget.v1` | `direct_openai`, `shadow` | `ShadowWidgetAiReplyGenerator`: возвращает legacy `WidgetAiService`, grounded работает как observation. | Без durable queue; shadow запускается из request path. | Доступен при legacy provider; shadow evidence не доказывает durable v2. | `AI_WIDGET_GROUNDED_MODE=off` или `AI_WIDGET_ENABLED=false`. |
| `site_widget.v1` | `direct_openai`, `off` | Legacy `WidgetAiService`, legacy S05-style profile. | Без durable queue. | Compatibility path, а не выбранный primary runtime. | `AI_WIDGET_ENABLED=false`. |
| `site_widget.v2` | `direct_openai`, `enforce` / `shadow` / `off` | Те же generator branches; claim восстанавливает saved state только из `AiTurnInput`. | Job создаётся при `aiCanRun`; processing требует `AI_WIDGET_JOB_WORKER_ENABLED=true`. | Durable ack/history contract существует; при AI enabled и worker disabled возможен вечный `processing/poll_history`. | `AI_WIDGET_ENABLED=false`; один только worker flag не является customer-safe rollback для уже обещанного v2 processing. |
| `site_widget.v1` / `site_widget.v2` | `mastra_openai_api` | Recorded/live-v2 executor candidate с live-v2 asset profile; нужны recorded reply и gate capabilities. | Worker branch исключён для Mastra; v2 queued processing не является рабочим production path. | Postgres wiring не имеет обязательных capabilities; путь fail-closed недоступен как primary runtime. | `AI_RUNTIME_MODE=direct_openai` с grounded rollback flags или `AI_WIDGET_ENABLED=false`. |

### 3.2. Сверка ключевых утверждений последнего owner review

| Утверждение | Статус | Воспроизводимое доказательство |
|---|---|---|
| Job хранит устаревающий снимок контекста | подтверждено | `postgres-intake-repository.ts:471-568`, `public-widget-intake-service.ts:686-715`. |
| Старые jobs исполняются раньше новых | подтверждено | `postgres-intake-repository.ts:1181-1194`. |
| Один worker обрабатывает один job за раз | подтверждено | `widget-ai-job-worker.ts:18-77`, `app.ts:53-79`. |
| Send gate не проверяет revision/latest inbound | подтверждено | `postgres-intake-repository.ts:696-725`. |
| Lease attempt защищает finish, но не AI commit | подтверждено | `finishSiteWidgetAiJob` проверяет `attemptCount`; `persistAiReplyWithSendGate` не принимает job claim token. |
| После verifier текст может измениться | подтверждено | `grounded-widget-ai-service.ts:315-397`: normalizer, renderer, URL stripping и guard выполняются после verifier. |
| App-template помечается как grounded/verified | подтверждено | `grounded-widget-ai-service.ts:406-437`. |
| Детерминированная policy может обойти generator | подтверждено | `grounded-widget-ai-service.ts:113-118`. |
| Rolling summary является хвостом транскрипта | подтверждено | `postgres-intake-repository.ts:2670-2790`; memory helper повторяет тот же принцип. |
| Короткие «да/нет» могут подтвердить произвольный slot | подтверждено | `ai-slot-evidence-service.ts:80-87,119-120,174-177`; pending-question binding отсутствует. |
| Retrieval основан на token overlap | подтверждено | `file-catalog-knowledge-provider.ts:30-75`; `CatalogSearchInput.intents` не участвует в scoring. |
| В prompt передаётся тяжёлая catalog record | подтверждено | `catalog-prompt-record.ts:3-20`; grounded path запрашивает `limit: 12`. |
| Eval runner не воспроизводит persistence/queue multi-turn | подтверждено | `widget-ai-eval-runner.ts:38-100` вызывает generator на синтетическом `AiTurnInput`. |
| Основные orchestration/repository файлы являются крупными | подтверждено | `PublicWidgetIntakeService=1697` строк, `PostgresIntakeRepository=4231` строк. |
| Приведённые retrieval rankings воспроизводятся на текущем SHA | требует доказательств | В этом запуске scoring-кейсы из внешнего архива отдельно не воспроизводились. |
| Исторические latency 9.958/12.775 сек актуальны | требует доказательств | Нужен новый runtime trace/load baseline на закреплённом SHA. |
| Предложенная v2 схема является принятой архитектурой | не подтверждено | Это owner input; отдельный ADR/контракт ещё не одобрен. |

### 3.2.1. Дополнительные baseline-факты после Scout и Reviewer

| Факт | Статус | Воспроизводимое доказательство |
|---|---|---|
| `site_widget.v1` и `site_widget.v2` имеют разные execution paths | подтверждено | `packages/contracts/src/site-widget/v1.ts:3-9,76-98`; `public-widget-intake-service.ts:259-273`. |
| v1 остаётся synchronous HTTP AI path | подтверждено | `public-widget-intake-service.ts:269-273,279-520`. |
| v2 создаёт durable job только при `aiCanRun` | подтверждено | `public-widget-intake-service.ts:253-270`; `postgres-intake-repository.ts:555-581`. |
| Production Postgres wiring не предоставляет recorded reply/gate capability | подтверждено | `recorded-site-widget-ai-reply-repository.ts:21-59`; `app-context.ts:234-347`; `index.ts:18-33`; методы отсутствуют у `PostgresIntakeRepository`. |
| Claimed job теряет `AiTurnExecutionContext` | подтверждено | `public-intake-repository.ts:71-79`; `postgres-intake-repository.ts:1246-1258`; `public-widget-intake-service.ts:686-715`. |
| v2 может вернуть `processing/poll_history`, когда worker не запущен | подтверждено как code-level hazard | `config.ts:134-156`; `app.ts:53-79`; `public-widget-intake-service.ts:719-772`; deployed flags не проверялись. |
| Memory tests не доказывают PostgreSQL send gate и lease semantics | подтверждено | Раздел 16, находки 6–7; реальные PostgreSQL race tests не запускались. |
| Unknown history `schema_version` понижается до v1 | подтверждено | `public-intake-routes.ts:78-89`; `public-widget-intake-service.ts:135-204`. |
| Current landing consumer зависит от v2/history.v2 | подтверждено read-only | `landing-granit-static@628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8`; vendored loader `c44f99637e097a47b3c53099c95d7e8e01701ad8`; другой репозиторий не изменялся. |

### 3.3. Красный baseline

Команда:

```bash
npx vitest run \
  apps/api/test/modular-boundaries.test.ts \
  apps/api/test/widget-ai-job-worker.test.ts \
  apps/api/test/public-intake.test.ts \
  apps/api/test/grounded-widget-ai.test.ts \
  --maxWorkers=1
```

Результат:

- `grounded-widget-ai.test.ts`: 26 passed;
- `widget-ai-job-worker.test.ts`: 4 passed;
- `public-intake.test.ts`: 7 failed;
- `modular-boundaries.test.ts`: 2 failed;
- всего: 86 passed, 9 failed.

Ключевые конфликты:

- boundary test ожидает отсутствие Mastra/live-v2 в primary assembly, но находит
  23 production/script файла;
- boundary test ожидает устаревшее имя sanitizer-константы
  `SENSITIVE_STRING`, тогда как код использует `SENSITIVE_VALUE`;
- public intake tests расходятся с текущими fallback/degradation/runtime
  результатами;
- durable v2 history test получает `ai_persistence_unconfirmed`;
- grounded calculation test ожидает app-rendered provider metadata, но получает
  `model_provider=none`.

Эти падения не исправляются в AI-REF-001.

## 4. Источники истины

| Приоритет | Файл или источник | Что из него обязательно сохранить |
|---:|---|---|
| 1 | Текущий код и тесты на tree `d7c772b...` | Фактические runtime imports, persistence-before-AI, send gate, manager takeover, jobs и наблюдаемое состояние тестов. |
| 2 | `docs/adr/ADR-008-PUBLIC_WIDGET_AI_REPLY_GENERATOR_BOUNDARY_RU.md` | Узкий intake port, app-owned persistence sequencing, одна Fastify/Postgres система. |
| 3 | `docs/adr/ADR-010-AI_OBSERVABILITY_RUNTIME_BOUNDARY_RU.md` | App-owned primary runtime; Mastra допустима только как optional provider/sink. |
| 4 | Canonical wiki `07-agent-architecture.md`, `15-observability-contract.md`, `19-system-boundaries.md`, `25-first-implementation-slices.md` | App-owned business truth, send-time takeover gate, deterministic business truth, no multi-agent, slice order. Конфликт о роли Mastra требует явного решения. |
| 5 | `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md` | Самое позднее owner review; цель — bounded single agent, fresh turn, immutable text, transactional commit. |
| 6 | `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md` | Подробный исходный аудит и причины деградации разговора. |
| 7 | `docs/tasks/RECONCILE_REMAINING_BRANCHES_RU.md` | Историческая классификация старого Mastra/live-v2 как superseded/optional; факты SHA и номеров миграций требуют обновления. |

Хеши текущих untracked owner inputs:

```text
d1234c590dcfce97bfaba98c4e297e929893fdf6dc2d541f586a25ce128b7967
  docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md

cf3774841f1764e19bcb4dc86edeac14ad1cd89a83fff8b84c66ee0380213873
  docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md
```

Другой текущий untracked document, зафиксированный только как dirty inventory,
а не как source of truth AI-REF-001:

```text
e914a283270741d649dfebd53e43afd60e8a2817e91c33deb5445aeaa6d7c94a
  docs/architecture/CODEX_SDK_PREFECT_GATED_REFACTOR_PIPELINE_RU.md
```

Исторические материалы, которые не являются текущим доказательством:

- старые `AI_DIALOG_*` статусы и staging evidence без повторной проверки;
- `.agents/state/granit-dev-workflow.json`;
- архив `output/share/granit-operations-ai-layer-context-2026-07-28.zip`;
- старые утверждения, что следующая миграция начинается с `0014` или `0016`;
- исторические latency и retrieval scoring без нового запуска.

## 5. Варианты решения

### Вариант A — app-owned grounded runtime как единственный primary

- Суть: подтвердить ADR-010 и последнее owner review; Mastra/live-v2 оставить
  только как явно optional/legacy код до отдельного удаления; последующие
  маленькие срезы выравнивают assembly, тесты и документацию.
- Объём изменений: в AI-REF-001 только документ; будущие изменения делятся на
  отдельные срезы.
- Риски: canonical wiki всё ещё называет Mastra workflow основой; потребуется
  отдельное owner-approved обновление cross-repo source of truth.
- Обратимость: высокая; runtime v2 ещё не реализуется.
- Доказательства: ADR-010, текущая grounded assembly, owner final review,
  persistence/send-gate ownership.

### Вариант B — Mastra/live-v2 как основной runtime

- Суть: отменить или заменить ADR-010 и построить следующий runtime вокруг
  существующего Mastra/live-v2 пути.
- Объём изменений: большой; assembly, migrations, tests, prompts, model policy,
  rollback и observability.
- Риски: возвращение конкурирующей orchestration-модели, рост latency и
  противоречие последнему owner review.
- Обратимость: низкая после миграций и rollout.
- Доказательства: canonical wiki исторически описывает Mastra-based workflow,
  но текущий focused baseline этот вариант не подтверждает.

### Вариант C — формально поддерживать два равноправных runtime

- Суть: оставить grounded и Mastra/live-v2 полноценными режимами с общей
  матрицей контрактов и тестов.
- Объём изменений: самый большой; двойные prompt/policy/memory/eval/rollback
  контракты.
- Риски: повторение текущего расхождения и постоянное удвоение тестовой матрицы.
- Обратимость: средняя, но эксплуатационная стоимость высокая.
- Доказательства: код уже содержит несколько путей, однако красный baseline
  показывает, что их границы не удерживаются.

## 6. Принятое решение

Выбранный вариант:

- **Вариант A — app-owned grounded runtime как единственный primary**.

Почему:

- он совпадает с ADR-010 и самым поздним owner review;
- сохраняет app-owned persistence, send gate и manager control;
- не вводит новую платформу до исправления актуальности turn;
- позволяет разделить работу на узкие проверяемые срезы.

Почему не выбраны остальные:

- Вариант B требует новой cross-repo архитектурной развилки и противоречит
  последнему owner review;
- Вариант C сохраняет именно ту неоднозначность, которую должен устранить
  baseline reconciliation.

Дата и формулировка одобрения владельца:

- 2026-07-31: владелец после простого объяснения вариантов ответил
  «ок, давай», одобрив вариант A и продолжение по предложенному порядку.

## 7. Критерии успеха

- [x] Владелец явно выбрал A, B или C.
  - Проверка: дословная запись решения в разделе 6.
  - Ожидаемый результат: один primary runtime без неявной подмены.
- [x] Зафиксирован один воспроизводимый исходный SHA/tree.
  - Проверка: `git rev-parse HEAD`, `git rev-parse origin/main`,
    `git diff --quiet HEAD origin/main`.
  - Ожидаемый результат: следующий запуск использует одобренный commit и
    фиксирует owner inputs в git или по согласованным hashes.
- [x] Все текущие runtime-пути классифицированы.
  - Проверка: карта раздела 3 сопоставлена с `app-context.ts`, `app.ts`,
    `widget-ai-runtime-assembly.ts` и `modules/ai/**`.
  - Ожидаемый результат: каждый путь имеет статус primary, optional, legacy,
    superseded или candidate-for-removal.
- [x] Красные тесты не выданы за успешный baseline.
  - Проверка: приложен результат focused test run.
  - Ожидаемый результат: 9 падений записаны как исходное состояние.
- [x] История миграций классифицирована без создания новой migration.
  - Проверка: список файлов `packages/db/migrations/*.sql`.
  - Ожидаемый результат: дубли `0010–0012` и занятая `0016` зафиксированы;
    номер `0017` не утверждён до следующего среза.
- [x] Следующий технический срез содержит один результат.
  - Проверка: раздел 20.
  - Ожидаемый результат: не объединены revision fence, coalescing, worker pool,
    final text, memory и retrieval.

## 8. Область работы

### Разрешённые файлы рабочего кода

- нет.

### Разрешённые тесты

- только запуск существующих тестов;
- изменение тестов запрещено.

### Разрешённые документы и отчёты

- `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md`.

### Затрагиваемые модули и контракты

Только read-only исследование:

- runtime assembly;
- public widget intake;
- widget AI jobs;
- conversation persistence;
- send gate и manager takeover;
- grounded/legacy/Mastra/live-v2;
- memory, retrieval, renderer и verifier;
- migrations и focused tests.

## 9. Явно вне области

- исправление любых из 9 падающих тестов;
- новая migration;
- `generation_epoch`, `message_sequence`, response window или claim fencing;
- coalescing/debounce;
- worker pool;
- новый ModelTurnOutput/TurnDecisionV2;
- изменение final text, prompt, renderer, verifier или policy;
- retrieval v2, FTS, `pg_trgm`, embeddings;
- новая память и pending questions;
- Mastra/Graphile/LangGraph/другая платформа;
- staging, production, secrets и live model calls;
- изменение canonical wiki в другом репозитории.

## 10. Лимит изменений

| Ограничение | Значение |
|---|---:|
| Максимум файлов рабочего кода | 0 |
| Ориентир изменённых строк рабочего кода | 0 |
| Максимум новых файлов рабочего кода | 0 |
| Документы | 1 новый task document |
| Отдельный лимит тестов и проверочного кода | 0 изменённых файлов; разрешён только запуск существующих проверок |
| Порог обязательной остановки | любое изменение рабочего кода |

## 11. Действия с отдельным разрешением

- [ ] Миграция БД.
- [ ] Публичный контракт.
- [ ] Промпт, инструмент, AI-policy или настройка модели.
- [ ] Приватность, send-time gate или manager takeover.
- [ ] Новый пакет или внешняя зависимость.
- [ ] Изменение другого репозитория.
- [ ] Платная оценка на живой модели.
- [ ] Тестовая или рабочая среда.
- [ ] Секреты или runtime-конфигурация.
- [x] Ничего из перечисленного.

Полученное разрешение:

- владелец поручил выполнить только первый шаг — документарную сверку;
- реализация не разрешена.

## 12. Последовательность ролей

| Порядок | Роль | Модель | Reasoning | Разрешённая запись | Результат |
|---:|---|---|---|---|---|
| 1 | Архитектор | GPT-5.6 Sol | `medium` | Только этот документ | Вариант A, результат, область и лимиты одобрены владельцем. Точная модель прошедшего запуска не была подтверждена и остаётся явно записанным отклонением. |
| 2 | Исполнитель | GPT-5.5 | `xhigh` | Только этот документ, 0 production files | После `scope_approved` воспроизвести доказательства на одобренном SHA и закрыть gaps; не исправлять код. |
| 3 | Исследователь кода | GPT-5.4 | `high` | Только раздел 16 | Независимо найти пропущенные runtime paths и migration/test conflicts. |
| 4 | Проверяющий | GPT-5.6 Sol | `medium` | Только раздел 17 | Подтвердить карту и решение либо вернуть `needs_evidence`/`needs_human_decision`. |
| 5 | Исправление, если нужно | GPT-5.5 | `xhigh` | Только этот документ | Исправить подтверждённые ошибки карты, не код. |
| 6 | Учитель | GPT-5.6 Sol | `medium` | Только контрольный список | Подтвердить понимание baseline и границы следующего среза. |

Субагенты, Multi-agent, Terra и Ultra запрещены.

## 13. Условия обязательной остановки

- [ ] Понадобился неутверждённый файл или модуль.
- [ ] Понадобилась новая архитектурная развилка.
- [ ] Затрагивается незаявленная миграция БД.
- [ ] Меняется незаявленный публичный контракт.
- [ ] Меняется незаявленный промпт, инструмент, AI-policy или модель.
- [ ] Возникло влияние на приватность, send-time gate или manager takeover.
- [ ] Возникло влияние на другой репозиторий.
- [ ] Превышен лимит рабочего кода.
- [ ] Тест требует соседнего рефакторинга.
- [ ] Критерии успеха уже доказаны.

Если условие сработало:

- записать факт и остановиться;
- не исправлять найденную проблему в AI-REF-001;
- cross-repo конфликт о Mastra вернуть владельцу;
- новое техническое изменение оформить отдельным срезом.

## 14. Выполнение Исполнителем

Начальный SHA:

- `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`.
- Одобренный baseline source: локальный
  `origin/main@3ead589a8975944000d14e0cdb25c480afa73bcc`.
- Tree `HEAD` и локального `origin/main`:
  `d7c772b701e2c047298352e87eb2ad1c2ec6402c`.

Итоговый SHA:

- `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`.
- Commit не изменился; рабочий код не изменялся.

Фактически затронутые файлы:

- `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md`.

Краткое объяснение минимального решения:

- этот срез не меняет рабочий код;
- Исполнитель воспроизвёл baseline evidence на закреплённом SHA/tree;
- результаты записаны в этот документ;
- runtime v2, миграции, тесты и рабочий код не менялись.

Отклонения от контракта:

- модель текущего запуска не может быть проверена как GPT-5.5 `xhigh`;
- владелец подтвердил продолжение после предупреждения 2026-08-02;
- отклонение ограничено модельной проверкой запуска; область файлов и запрет
  рабочего кода соблюдены.

Область прямого и косвенного влияния:

- прямое влияние: только task-document с baseline evidence;
- косвенное влияние: следующий запуск получает воспроизводимую карту текущего
  AI-baseline;
- runtime, DB schema, prompts, policy, send gate, manager takeover, widget API,
  eval corpus и другие репозитории не затронуты.

## 15. Проверки и доказательства

| Команда или проверка | Результат | Доказательство или примечание |
|---|---|---|
| `git status --short --branch` | passed | Ветка `codex/ai-refactor-agent-governance-design`; tracked diff пустой; untracked: три architecture docs, этот task document и `output/`. |
| `git rev-parse HEAD`; `git rev-parse origin/main`; tree compare | passed | `HEAD=7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`; локальный `origin/main=3ead589a8975944000d14e0cdb25c480afa73bcc`; оба tree `d7c772b701e2c047298352e87eb2ad1c2ec6402c`; `git diff --quiet HEAD origin/main` вернул `0`. |
| `sha256sum` untracked architecture inputs/inventory | passed | Owner inputs: `AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md=d1234c590dcfce97bfaba98c4e297e929893fdf6dc2d541f586a25ce128b7967`; `AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md=cf3774841f1764e19bcb4dc86edeac14ad1cd89a83fff8b84c66ee0380213873`. Dirty inventory only: `CODEX_SDK_PREFECT_GATED_REFACTOR_PIPELINE_RU.md=e914a283270741d649dfebd53e43afd60e8a2817e91c33deb5445aeaa6d7c94a`. |
| `ast-index rebuild --no-deps` | passed | 219 project files и 4399 `.d.ts` проиндексированы. |
| Runtime/job/memory search через `ast-index` | passed | Найдены grounded, legacy, Mastra/live-v2, shadow, job, send-gate, memory и retrieval пути. |
| `rg -l -i 'mastra|live-v2|live_v2' apps/api/src` с boundary allowlist | passed as red inventory | 23 disallowed production/script paths для текущего boundary-test baseline; список совпадает с focused test failure. |
| `wc -l` основных orchestration/repository файлов | passed | `PublicWidgetIntakeService=1697` строк; `PostgresIntakeRepository=4231` строк. |
| Focused tests | failed as expected baseline | Команда из раздела 3.3: 95 tests, 86 passed, 9 failed; failed files: `public-intake.test.ts` и `modular-boundaries.test.ts`. |
| `npm run typecheck` | passed | API source/tests и manager TypeScript прошли. |
| PostgreSQL race tests | not run | `P2_TEST_DATABASE_URL` отсутствует; race-инварианты остаются непроверенной областью, а не доказанным поведением. |
| Проверка миграций | passed as inventory | `rg --files packages/db/migrations`: дубли номеров `0010`, `0011`, `0012`; `0016_widget_ai_jobs.sql` существует; новая migration не создавалась. |
| `git diff --check` | passed | Tracked diff без whitespace errors. |
| `git diff --no-index --check /dev/null docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md` | passed with expected diff exit | Диагностик whitespace не было; exit `1` ожидаем, потому что `/dev/null` отличается от существующего untracked-документа. |
| `git diff --stat`; no-index stat для untracked task doc на старте teaching | passed | Tracked stat пустой; no-index stat: `1 file changed, 1026 insertions(+)`. |
| Official Python SDK model preflights | passed | `openai-codex==0.144.4`: `gpt-5.4/high`, `gpt-5.6-sol/medium` и `gpt-5.5/xhigh` найдены через `Codex.models(include_hidden=True)` до соответствующих role threads. |
| Role sandboxes and schemas | passed | Scout, Reviewer и Repair создавались отдельными ephemeral threads с `Sandbox.read_only`, `ApprovalMode.deny_all` и обязательными JSON output schemas; workspace writes и live calls были запрещены. |
| Read-only external consumer check | passed | `landing-granit-static@628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8` на `main`; vendored widget `c44f99637e097a47b3c53099c95d7e8e01701ad8` содержит `site_widget.v2` и `site_widget.history.v2`; другой репозиторий не изменялся. |
| Repair allowlist | passed | Control-plane применил bounded Repair только к этому task document; изменено 0 code/test/migration files. |
| Live eval / provider call | not run | Запрещено областью и не требуется для reconciliation. |
| Full test suite / build | not run | Не требуются контрактом AI-REF-001; focused red baseline и typecheck выполнены. |

Непроверенные области:

- реальный PostgreSQL concurrency;
- staging runtime и deployed migrations;
- актуальные remote refs после возможного нового fetch;
- исторические latency;
- retrieval ranking из внешнего архива;
- полный test suite;
- точный runtime state production/staging;
- содержание недоступного `sandbox:/mnt/data/granit_ai_runtime_v2_architecture_ru.md`.

Способ отката или безопасного отказа:

- удалить только этот новый task document;
- owner-review документы и `output/` оставить без изменений;
- рабочий код не затронут.

Технический статус:

- `technical_done`;
- текущий baseline не зелёный;
- реализация runtime v2 заблокирована.

## 16. Отчёт Исследователя кода

Исследователь не меняет код.

Запуск роли:

- дата: 2026-08-02;
- официальный Python SDK: `openai-codex==0.144.4` с pinned Codex runtime;
- model preflight через `Codex.models(include_hidden=True)`: точная модель
  `gpt-5.4` доступна и поддерживает `high`;
- thread создан с `model="gpt-5.4"`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, `ephemeral=True`;
- turn выполнен с `effort=high` и обязательной JSON output schema;
- self-claim модели из текста ответа не использовался как доказательство:
  модель и effort подтверждены параметрами control-plane и preflight до запуска;
- SHA, наблюдавшийся ролью:
  `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`.

| № | Файл и строка | Находка | Доказательство | Последствие | Как проверить | Уверенность |
|---:|---|---|---|---|---|---|
| 1 | `packages/contracts/src/site-widget/v1.ts:3-9,76-98`; `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:259-273`; `apps/api/src/scripts/run-m3-mastra-smoke-once.ts:12-14,75-93` | Карта раздела 3.1 ошибочно проводит весь `site_widget` inbound через job/worker: поддерживаемый `site_widget.v1` исполняет AI синхронно в HTTP request, а job создаётся только для `site_widget.v2`. | Контракты экспортируют обе версии; `enqueueAiJob` выставляется только для v2; после сохранения v2 сразу возвращает ack, а v1 вызывает `processAcceptedSiteWidgetMessage`. Исторический M3 smoke тоже отправляет v1. | Job/lease/latest-wins исправления сами по себе не покрывают всё ещё поддерживаемый v1; M3 smoke не доказывает durable v2 path. Карта baseline требует исправления запуском Исправления или решением Проверяющего, но не в этой роли. | Сопоставить указанные строки; `rg -n "SITE_WIDGET_CONTRACT_VERSION|SITE_WIDGET_V2_CONTRACT_VERSION|enqueueAiJob" packages/contracts apps/api/src`. | высокая |
| 2 | `apps/api/src/index.ts:18-33`; `apps/api/src/app-context.ts:234-272,334-347`; `apps/api/src/modules/ai/repositories/recorded-site-widget-ai-reply-repository.ts:25-59`; `apps/api/test/helpers/memory-intake-repository.ts:159-179,296-365` | Production wiring с `PostgresIntakeRepository` не предоставляет capability recorded reply/gate, обязательные для recorded и Mastra/live-v2 executor; memory test double их предоставляет. | `buildWidgetAiTurnExecutor` сначала требует `persistRecordedSiteWidgetAiReply`; Mastra дополнительно требует `readRecordedSiteWidgetAiGate`. Эти методы отсутствуют у `PostgresIntakeRepository`, тогда как entrypoint передаёт именно его и отдельный `PostgresAiRunRepository`. | Наличие Mastra/live-v2 кода и зелёных memory/proxy assembly tests создаёт false-green: реальный Postgres entrypoint не создаёт этот executor и fail-closed отключает путь. | `rg -n "persistRecordedSiteWidgetAiReply|readRecordedSiteWidgetAiGate" apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts apps/api/test/helpers/memory-intake-repository.ts`; сопоставить type guards и `index.ts`. | высокая |
| 3 | `apps/api/src/modules/conversations/repositories/public-intake-repository.ts:37-79`; `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts:555-606,1246-1258`; `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:373-400,686-715`; `apps/api/test/public-intake.test.ts:462-535` | Claimed job несёт `AiTurnInput`, но не `AiTurnExecutionContext`; worker реконструирует `saved` без execution context. | Синхронный save строит оба объекта, но job schema/payload и claim возвращают только `AiTurnInput`. Recorded executor требует `saved.aiTurnExecutionContext` и иначе возвращает `ai_persistence_unconfirmed`. Focused v2 history test воспроизводит этот blocked result. | Любой queued path с recorded executor не может завершить AI reply даже при исправной модели и persistence capability. | Сопоставить тип `ClaimedSiteWidgetAiJob`, insert/claim и `processClaimedSiteWidgetAiJob`; запустить focused `public-intake.test.ts`. | высокая |
| 4 | `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:253-270,719-772`; `apps/api/src/config.ts:134-155`; `apps/api/src/app.ts:53-79` | v2 enqueue/ack не проверяет, что job worker запущен. | `aiCanRun` зависит только от generator/executor; при v2 job сохраняется и клиенту возвращается `processing/poll_history`. Worker при этом запускается только при `AI_WIDGET_JOB_WORKER_ENABLED=true`, а значение по умолчанию — `false`; Mastra mode дополнительно исключён из worker branch. | Допустимая конфигурация «AI включён, worker выключен» оставляет v2 job в `pending`, а клиент бесконечно получает обещание обработки. | Сопоставить условия `aiCanRun`, `enqueueAiJob`, `v2AcceptedSuccess`, config и worker startup; проверить v2 на memory repository без запуска worker. | высокая |
| 5 | `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:373-400`; `apps/api/src/modules/ai/ai-turn.ts:217-228`; `apps/api/src/modules/ai/profiles/legacy-s05/legacy-s05-orchestrator.ts:145-156`; `apps/api/src/modules/ai/services/recorded-legacy-s05-turn-service.ts:84-105`; `apps/api/test/public-intake.test.ts:1006-1042,2862-2880` | App-internal execution identity не сверяется с сохранёнными internal IDs до model/run execution. | Intake проверяет только наличие context. Оба matcher сравнивают channel, public IDs и fingerprints, но игнорируют `internal.leadId/conversationId/inboundMessageId`. Legacy service вызывает `beginOrReplay` с этими internal IDs до дальнейшего исполнения. Focused test подменяет internal conversation ID и фиксирует вызов generator, хотя ожидал fail-closed до генерации. | Повреждённый context может начать run с неверной внутренней identity; если ID валиден, это риск смешения trace/conversation ownership, а если нет — поздний DB failure вместо раннего отказа. | Запустить focused test `fails closed before generation when app-internal execution identity is inconsistent`; сопоставить matcher и порядок `beginOrReplay`. | высокая |
| 6 | `apps/api/test/helpers/memory-intake-repository.ts:1035-1043`; `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts:682-760`; `apps/api/test/public-intake.test.ts:463`; `apps/api/test/widget-ai-job-worker.test.ts:17` | Memory send gate не моделирует транзакционный Postgres send gate. | Memory helper отбрасывает `channel/provider/publicConversationId` и делегирует обычному `saveSiteWidgetAiMessage`. Postgres делает условный `UPDATE conversations` с manager/global runtime gates и в той же транзакции пишет outbound/replay/evidence. | Проходящие intake/worker tests на memory helper не доказывают реальные атомарные gate и persistence инварианты. | Сравнить две реализации и repository, используемый указанными тестами. | высокая |
| 7 | `apps/api/test/helpers/memory-intake-repository.ts:1438-1474`; `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts:1135-1283`; `apps/api/test/widget-ai-job-worker.test.ts:15-217` | Memory job queue не моделирует PostgreSQL claim/lease/order semantics; Postgres-интеграционных worker tests не найдено. | Memory claim видит только `pending/retrying` и сортирует по `availableAt`. Postgres дополнительно reclaim'ит expired `processing`, блокирует новый job более старым активным job той же conversation и использует `FOR UPDATE SKIP LOCKED`; finish сверяет attempt. | Четыре зелёных worker tests не являются evidence для реальных lease/race/order инвариантов и не закрывают уже записанный PostgreSQL evidence gap. | Сравнить реализации; `rg -n "claimSiteWidgetAiJob|widget_ai_jobs" apps/api/test`. | высокая |
| 8 | `apps/api/src/modules/intake/routes/public-intake-routes.ts:78-89`; `apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts:135-204`; `apps/api/test/public-intake.test.ts:538-652` | Неизвестный `schema_version` history endpoint молча понижается до `site_widget.history.v1`. | Route передаёт v2 только при точном равенстве, любое другое значение превращает в v1; typed unsupported-version branch и отрицательный тест отсутствуют. | Опечатка или будущая версия контракта выглядит как успешный v1 response, поэтому клиент не может надёжно обнаружить несовместимость. | Вызвать history route с `schema_version=site_widget.history.v3` либо сопоставить ternary route и тесты. | высокая |

Подтверждения уже записанного baseline:

- job сохраняет и исполняет полный стареющий `AiTurnInput` без fresh assembly;
- Postgres send gate не проверяет latest inbound, conversation revision или
  текущий job claim/attempt token;
- focused baseline остаётся красным: 95 тестов, 86 passed, 9 failed;
- в миграциях остаются дубли `0010`, `0011`, `0012`, а
  `0016_widget_ai_jobs.sql` уже существует.

Проверенные области без находок:

- новых скрытых message contract versions, кроме поддерживаемых v1/v2, в
  intake handler не найдено;
- дополнительных worker pool/parallel execution paths не найдено;
- дополнительных retrieval механизмов сверх уже записанного token-overlap
  поиска не найдено;
- новых обходных веток post-verifier processing сверх записанных в baseline не
  найдено.

Неизвестные:

- реальные PostgreSQL race/lease инварианты: `P2_TEST_DATABASE_URL` отсутствует;
- staging/production runtime state и фактически применённые миграции;
- full test suite и build в запуске Исследователя не выполнялись;
- исторические latency и retrieval rankings не воспроизводились.

Команды и проверки роли:

- `git rev-parse HEAD`;
- code-first search и чтение указанных production/test paths;
- focused Vitest command из раздела 3.3 с `TMPDIR=/dev/shm` — тот же результат
  86 passed / 9 failed;
- inventory миграций и capability search;
- sandbox не позволял записи в workspace; commit/push/live calls не
  выполнялись.

### 16.1. Свежая проверка после Repair

Отдельный post-Repair thread Исследователя кода:

- дата: 2026-08-03 UTC;
- новый model preflight подтвердил `gpt-5.4` с `high`;
- thread: `model="gpt-5.4"`, `effort=high`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, `ephemeral=True`, обязательная JSON output schema;
- область ограничена изменёнными Repair разделами 3, 3.1, 3.2.1, 4, 15, 18 и
  21;
- при shell-старте был один безвредный quoting diagnostic для текстового слова;
  SDK-thread, model/effort/sandbox и обязательные enum output schema не
  изменились, повторный thread не создавался.

Результат code-first recheck:

| Область | Результат | Доказательство |
|---|---|---|
| Dirty inventory, SHA и tree | подтверждено | Текущий status, HEAD/origin-main и общий tree совпадают с разделами 3 и 15. |
| v1 synchronous / v2 durable split | подтверждено | Контракты и `public-widget-intake-service.ts:259-273`. |
| Runtime matrix и production capability | подтверждено | `app-context.ts:234-347`, recorded capability guards, `index.ts:18-33`, `app.ts:53-79`. |
| Claimed-job execution context loss | подтверждено | `public-intake-repository.ts:37-79`, Postgres claim и `processClaimedSiteWidgetAiJob`. |
| Worker-disabled v2 hazard | подтверждено | `config.ts:134-156`, `app.ts:53-79`, `v2AcceptedSuccess`. |
| Read-only landing consumer | подтверждено | `landing-granit-static@628e4a07...`; loader `c44f9963...` использует v2/history.v2. |
| Sources of truth / Mastra conflict | подтверждено | ADR-008, ADR-010, owner inputs и canonical wiki conflict записаны без новой развилки. |
| Repair/evidence/handoff consistency | подтверждено | Изменён только task document; handoff возвращает flow к свежему Reviewer. |
| Focused baseline | подтверждено | 95 tests: 86 passed, 9 failed в тех же двух test files. |

Дополнительные ошибки:

- не найдены.

Проверки роли:

- focused Vitest command из раздела 3.3 с `TMPDIR=/dev/shm` — 86 passed,
  9 failed;
- `TMPDIR=/dev/shm npm run typecheck` — passed;
- HEAD/tree, dirty inventory, hashes и no-index stat — проверены read-only;
- рабочий код, тесты, документы и другой репозиторий ролью не изменялись.

Остаются явно записанными evidence gaps, но они не опровергают документарный
Repair: PostgreSQL race/lease, deployed flags/migrations и live provider/eval.

Вердикт свежего Scout: `clean`.

Результат роли: `code_scout_done`. Следующая разрешённая роль — отдельный свежий
запуск Проверяющего на GPT-5.6 Sol `medium`; он сначала выполняет собственный
проход, затем проверяет Repair и свежий отчёт. Следующая роль не запускалась
автоматически.

## 17. Независимая проверка

Проверяющий сначала выполняет собственный проход, затем проверяет отчёт
Исследователя кода.

Запуск роли:

- дата: 2026-08-02;
- model preflight через официальный Python SDK подтвердил точную
  `gpt-5.6-sol` и поддержку `medium`;
- thread: `model="gpt-5.6-sol"`, `effort=medium`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, `ephemeral=True`, обязательная JSON output schema;
- наблюдавшийся HEAD:
  `7aa3e892b4f29b817d53e0d7b13443ee9c16bcde`;
- tree HEAD и локального `origin/main`:
  `d7c772b701e2c047298352e87eb2ad1c2ec6402c`.

### Карта затронутых областей

- [x] Модули, интерфейсы и зависимости: проверены v1/v2 intake,
  app-context, production wiring, capability guards, worker и boundary tests.
- [x] БД, миграции и владение состоянием: подтверждены stale `AiTurnInput`,
  gaps send gate/claim fence и дубли миграций.
- [x] Обычное поведение и сценарии отказа: воспроизведены focused tests,
  synchronous v1, blocked queued recorded path и worker-disabled v2.
- [x] Промпты, инструменты, настройки моделей и AI-policy: проверены
  direct/Mastra, grounded off/shadow/enforce и версии asset profiles.
- [x] Приватность, send-time gate и manager takeover: подтверждены текущие
  manager/global gates и отсутствие latest-inbound/revision/claim fence;
  гипотеза утечки из-за имени sanitizer-константы отброшена.
- [x] Тесты, наборы оценки и наблюдаемость: focused baseline воспроизведён;
  memory/Postgres различия подтверждены; live eval запрещён.
- [x] Развёртывание и откат: проверены runtime/grounded/worker flags и Mastra
  worker exclusion; deployed state остаётся неизвестным.
- [x] Потребители в других репозиториях: read-only проверка текущего
  `landing-granit-static@628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8`
  подтвердила использование `site_widget.v2` и `site_widget.history.v2`.
  Другой репозиторий не изменялся и не входит в разрешённую запись Repair.

Подтверждённые находки:

- все восемь находок раздела 16 подтверждены;
- карта раздела 3.1 неверно объединяет synchronous v1 и durable v2;
- production Postgres wiring не предоставляет recorded reply/gate capability;
- queued recorded path теряет `AiTurnExecutionContext`;
- v2 может обещать `processing`, когда worker не запущен;
- internal identity не сверяется до begin/model execution;
- memory send gate и job queue не доказывают PostgreSQL semantics;
- неизвестная history schema version молча понижается до v1;
- актуальный внешний browser consumer зависит от v2 worker/history path;
- evidence inventory, no-index stat и handoff устарели после раздела 16;
- runtime/contract/capability/rollback варианты не сведены в единую baseline
  матрицу.

Отброшенные гипотезы и причина:

- `needs_human_decision` или `needs_redesign`: вариант A уже одобрен, совпадает
  с ADR-010 и поздним owner review; нужна правка карты, а не новая развилка;
- падение ожидания `SENSITIVE_STRING` как доказательство privacy leak: текущий
  код использует `SENSITIVE_VALUE` и sanitizer allowlist, поэтому это
  устаревшее строковое ожидание теста;
- зелёные memory worker tests как PostgreSQL concurrency evidence: тестовый
  double не моделирует production lease/gate semantics.

Обязательные документарные исправления:

1. Разделить карту 3.1 минимум на `site_widget.v1` synchronous path и
   `site_widget.v2` durable job path.
2. Для runtime branches указать contract version, generator/executor,
   prompt/policy/tool profile, queue behavior, production capability и rollback
   switch.
3. Зафиксировать отсутствие recorded/Mastra capability у production Postgres
   wiring и потерю execution context в claimed job.
4. Включить подтверждённые находки 1–8 в baseline без изменения рабочего кода.
5. Записать read-only факт о внешнем v2/history.v2 consumer, не меняя другой
   репозиторий.
6. Обновить dirty inventory, no-index stat, затронутые файлы и handoff.
7. Оставить PostgreSQL concurrency и deployed state в `needs_evidence`, а не
   выдавать их за успешную проверку.

Вердикт:

- [ ] `accept`
- [x] `needs_fix`
- [ ] `needs_evidence`
- [ ] `needs_redesign`
- [ ] `needs_human_decision`

Обоснование:

- вариант A остаётся обоснованным и не требует новой человеческой развилки;
- критерий проверяемой карты baseline пока не выполнен: карта объединяет v1 и
  v2, не показывает production capability gap, worker-disabled hazard и
  фактического внешнего v2 consumer;
- исправление ограничено текущим task document, не затрагивает рабочий код,
  тесты, другой репозиторий или следующий технический срез;
- следующая разрешённая роль — один запуск Исправления на GPT-5.5 `xhigh` в
  прежней области; он не запущен Проверяющим.

Непроверенные области:

- реальные PostgreSQL race/lease/claim tests: `P2_TEST_DATABASE_URL`
  отсутствует;
- staging/production flags, очередь и фактически применённые миграции;
- full test suite и build;
- актуальность remote refs после network fetch;
- live model/provider/eval — запрещены текущей областью.

### 17.1. Свежая независимая проверка после Repair

Отдельный post-Repair Reviewer thread:

- дата: 2026-08-03 UTC;
- новый model preflight подтвердил `gpt-5.6-sol` с `medium`;
- thread: `model="gpt-5.6-sol"`, `effort=medium`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, `ephemeral=True`, обязательная JSON output schema;
- Reviewer сначала выполнил собственный code-first проход, затем проверил
  свежий Scout раздела 16.1;
- рабочий код, тесты, документы и другой репозиторий ролью не изменялись.

Карта затронутых областей:

- [x] модули, интерфейсы и зависимости;
- [x] БД, миграции и владение состоянием;
- [x] обычное поведение и сценарии отказа;
- [x] промпты, инструменты, настройки моделей и AI-policy;
- [x] приватность, send-time gate и manager takeover;
- [x] тесты, наборы оценки и наблюдаемость;
- [x] развёртывание и откат;
- [x] потребители в других репозиториях — только read-only проверка.

Подтверждено:

- Repair точно разделил v1 synchronous и v2 durable paths;
- runtime/capability/rollback matrix согласована с code/config assembly;
- production Postgres recorded/Mastra capability gap, claimed-job context loss
  и worker-disabled v2 hazard записаны корректно;
- текущий landing consumer действительно использует v2/history.v2;
- dirty inventory, SHA/tree и evidence согласованы;
- свежий Scout `clean` подтверждён независимым проходом;
- вариант A остаётся согласованным с ADR-010 и owner review;
- изменён только task document, 0 code/test/migration files.

Отброшено:

- повтор исходной ошибки карты после Repair;
- наличие Mastra/live-v2 файлов как доказательство рабочего production Mastra;
- memory tests как PostgreSQL race evidence;
- worker-off как customer-safe rollback уже обещанного v2 processing;
- `SENSITIVE_STRING` test mismatch как доказательство privacy leak;
- необходимость staging/live evidence для принятия именно документарного
  AI-REF-001.

Вердикт свежего Reviewer:

- [x] `accept`.

Обоснование:

- единственный разрешённый Repair закрыл подтверждённые документарные
  замечания;
- повтор той же категории дефекта не найден, поэтому `needs_redesign` и
  `needs_human_decision` не требуются;
- PostgreSQL race/lease, deployed state, remote freshness, full suite/build,
  live provider/eval, исторические latency/retrieval и canonical wiki conflict
  остаются явно непроверенными или внешними, а не успешными evidence;
- следующий разрешённый запуск — Учитель; технический срез или рабочий код не
  запускаются.

## 18. Исправление

Разрешён один запуск Исправления без нового расширения области.

Запуск роли:

- дата: 2026-08-03 UTC;
- model preflight через официальный Python SDK подтвердил точную `gpt-5.5` и
  поддержку `xhigh`;
- thread: `model="gpt-5.5"`, `effort=xhigh`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, `ephemeral=True`, обязательная JSON output schema;
- роль получила только подтверждённые замечания раздела 17 и вернула bounded
  Markdown replacements; control-plane применил их только к этому документу;
- рабочий код, тесты, миграции, другой репозиторий, runtime config,
  prompts/model policy, live calls, commit/push и следующий срез не
  затрагивались.

| Цикл | Подтверждённые замечания | Изменённые файлы | Проверки | Результат |
|---:|---|---|---|---|
| 1 | Разделить v1 synchronous и v2 durable paths; добавить runtime/queue/capability/rollback matrix; зафиксировать Postgres recorded/Mastra capability gap, потерю execution context, worker-disabled v2 hazard, read-only внешний v2/history.v2 consumer; обновить dirty inventory, evidence и handoff. | Только `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md`; 0 code/test/migration files. | HEAD/tree и dirty inventory; targeted code/contract/capability reads; read-only consumer check; typecheck; focused baseline; no-index whitespace/stat после применения. | `technical_done`; обязательны свежие Code Scout и Reviewer по изменившейся документарной области. |

Второй цикл отдельно одобрен владельцем:

- нет.

Остаются `needs_evidence`, а не успешные доказательства:

- PostgreSQL concurrency / lease / claim semantics без
  `P2_TEST_DATABASE_URL`;
- staging/production flags, active worker, queue contents и фактически
  применённые migrations;
- full test suite, build и live provider/eval, не требуемые или запрещённые
  текущим срезом.

## 19. Живой контрольный список понимания

Учитель задаёт один вопрос за раз. Следующий срез заблокирован, пока все
обязательные пункты не подтверждены ответами владельца.

Активный запуск Учителя:

- дата: 2026-08-03 UTC;
- model preflight подтвердил точную `gpt-5.6-sol` с `medium`;
- сохраняемый thread ID: `019fc512-0da7-7ec0-9a36-61b7453d2791`;
- thread: `model="gpt-5.6-sol"`, `effort=medium`, `Sandbox.read_only`,
  `ApprovalMode.deny_all`, обязательная JSON output schema;
- следующие ответы владельца оцениваются продолжением именно этого thread;
- код, тесты, документы вне раздела 19, другой репозиторий и следующий срез
  Учителем не изменяются.

### Проблема

- [ ] Владелец своими словами объяснил, почему текущий baseline противоречив.
- [ ] Объяснил, почему красные тесты нельзя считать доказательством готовности.
- [ ] Назвал развилку app-owned primary против Mastra/live-v2 primary.

### Решение

- [ ] Объяснил выбранный primary runtime.
- [ ] Обосновал его против главной альтернативы.
- [ ] Понимает, почему runtime v2 не реализуется в AI-REF-001.
- [ ] Разобрал stale job после нового inbound или manager takeover.

### Доказательства

- [ ] Назвал focused tests и их текущий результат.
- [ ] Назвал отсутствие PostgreSQL race evidence.
- [ ] Назвал сигнал, который опроверг бы выбранную карту runtime.

### Более широкий контекст

- [ ] Объяснил влияние на migrations, send gate и manager control.
- [ ] Понимает, что owner review пока является input, а не принятым ADR.
- [ ] Понимает границу следующего среза.

Текущий учебный вопрос:

- `AI-REF-001-Q1`: «Своими словами объясни, почему baseline AI-слоя оказался
  противоречивым и в чём состоит архитектурная развилка между app-owned primary
  runtime и Mastra/live-v2 primary runtime».

Наблюдаемое подтверждение понимания:

- ответ владельца на `AI-REF-001-Q1` не получен в трёх последовательных
  goal-turns; thread сохранён, checklist без ответа не отмечается.

Статус:

- [ ] `teaching`
- [ ] `teaching_paused`
- [x] `teaching_deferred`
- [ ] `understanding_verified`
- [ ] `stopped`

Teach-back не завершён и не считается пройденным. Он явно отложен до конца
пакета `AI-LIVE-REF-FOUNDATION`.

## 20. Кандидат следующего среза

Это только запись. Текущий запуск не начинает эту работу.

Первый технический кандидат внутри пакета `AI-LIVE-REF-FOUNDATION`:

> PR 0a — настоящий PostgreSQL test harness, доказывающий concurrency,
> lease/fault injection, burst нескольких сообщений, manager takeover во время
> генерации и отсутствие дублей.

Предварительная граница:

- Testcontainers или отдельная real PostgreSQL test DB;
- сначала доказательства текущего поведения, без commit fence;
- не менять production schema, prompt/renderer/verifier или runtime policy;
- не включать coalescing и worker pool;
- точные файлы, зависимости, лимит и команды утверждает отдельный Архитектор.

Актуальный порядок продолжения хранится в Goal registry в начале документа:
PR 0a -> PR 0b -> PR 0c -> PR 1–PR 9. Этот исторический раздел не ограничивает
roadmap четырьмя срезами.

## 21. Передача следующему запуску

Технический результат AI-REF-001 принят. Учебный долг перенесён в общий
Teach-back Goal; следующий активный срез — PR 0a.

```text
Следующий запуск

Goal: 019fc912-6005-73f2-ba46-ccb40eb26334
Роль: Исполнитель PR 0a
Модель и reasoning: сильная coding-модель, high/xhigh рекомендуется
Документ среза: docs/tasks/AI_REF_PR0A_POSTGRES_TEST_HARNESS_RU.md
Исходный SHA: origin/main@3ead589a8975944000d14e0cdb25c480afa73bcc
Текущий SHA: 7aa3e892b4f29b817d53e0d7b13443ee9c16bcde
Текущий статус: AI-REF-001 technical accept; PR 0a planned
Разрешённая запись: область карточки PR 0a
Обязательный вход: PR 0a independent review/redesign и minimal Goal governance
Ожидаемый результат: production-shaped typed xfail, PostgreSQL shadow invariant и fail-closed cleanup
Условия остановки: четыре стоп-гейта AGENTS.md; не начинать PR 0b до независимого accept PR 0a
```
