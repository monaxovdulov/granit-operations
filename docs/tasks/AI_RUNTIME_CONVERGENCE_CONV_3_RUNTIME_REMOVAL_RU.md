# Карточка среза AI Runtime Convergence: CONV-3 — удаление Mastra и executable legacy

Статус: `accept`; опубликован в commit
`8122a8ef44568d6b97dccee54dee074c4a1c4733` 2026-08-05.

Goal: `AI-RUNTIME-CONVERGENCE`.

Base SHA: `8351432916b91edabd014a9093adcbb41bc52813`
(`HEAD == origin/main`; tracked tree чистый, pre-existing untracked `output/`
принадлежит пользователю и не изменяется).

## Один результат

Production tree содержит один app-owned `direct_openai` runtime на принятом
`ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn` pipeline: исполняемые
Mastra и legacy_s05 ветки, runtime selector и Mastra dependency отсутствуют.

## Baseline callers и решение

AST/caller audit на Base SHA подтвердил:

- `MastraLiveV2DecisionGenerator` вызывается production assembly и Mastra-only
  tests; прямой runtime уже имеет отдельный `OpenAiLiveV2DecisionGenerator`;
- `RecordedLegacyS05TurnService` и `BoundRecordedLegacyS05TurnService`
  вызываются production assembly legacy-ветки и legacy/observability tests;
- `WidgetAiService` вызывается production legacy/shadow reply assembly и
  legacy tests; direct live-v2 не зависит от него;
- runtime selector используется config, app-context, runtime assembly и
  persistence DTO/repository contracts;
- значения `mastra_openai_api` и `legacy_s05` присутствуют в исторических
  migrations и durable repository records.

Утверждённый cleanup удаляет исполняемые ветки и выбор runtime. Исторические
DB values, migrations и read-side compatibility сохраняются: их удаление
потребовало бы отдельной миграции/изменения durable contract и не нужно для
наблюдаемого результата этого среза.

## Область и исключения

В области:

- удалить `@mastra/core` из package manifest и lockfile;
- удалить Mastra adapter, smoke runner, Mastra config/env и альтернативную
  assembly ветку;
- сделать direct live-v2 единственной production assembly без selector;
- удалить legacy_s05 profile/services/ports и legacy reply/shadow production
  assembly, если повторный caller check не обнаружит consumer;
- перенести применимые synthetic, sanitizer, queue/replay/takeover/failure
  assertions на direct provider-neutral seams и удалить только Mastra/legacy
  assertions;
- скорректировать активную environment documentation строго в части удалённых
  runtime/env knobs.

Вне области:

- другие migrations, durable enum и read compatibility для исторических
  `ai_runs`/messages/jobs;
- public HTTP contract, business/privacy/send gate/manager takeover policy;
- prompt, model, reasoning profile, tools/retrieval и approved live-v2 assets;
- CONV-4 cleanup исторической документации и CONV-5 guardrails;
- secrets, платные provider calls, runtime activation и deploy.

Точное удаление уже разрешено Goal и не открывает новый stop-gate. Если для
компиляции окажется нужна новая migration, public-contract change либо изменение
prompt/model/policy/privacy/send gate/takeover, срез останавливается.

## Проверки успеха

- package files не содержат `@mastra/core`;
- production assembly/config не содержат `mastra_openai_api`, `MASTRA_*` и
  executable legacy_s05 branch;
- production имеет один direct constructor path, runtime selector отсутствует;
- provider-neutral contract, app-owned queue, latest-wins, fresh context,
  response-window, atomic commit, send gate и takeover tests проходят;
- удаление tests не уменьшает доказательства: применимые assertions переносятся
  или заменяются direct-path assertions;
- применимые unit/integration/PostgreSQL tests, typecheck, build,
  `git diff --check` и literal/caller scans проходят;
- свежий независимый Reviewer выполняет Code Scout (callers, failure paths,
  concurrency, migrations, privacy и false-green tests) и даёт `accept`.

## Риски, непроверенное и откат

Главные риски: случайно удалить полезные synthetic fixtures/observability
assertions, сломать чтение исторических runs или ослабить fail-closed behavior.
Реальные provider calls, staging/production, latency/load и subjective quality
не проверяются.

До accepted commit откат — удалить только CONV-3 diff. После публикации —
отдельный `git revert` CONV-3 commit; предыдущая принятая кодовая точка отката —
`4d567d8acfef3718d92358c3980430539aea367d`, а документационная база среза —
`8351432916b91edabd014a9093adcbb41bc52813`.

## Evidence перед завершением

Исполнитель: `GPT-5` (точный runtime identifier недоступен).

- real PostgreSQL runtime и migration reconciliation:
  `30/30` (`24/24` runtime, `6/6` migrations);
