# Карточка среза AI-рефакторинга: AI-REF-PR2 — latest-wins и fresh turn

Статус: `needs_evidence`; владелец 2026-08-04 снял public-contract stop-gate
выбором `C/A`; замечания четырёх независимых Reviewer исправлены, но обязательный
пятый свежий Reviewer не запустился из-за внешнего лимита Codex. Резервный
Claude CLI также недоступен этой организации. Собственный `accept` Исполнитель
не выдаёт.

Goal: `AI-LIVE-REF-ROADMAP`.

Позиция в roadmap: `PR1 accept -> PR2 -> PR3`.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`777d7dca351176b30042fa8b6bd136be041ddc04` /
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.

Фактическая модель Исполнителя: текущая Codex-модель, high reasoning.

Первый независимый Reviewer: `gpt-5.6-sol`, high reasoning, Codex session
`019fcdee-4a45-70b0-b83d-f3f57b21796b`; verdict `repair`.

Второй независимый Reviewer: `gpt-5.6-sol`, high reasoning, Codex session
`019fce09-2637-7f62-874f-280bc095b48a`; verdict `repair`.

Третий независимый Reviewer: `gpt-5.6-sol`, high reasoning, Codex session
`019fce2b-1127-7270-a7a5-dc6779dc4950`; verdict `repair`.

Четвёртый независимый Reviewer: `gpt-5.6-sol`, high reasoning, Codex session
`019fce3e-6fee-7043-b999-4828ab821c1a`; verdict `repair`.

## 1. Один результат

Пачка сообщений посетителя в одном response window приводит к одной генерации
по свежему состоянию разговора; только актуальная lease-attempt может атомарно
сохранить ответ и завершить job, а HTTP intake не ждёт AI.

Это заранее указанный срез после независимого `accept` PR1. PR1 дал sequence,
generation epoch и commit fence; PR2 должен использовать их для coalescing,
latest-wins и fresh assembly.

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | dirty worktree с принятыми PR0a/PR0b/PR0c/PR1 и пользовательскими untracked owner docs/output; всё сохраняется |
| Base/head SHA | `777d7dca351176b30042fa8b6bd136be041ddc04` / тот же SHA |
| Принятый PostgreSQL evidence PR1 | migration reconciliation `5/5`, runtime invariants `19/19` |
| Принятые общие проверки PR1 | typecheck/build green, M3 `14/14`, diff check green |
| Исходный красный baseline PR2 | burst single-generation и lost-lease attempt fence до реализации были typed expected-failure |
| Исходное поведение | v2 ставил durable job и отвечал `202 processing`; v1 выполнял AI синхронно в HTTP path; worker был последовательным и исполнял persisted snapshot |

Источники истины по приоритету:

1. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
2. `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
3. принятая карточка `AI_REF_PR1_TURN_IDENTITY_COMMIT_FENCE_RU.md`;
4. текущий код и exact-hash evidence PR1.

## 3. Область

Разрешены:

- существующая PostgreSQL widget AI queue, её schema/migration и repository
  contract;
- supersede pending jobs, bounded debounce и response-window identity;
- fresh assembler в claim/execute path вместо исполнения сохранённого snapshot;
- lease-attempt fence и одна транзакция для reply commit + terminal job state;
- локальный `AbortController`, bounded worker pool `global=4`,
  `per-conversation=1` и queue-wait observability;
- удаление синхронного AI-вызова из HTTP intake в выбранной владельцем форме;
- выбранное владельцем представление `agent_thinking`.

Явно вне области:

- PR3 prompt/model output contract, tools, policy и semantic behavior;
- PR4 memory/state patches, manager takeover semantics и privacy/send policy;
- новый queue framework, новый realtime transport, deploy, secrets/runtime
  activation и external DB apply.

Ожидаемый размер diff: средний/крупный correctness slice; существенное
расширение сверх перечисленных модулей объясняется здесь и проверяется Reviewer.
Hard allowlist не вводится: точная migration и test-fixture поверхность будет
следовать из выбранного публичного поведения.

## 4. Критерии успеха

- [x] Три visitor messages в debounce window дают одну model generation и один
  committed AI reply через последний visitor sequence.
- [x] Pending predecessor становится `superseded`; processing predecessor не
  может commit после нового inbound/control/lease attempt.
- [x] Claim собирает авторитетный свежий context, а job не исполняет persisted
  `AiTurnInput` snapshot.
- [x] Response-window turn key уникален по conversation, epoch,
  responds-through sequence и runtime mode; старый inbound-message key не
  создаёт второй ответ на replay/migration seam.
- [x] Reply persistence и terminal job state происходят в одной транзакции;
  lost lease не может закончить чужую попытку.
- [x] Worker выполняет не более четырёх разных conversations параллельно и не
  более одного turn на conversation; local abort не заменяет commit fence.
- [x] HTTP intake не ждёт retrieval/model/verifier/persistence AI path.
- [x] Выбранное публичное v1 и `agent_thinking` поведение покрыто contract и
  API integration tests.
- [x] Real PostgreSQL burst/lost-lease/concurrency tests, migration
  reconciliation, typecheck, build, M3 и применимые architecture checks green.

## 5. Стоп-гейты

- [ ] Архитектурная развилка / roadmap / ownership.
- [x] Migration/schema БД или публичный контракт.
- [ ] Prompt/tool/model-policy/privacy/send gate/takeover.
- [ ] Deploy/secrets/runtime config/платный вызов/другой repo.

Roadmap уже одобряет queue/schema часть PR2, но не задавал точную совместимость
публичного `site_widget.v1` и wire-shape `agent_thinking`.

Факты, из-за которых нельзя выбрать молча:

- `site_widget.v2` уже отвечает `202` с `automation.status="processing"`,
  `next_step="poll_history"`; history v2 показывает per-message job status и
  `poll_after_ms`;
- `site_widget.v1` не имеет `processing` state и сейчас возвращает inline AI
  reply/fallback после синхронного выполнения;
- отдельного публичного `agent_thinking` event contract или realtime transport
  в текущем коде нет.

Решение владельца 2026-08-04:

1. **`C` — v1 retired.** Intake принимает только `site_widget.v2`.
   `site_widget.v1` получает существующую форму `unsupported_version` с HTTP
   `422`, `code="unsupported_schema_version"` и
   `supported_versions=["site_widget.v2"]`; v1 request/success schema и
   синхронный AI response path удаляются из поддерживаемого public contract.
2. **`A` — существующий thinking signal.** v2
   `automation.status="processing"`, `next_step="poll_history"` и active job
   status в history v2 являются авторитетным сигналом `agent_thinking`. Новый
   wire event и realtime transport в PR2 не добавляются.

Это breaking public-contract решение явно одобрено владельцем словами, что
legacy не нужен и система должна сразу делаться на актуальном v2. Stop-gate
снят; Исполнитель продолжает тот же PR2.

## 6. Выполнение

Реализован один результат PR2:

- public intake поддерживает только `site_widget.v2`; корректный v1 запрос
  получает HTTP 422 `unsupported_version` до persistence;
- HTTP v2 всегда возвращает durable ack и не ждёт retrieval/model/verifier/reply
  persistence;
- новый inbound supersede-ит pending/retrying predecessor, а claim допускает
  только актуальный epoch/latest visitor sequence и не более одной active lease
  на conversation;
- job хранит ссылочную turn identity и runtime mode, но больше не хранит
  `AiTurnInput` snapshot; context собирается из authoritative PostgreSQL state
  после claim;
- direct и recorded local/fake boundaries используют response-window
  idempotency key и lease-attempt identity;
- reply commit и terminal `replied` job update происходят в одной PostgreSQL
  transaction; последующий потерянный finish acknowledgement является no-op;
- worker имеет bounded pool `global=4`, per-conversation exclusion,
  `AbortController` для утратившего актуальность turn и обязательный commit
  fence;
- queue wait и response-window identity записываются в безопасную metadata;
- существующие v2 `processing/poll_history` и terminal history status являются
  выбранным владельцем thinking signal.

Удалены 22 теста старого синхронного POST-контракта. Они не помечены `skip`:
проверки актуального HTTP поведения перенесены на v2 ack/history, а semantic
инварианты остаются в специализированных legacy/live-v2/grounded tests. M2
local/fake интеграция также переведена на durable worker/history.

Логические файлы PR2:

```text
apps/api/src/app-context.ts
apps/api/src/app.ts
apps/api/src/widget-ai-runtime-assembly.ts
apps/api/src/modules/ai/adapters/openai-widget-assistant-provider.ts
apps/api/src/modules/ai/ports/recorded-ai-turn.ts
apps/api/src/modules/ai/repositories/recorded-site-widget-ai-reply-repository.ts
apps/api/src/modules/ai/services/bound-recorded-legacy-s05-turn-service.ts
apps/api/src/modules/ai/services/grounded-widget-ai-service.ts
apps/api/src/modules/ai/services/recorded-legacy-s05-turn-service.ts
apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts
apps/api/src/modules/ai/services/recorded-public-widget-ai-turn-executor.ts
apps/api/src/modules/ai/services/shadow-widget-ai-reply-generator.ts
apps/api/src/modules/ai/services/widget-ai-service.ts
apps/api/src/modules/conversations/repositories/conversation-message-repository.ts
apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts
apps/api/src/modules/conversations/repositories/public-intake-repository.ts
apps/api/src/modules/intake/ports/public-widget-ai-reply-generator.ts
apps/api/src/modules/intake/ports/public-widget-ai-turn-executor.ts
apps/api/src/modules/intake/ports/public-widget-manager-review-repository.ts
apps/api/src/modules/intake/services/widget-ai-job-worker.ts
apps/api/src/modules/intake/use-cases/public-widget-intake-service.ts
apps/api/src/scripts/m3-smoke-evidence.ts
apps/api/src/scripts/run-m3-mastra-smoke-once.ts
apps/api/test/ai-schema-migration-reconciliation.test.ts
apps/api/test/ai-turn-context.test.ts
apps/api/test/helpers/memory-intake-repository.ts
apps/api/test/helpers/postgres-widget-ai-test-harness.ts
apps/api/test/m2-live-v2-runtime-integration.test.ts
apps/api/test/m3-smoke-evidence.test.ts
apps/api/test/manager-ai-control.test.ts
apps/api/test/manager-ai-quality-visibility.test.ts
apps/api/test/manager-auth.test.ts
apps/api/test/p2-observability-integration.test.ts
apps/api/test/p2-observability-postgres.test.ts
apps/api/test/p3-approved-ai-assets.test.ts
apps/api/test/p3-manager-ai-quality-visibility.test.ts
apps/api/test/public-intake-cors.test.ts
apps/api/test/public-intake.test.ts
apps/api/test/widget-ai-job-worker.test.ts
apps/api/test/widget-ai-memory.test.ts
apps/api/test/widget-ai-postgres-runtime-invariants.test.ts
apps/api/test/widget-ai-runtime-assembly.test.ts
packages/contracts/src/site-widget/v1.ts
packages/contracts/src/site-widget/v2.ts
packages/contracts/src/index.ts
packages/contracts/package.json
packages/contracts/README.md
packages/db/src/schema.ts
packages/db/migrations/0019_widget_ai_latest_wins.sql
docs/tasks/AI_REF_PR2_LATEST_WINS_FRESH_TURN_RU.md
```

Base/head SHA остаются
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.
Worktree содержит принятые предыдущие срезы, поэтому обычный `git diff --stat`
является cumulative, а не чистым PR2 diff. Текущий cumulative stat относительно
base: `66 files changed, 4435 insertions(+), 2983 deletions(-)`; untracked
migration, v2 re-export и карточки в этот stat не входят.

Прямое влияние: public widget contract, queue/lease/worker, fresh turn assembly,
reply commit, history status и controlled M3 consumer. Косвенное влияние:
runtime assembly, cancellation propagation, recorded local/fake boundary,
migration inventory и test fixtures. Prompt, tools, model policy, privacy/send
policy и manager takeover semantics не менялись.

## 7. Evidence

| Проверка | Результат | Примечание |
|---|---|---|
| ast-index Code Scout | green | callers для claim/process/persist; отдельно проверены stale snapshot refs, v1 callers, failure paths и runtime-mode propagation |
| Public API integration | `30/30` | v1 422 до persistence; v2 processing -> history reply |
| M2 local/fake durable integration | `16/16` | Mastra local/fake через queue, response-window key, replay, takeover/gate failures, newer-inbound и shutdown cancellation |
| Worker tests | `4/4` | retry, atomic reply acknowledgement loss, stale attempt, polling recovery |
| Real PostgreSQL runtime | `22/22` | burst, newer inbound abort/fence, lost-lease reply и degradation, history >100, atomic reply/job commit, pool=4/per-conversation=1 |
| Real PostgreSQL migrations | `5/5` | fresh/seeded lineages, 0019 columns/checks/index, turn backfill |
| M3 evidence unit | `14/14` | v2 ack + history summary; controlled external smoke не запускался |
| P2 observability async integration | `14/14` | stale no-reply после reclaim и до reclaim по истёкшей lease; manager-review ack-loss atomicity |
| P2 PostgreSQL observability | `10/10` | disposable Testcontainers; direct `native_grounded` и честный recorded/Mastra fail-closed без model call |
| Runtime assembly | `3/3` | staging generator не обходит durable worker/capability gate |
| Targeted aggregate | `118/118` | девять применимых suite, включая disposable PostgreSQL P2, в одном последовательном прогоне green |
| Focused cancellation/sanitizer | `13/13` | combined caller/timeout signal и валидация фактически сохраняемых queue/window counters |
| Typecheck | green | API source, 55 bounded test groups, manager |
| Production build | green | manager Vite build после полного typecheck |
| `git diff --check` | green | whitespace errors отсутствуют |
| Modular boundaries | baseline `12/14` | два stale assertions запрещают уже существующий Mastra/live-v2 слой и требуют старое имя `SENSITIVE_STRING`; PR2 этот тест не меняет |

Не выполнены и не выдаются за evidence:

- migration 0019 не применялась к внешней/production БД;
- deploy, secrets и платный provider call не выполнялись;
- controlled staging M3 smoke fail-closed останавливается до внешнего вызова,
  пока PostgreSQL repository не реализует recorded reply capability; staging
  Mastra worker автоматически не активирован;
- production-scale latency/throughput не измерялись.

Privacy scout: job snapshot удалён; новые queue fields содержат UUID/counters,
runtime enum и bounded error/status data. Новых prompt/raw provider payload,
contact data или secret-bearing logs не добавлено. Existing observability
sanitizer остаётся на persistence boundary.

Соседний кандидат следующего среза, не исправленный здесь: recorded executor
не переносит catalog references в v2 history. Это не latest-wins и не влияет
на доказательство durable reply.

Rollback до external migration: удалить 0019 и вернуть перечисленный
логический PR2 diff. После применения migration откат требует сначала
остановить worker, восстановить совместимое snapshot-поле только при реальной
необходимости и отдельно согласовать возврат public v1; автоматический rollback
на v1 не предусмотрен решением владельца.

## 8. Независимая проверка

Первый fresh Reviewer (`gpt-5.6-sol`, high, session
`019fcdee-4a45-70b0-b83d-f3f57b21796b`) выдал `repair`:

1. stale/lost-lease attempt мог записать degradation до fenced job finish;
2. несколько специализированных P2/M3 тестов оставались на старом sync
   ожидании и не входили в aggregate;
3. history выбирала первые, а не последние 100 сообщений и могла скрыть
   активный latest job.

Второй fresh Reviewer (`gpt-5.6-sol`, high, session
`019fce09-2637-7f62-874f-280bc095b48a`) выдал `repair`:

1. recorded `no_reply` завершал run до attempt fence и отдельно от
   manager-review/job terminal state;
2. изменённый PostgreSQL P2 suite оставался env-gated и ожидал capability,
   которой production repository намеренно не имеет;
3. fresh context сортировался по timestamp и фильтровал eligibility после
   `LIMIT`, а не по authoritative `message_sequence`;
4. пакет контрактов продолжал экспортировать и рекламировать retired v1.

Третий fresh Reviewer (`gpt-5.6-sol`, high, session
`019fce2b-1127-7270-a7a5-dc6779dc4950`) выдал `repair`:

1. recorded `no_reply` boundary проверял attempt/turn identity, но не
   `lease_expires_at > now`; существующий regression закрывал stale попытку
   только после reclaim и поэтому не видел окно между expiry и reclaim.

Остальные блоки второго repair Reviewer подтвердил. В его sandbox не был
доступен container runtime: независимо прошли `78` non-PostgreSQL тестов,
`37` PostgreSQL тестов завершились до выполнения с явной ошибкой Testcontainers,
а не были засчитаны green. Typecheck и diff check прошли.

Четвёртый fresh Reviewer (`gpt-5.6-sol`, high, session
`019fce3e-6fee-7043-b999-4828ab821c1a`) воспроизвёл `116/116`, typecheck и
diff check, подтвердил остальные инварианты и выдал `repair`:

1. worker cancellation терялась на recorded boundary, поэтому provider мог
   продолжать вызов после newer inbound или shutdown;
2. queue/window metadata добавлялась до sanitizer, но ключи не входили в
   allowlist, поэтому persistence молча их отбрасывал, а тесты не читали
   фактическую запись.

Пятый fresh Reviewer после repair должен повторно проверить:

1. exact response-window identity и legacy lookup seam;
2. transaction/lock ordering conversation -> job и отсутствие false retry после
   atomic reply commit;
3. race claim -> fresh assembly -> newer inbound/control/lease expiry;
4. worker pool, shutdown cancellation и per-conversation exclusion;
5. v1 retirement и M3/script callers;
6. migration compatibility и Drizzle/DDL parity;
7. privacy metadata и false-green risk после удаления sync tests;
8. честность ограничения staging Mastra/PostgreSQL recorded capability.

Попытка пятого запуска `gpt-5.6-sol`, high, session
`019fce57-4bd1-7390-9ff0-c0b9d65b148a` остановилась до чтения кода: сервис
вернул usage limit до 2026-08-08 08:09. Резервный свежий запуск Claude Opus,
high, также остановился до чтения кода с ответом об отсутствии доступа у
организации. Эти попытки не считаются независимой проверкой или evidence.

Автор изменений собственный verdict не выдаёт.

## 9. Repair

На техническом проходе исправлены:

- raw `Date` parameter в claim SQL заменён на явный timestamptz;
- provider `AbortError` при `job_not_current` классифицируется как
  `superseded`, а не `worker_failed/retrying`;
- recorded local/fake boundary получил response-window key и job attempt fence;
- runtime mode протянут intake -> job -> reply key;
- Drizzle schema дополнен теми же status/runtime checks и unique response-window
  index, что migration 0019;
- M3 caller переведён с retired v1 на v2 ack/history и fail-closed capability
  check;
- stale worker test обновлён под атомарный `replied` state.

По замечаниям первого независимого Reviewer исправлены:

- degradation persistence и terminal `degraded` job теперь одна транзакция с
  `jobId + attempt + live lease + epoch + sequence + runtime` fence; локальная
  manager-review boundary получила тот же job/turn fence;
- добавлен реальный PostgreSQL race: stale attempt возвращает `no_reply` после
  reclaim, не оставляет degradation, а attempt 2 сохраняет единственный reply;
- history читает последние 100 сообщений по monotonic sequence и возвращает их
  в хронологическом порядке; тест на 101 сообщении сохраняет latest pending
  signal и `poll_after_ms`;
- P2 observability и runtime assembly переведены с sync POST assertions на
  durable v2 processing/history; один устаревший sync-only manager-transition
  тест удалён, остальные специализированные observability проверки сохранены;
- targeted aggregate расширен с `87/87` до `103/103`, затем полный
  typecheck/manager build и diff checks прошли.

По замечаниям второго независимого Reviewer исправлены:

- recorded no-reply получил app-owned atomic boundary: terminal run,
  manager-review и terminal job фиксируются вместе только для живых
  job/attempt/epoch/sequence/runtime; response-window run key разделён по
  attempt, поэтому reclaim запускает свежую генерацию;
- добавлены regressions: stale no-reply не оставляет terminal replay и attempt
  2 отвечает; потерянный acknowledgement после manager-review commit не
  дублирует transition и не оставляет processing job;
- fresh context выбирает eligible visitor/AI text до limit, сортирует по
  `message_sequence DESC` и проверен на равных/обратных timestamps с точным
  хронологическим массивом;
- PostgreSQL P2 suite переведён на disposable Testcontainers и фактический
  production contract: direct `native_grounded`, recorded/Mastra fail-closed
  до generator; suite `10/10` включён в aggregate;
- public export surface и README переведены на v2-only; v1 request/success
  schemas и types удалены, subpath/JSON export указывают на v2;
- targeted aggregate теперь `115/115`; полный typecheck, manager build и diff
  checks повторно green.

По замечанию третьего независимого Reviewer исправлены:

- единый deterministic current-attempt predicate проверяет live lease,
  attempt, lead/conversation/inbound identity, epoch, sequence, runtime mode,
  conversation send control и global manager AI control;
- predicate используется внутри recorded no-reply atomic boundary,
  manager-review transition, reply persistence и текущей-attempt проверки;
  stale worker finish также не может завершить job после lease expiry;
- добавлены управляемые тестовые часы и regression на точное окно
  `lease expired, reclaim not started`: attempt 1 не оставляет terminal run,
  manager-review или terminal job, затем attempt 2 реально вызывает generator
  и сохраняет единственный terminal reply;
- ack-loss regression сохранён; P2 async стал `14/14`, targeted aggregate —
  `116/116`, полный typecheck/manager build и diff check повторно green.

По замечаниям четвёртого независимого Reviewer исправлены:

- worker `AbortSignal` протянут через public executor, recorded legacy/live-v2
  services и generator; caller cancellation объединяется с provider timeout;
  системные тесты подтверждают abort при newer inbound и shutdown без stale
  terminalization;
- `queue_wait_ms`, `response_window_epoch` и `responds_through_sequence`
  явно разрешены и bounded-валидируются sanitizer, протянуты через direct,
  recorded и degradation paths; memory и disposable PostgreSQL проверки читают
  фактически сохранённую metadata;
- focused sanitizer/provider suite прошёл `13/13`, targeted aggregate расширен
  до `118/118`; полный typecheck, manager build и diff check повторно green.

Новый repair выполняется только по замечаниям независимого Reviewer.

## 10. Передача Goal

```text
Goal: AI-LIVE-REF-ROADMAP
Текущий срез: AI-REF-PR2
Статус: needs_evidence; fifth fresh independent re-review unavailable
Base/head SHA: 777d7dca351176b30042fa8b6bd136be041ddc04 / тот же
Результат: latest-wins fresh-turn durable v2 queue реализована
Evidence: targeted 118/118 (API 30; M2 16; worker 4; PostgreSQL 22;
          migrations 5; M3 14; P2 async 14; P2 PostgreSQL 10; assembly 3);
          typecheck/build/diff-check green
Непроверено: external migration/deploy/paid smoke/production load;
             staging Mastra recorded PostgreSQL capability
Rollback: logical PR2 diff + 0019 до external apply; public v1 не восстанавливается автоматически
Verdict: four Reviewer repair verdicts; fixes complete; accept отсутствует из-за внешнего лимита Reviewer
Следующий срез: PR3 автоматически только после свежего независимого accept PR2
```