- применимая матрица direct runtime, boundary, policy, takeover и manager
  visibility: `111 passed`, `1 skipped`;
- `npm run build`: API typecheck, manager typecheck и Vite build прошли;
- `git diff --check`: прошёл;
- package manifests не содержат `@mastra/core`; production assembly, config и
  app context не содержат selector, Mastra или executable legacy branch;
- полный `npm test -- --maxWorkers=1` до исправления последнего CONV-3
  ожидания: `349 passed`, `4 failed`, `2 skipped`. Устаревшее ожидание
  `live-v2-assets` исправлено и прошло. Три оставшихся failures относятся к
  ранее зафиксированному CONV-2 baseline: два старых `ai-turn-context`
  утверждения уже не совпадали с кодом на Base SHA, а неизменённый
  `live-v2-context` test создаёт `undefined` fixture. Эти соседние дефекты не
  исправляются в runtime-removal diff.

Непроверено: реальные provider calls, staging/production, deploy, latency/load
и субъективное качество ответов. Платные вызовы не выполнялись.

Rollback: до публикации убрать только CONV-3 diff; после публикации выполнить
`git revert` отдельного CONV-3 commit. Миграция rollback требует вернуть
unique index только после проверки отсутствия нескольких runs на один inbound;
поэтому безопасный общий откат — revert приложения и отдельная согласованная
DB migration, а не ручной `DROP INDEX` в production.

Свежий Reviewer проверяет стабильный staged fingerprint. Автор изменений не
выдаёт verdict собственной работе.

Независимый Reviewer: `gpt-5.6-sol`, reasoning `low`, свежая read-only session
`019fd35a-b69e-7aa1-9823-3d90f79635fd`. Проверен fingerprint
`65c2488c23f65e6a3f324340bc973d4fc689b8aa94a691f77ca7348070d3a600`.
Блокирующих находок нет; verdict — `accept`. Reviewer подтвердил один direct
assembly, сохранение send gate/takeover и точный индексный контракт миграции
0021. Повторно тесты Reviewer не запускал и принял evidence Исполнителя.

### Stop-gate 2026-08-05

После перевода PostgreSQL runtime harness на реальный direct recorded pipeline
прошли `18/25` инвариантов. Один из семи failures выявил не тестовую механику,
а policy-разрыв: прежний production test требует, чтобы состояние `watching`
при `agentAllowedToReply=true` разрешало AI commit, тогда как
`liveV2GateSnapshotPlan` разрешает только `ai_collecting_info` и возвращает
`gate_closed` для `watching`.

Изменение gate является прямым изменением send-gate policy; удаление или
переписывание assertion скрыло бы изменение публично наблюдаемого поведения.
До явного решения владельца код gate и этот assertion не изменяются, commit и
push CONV-3 не выполняются. Остальные шесть failures относятся к ожидаемому
обновлению legacy-shaped evidence (`native_grounded` -> `native_recorded`),
удаляемому shadow comparator, новому fresh-context view и attempt-scoped run
evidence; их исправление также приостановлено после срабатывания stop-gate.

Решение владельца 2026-08-05: вариант 1. `watching` остаётся reply-capable,
если `agentAllowedToReply=true`; manager takeover по-прежнему переводит gate в
закрытое состояние. Реализация CONV-3 возобновлена с восстановлением этого
инварианта.

### Stop-gate schema 2026-08-05

После восстановления send-gate и переноса harness real PostgreSQL suite прошёл
`23/24`. Единственный failure воспроизводит reclaimed lease: attempt 1 остаётся
fenced без outbound, но attempt 2 не может начать recorded run и завершается
`ai_persistence_unconfirmed`.

Причина доказана текущей schema и кодом: CONV-2 создаёт attempt-scoped ключи
`ai-turn:<uuid>:attempt:<N>`, тогда как
`ai_runs_inbound_public_message_id_idx` остаётся `UNIQUE`. Второй run для того
же inbound конфликтует с индексом до model generation. Подмена ожидания скрыла
бы сломанный retry; повторное использование первого `running` run потребовало
бы другой, более сложной lease/replay архитектуры.

Минимальное рекомендуемое решение — owner-approved migration, заменяющая
уникальный inbound index обычным индексом при сохранении unique
`idempotency_key`. Это разрешит отдельную durable запись каждой попытки, не
меняя public contract. До решения владельца schema/migration не изменяются,
CONV-3 имеет `needs_evidence`, commit и push не выполняются.

Решение владельца 2026-08-05: выполнить эту точную миграцию, завершить срез,
разделить изменения на понятные русские коммиты, отправить их в удалённый
репозиторий и слить результат в `main`. Другие изменения schema не одобрены.
