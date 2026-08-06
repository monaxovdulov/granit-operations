# Goal: AI Runtime Convergence и очистка репозитория

Статус: `teaching`; все технические срезы приняты и опубликованы, ожидается
обязательный общий owner teach-back. Goal запущена 2026-08-04. Обязательный
current-main repair PR2 получил свежий independent `accept` и опубликован
в `origin/main` commit `ca1cdb798829674e40b4eab7e4e948476e71d61c`. CONV-1
получил свежий independent `accept` и опубликован в `origin/main` commit
`aff347bb00d07f8ee40f86203bd27a6a99b5b40f`. CONV-2 получил свежий
independent `accept` и опубликован в `origin/main` commit
`4d567d8acfef3718d92358c3980430539aea367d`. Владелец одобрил точную migration
для attempt-scoped retry. CONV-3 получил независимый `accept` и опубликован в
commit `8122a8ef44568d6b97dccee54dee074c4a1c4733`. Владелец выбрал более
системную модель logical run + child attempt ledger и явно вставил CONV-3A
перед CONV-4. CONV-3A получил пятый independent `accept` и опубликован в
`origin/main` commit `e4cfe371a96ff5a7a3262c19c02776a36d979936`.
CONV-4 получил третий independent `accept` и опубликован в `origin/main` commit
`d3f9cbd2213ec60bba3953c43f212aa307fd8175`.
CONV-5 получил independent `accept` без замечаний и опубликован в `origin/main`
commit `e86ce2d908d32adb538b060af698df7f8ae88268`.

Goal ID: `AI-RUNTIME-CONVERGENCE`.

Репозиторий: `granit-operations`.

Фактический стартовый SHA: `29dd8c15e4fc4459af51b7f26b49b339c4f15fb2`
(`HEAD == origin/main` на старте; единственный исходный untracked path —
пользовательский `output/`, он не изменяется).

## 1. Цель

Привести AI-слой и активную документацию к одному понятному контуру:

```text
один app-owned runtime
один direct model boundary
один provider-neutral turn contract
одна активная AI-карточка
один repo-local маршрут документации
```

Финальное наблюдаемое состояние:

- `direct_openai` обслуживает новый provider-neutral live-v2/PR3 pipeline;
- PostgreSQL queue, latest-wins, fresh context, commit fence, send gate и
  manager takeover остаются app-owned;
- Mastra runtime, dependency, mode, env и production assembly удалены;
- executable `legacy_s05` path удалён после доказанной parity;
- завершённые и дублирующие task/design документы не засоряют активный маршрут;
- автоматические guardrails не дают вернуть второй runtime или несколько
  одновременно активных AI-планов.

## 2. Почему Goal нужна

Следующее описание фиксирует историческое состояние на старте Goal, до
принятых CONV-1—CONV-3A; это не описание current runtime после commit
`e4cfe371a96ff5a7a3262c19c02776a36d979936`:

```text
direct_openai       -> legacy_s05
mastra_openai_api   -> live_v2
```

В том baseline Mastra не владел очередью, состоянием, send gate или persistence
и не давал уникальной системной возможности, но live-v2 generator и часть
проверок были подключены через Mastra-mode. CONV-1—CONV-3 закрыли этот разрыв:
current runtime один, direct и app-owned; Mastra dependency/runtime и executable
`legacy_s05` удалены.

До CONV-4 active task index всё ещё содержал много завершённых S01-S15,
AI_DIALOG и Mastra-планов. Git history, release evidence и accepted ADR должны
сохранить provenance без превращения всех старых планов в обязательный контекст
новой сессии.

## 3. Источники истины

Приоритет при выполнении:

1. `docs/adr/ADR-012-REPO_LOCAL_AI_SOURCE_OF_TRUTH_RU.md`;
2. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`;
3. `docs/architecture/AI_LIVE_AGENT_REFACTOR_OWNER_SPEC_RU.md`;
4. `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`;
5. `docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md`;
6. эта Goal и активная карточка текущего среза;
7. current code, contracts, migrations и tests на фактическом base SHA.

Текущий код определяет фактическое поведение. Owner docs определяют целевую
архитектуру. Расхождение фиксируется как gap и закрывается отдельным срезом.

## 4. Неподвижные ограничения

- Одновременно изменяется только один срез.
- Каждый срез имеет один наблюдаемый результат и отдельимый diff/commit.
- Исполнитель не принимает собственную работу.
- После каждого технического среза нужен свежий независимый Reviewer.
- Субагенты, Multi-agent, Terra и Ultra запрещены.
- Соседние улучшения записываются в следующий срез и не выполняются сразу.
- После выполнения критериев успеха дополнительная полировка запрещена.
- Владелец заранее разрешил отдельный commit и push каждого существенного
  accepted-среза этой Goal по протоколу из раздела 8.
- Merge конфликтов, force-push и deploy этим разрешением не покрываются.
- Production activation, secrets и платные model calls не входят в Goal.

## 5. Предварительный baseline

До первого изменения новая сессия должна зафиксировать:

- `git status --short --branch`;
- `git rev-parse HEAD` и `git rev-parse origin/main`;
- фактический список Mastra и legacy_s05 production callers;
- package/runtime/env references;
- direct и live-v2 assembly graph;
- текущие queue, cancellation, takeover, atomic commit и replay tests;
- статус independent evidence PR2;
- полный список active и historical AI docs.

Если PR2 всё ещё не имеет независимого evidence, Reviewer сначала проверяет
его current-main состояние. Это не разрешает смешивать repair PR2 с CONV-1.

## 6. Порядок срезов

### CONV-1: Direct live-v2 adapter parity

Один результат: существующий live-v2 pipeline может выполнить тот же bounded
model turn через прямой OpenAI adapter без Mastra и без изменения публичного
поведения.

Разрешено:

- provider-neutral port для live-v2 generation;
- прямой OpenAI implementation;
- structured output, timeout, cancellation, no-retry и sanitized observation;
- перенос существующих adapter tests на direct boundary;
- dependency injection, позволяющий сравнить direct и текущий Mastra adapter.

Запрещено в этом срезе:

- переключение production/default runtime;
- удаление Mastra или legacy_s05;
- изменение prompt, model, policy, send gate, public contract или schema;
- новая DB migration;
- deploy или реальный платный model call.

Критерии:

- direct adapter принимает тот же provider-neutral input;
- возвращает тот же валидируемый candidate/observation contract;
- cancellation и timeout не обходят app-owned commit fence;
- raw provider errors, prompts и secrets не попадают в persistence/logs;
- существующий Mastra path остаётся rollback comparator до accept.

После independent `accept` автоматически перейти к CONV-2.

### CONV-2: PR3 turn contract и direct cutover

Один результат: default direct runtime проходит единый pipeline
`ModelTurnOutput -> ValidatedTurnPlan -> CommittedTurn`, а итоговый клиентский
текст не переписывается legacy renderer после validation.

Owner decision от 2026-08-05: полный baseline CONV-2 и предыдущие развилки
утверждены; целевая модель — `gpt-5.6-luna` с
reasoning `medium` вместо ранее предложенной `gpt-5.6-sol`. Это рабочая гипотеза
владельца, а не утверждение о доказанно лучшем качестве. Официальная карточка
подтверждает model ID, Responses API и Structured Outputs, но позиционирует Luna
как вариант для экономичных высоконагруженных сценариев:
<https://developers.openai.com/api/docs/models/gpt-5.6-luna>. Отдельный длинный
слой проверок из-за этой замены не добавляется; применяются обычные критерии
приёмки CONV-2, без неявной подмены на Sol.

Retired compact card и publication provenance перечислены в
`docs/tasks/ARCHIVE_RU.md`.

Разрешено после отдельного owner stop-gate для точного output contract:

- новый model output schema;
- deterministic validation и approved state mutations;
- direct runtime cutover с legacy_s05 на новый pipeline;
- exact failure/fallback semantics;
- перенос queue/takeover/replay/eval tests на новый путь.

Не разрешено автоматически:

- изменение бизнес-policy, privacy, manager takeover или send gate;
- новая модель или reasoning profile;
- tools/retrieval v2 из будущего PR5;
- state corrections/retractions из будущего PR4 сверх contract seam;
- production activation.

Критерии:

- один authoritative final text проходит validation и atomic commit;
- direct path выдерживает burst, stale lease, newer inbound и takeover races;
- нет implicit fallback в legacy_s05 или Mastra;
- rollback явно возвращает предыдущий direct path до удаления в CONV-3.

После independent `accept` автоматически перейти к CONV-3.

### CONV-3: Mastra и executable legacy removal

Retired compact card и publication provenance перечислены в
`docs/tasks/ARCHIVE_RU.md`.

Owner decision 2026-08-05: состояние `watching` остаётся reply-capable при
`agentAllowedToReply=true`; явный manager takeover закрывает send gate.

Owner decision 2026-08-05: unique индекс
`ai_runs_inbound_public_message_id_idx` заменить обычным индексом, сохранив
unique `ai_runs_idempotency_key_idx`. Это разрешает отдельную durable запись
каждой lease attempt. Другие schema changes этим решением не разрешены.

Один результат: production tree содержит один direct runtime без executable
Mastra и legacy_s05 paths.

Кандидаты на удаление после подтверждения callers:

- `@mastra/core` и transitive package-lock surface;
- `mastra_openai_api`, Mastra env/config и runtime assembly;
- `mastra-live-v2-decision-generator.ts` и Mastra-only tests;
- legacy_s05 services/profile/orchestrator/renderer/ports без remaining callers;
- compatibility exports, которые не имеют подтверждённого consumer.

Сохранить:

- app-owned PostgreSQL queue/repositories/worker;
- latest-wins, fresh context и response-window identity;
- provider-neutral live-v2/PR3 contracts;
- validator, approved assets и полезные synthetic fixtures;
- send gate, manager takeover, observability sanitizer и exact failure tests.

Критерии:

- package files не содержат `@mastra/core`;
- production code не содержит `mastra_openai_api` и executable legacy_s05;
- runtime selector удалён, если после cleanup остаётся ровно один mode;
- tests не становятся зелёными из-за удаления assertions;
- direct rollback описан на уровне предыдущего accepted commit.

После independent `accept` автоматически перейти к CONV-3A.

### CONV-3A: Logical run и durable attempt ledger

Retired compact card и publication provenance перечислены в
`docs/tasks/ARCHIVE_RU.md`.

Owner decision 2026-08-05: минимальная модель из migration `0021`, где каждая
lease attempt является отдельным `ai_run`, заменяется versioned двухуровневой
моделью для новых записей:

```text
ai_runs          -> один логический response window / итог хода
ai_run_attempts  -> физические lease/model attempts, включая failed/fenced
```

Разрешено:

- новая repo-local migration/schema для child attempt ledger и winning linkage;
- раздельные logical-run/attempt repository contracts;
- atomic attempt/run/outbound/job completion;
- upgrade/read compatibility, PostgreSQL concurrency и migration tests.

Не разрешено:

- эвристическое destructive объединение исторических runs;
- public contract, prompt/model/tools/policy/privacy/send-gate/takeover changes;
- deploy, внешнее применение migration, secrets или платный provider call;
- смешивание с CONV-4 documentation cleanup.

Критерии:

- один logical run переживает retries и имеет максимум одну winning attempt;
- stale worker завершает только свою attempt как fenced и не пишет outbound;
- retry/max-attempt/replay не оставляют необъяснимый logical `running`;
- review/eval/manager linkage остаётся стабильным по `ai_run_id`;
- fresh/upgrade migrations, real PostgreSQL races, typecheck/build и независимый
  Code Scout проходят.

После independent `accept` автоматически перейти к CONV-4.

### CONV-4: Active documentation reduction

Retired compact card и publication provenance перечислены в
`docs/tasks/ARCHIVE_RU.md`.

Один результат: новый агент получает обязательный AI-контекст из небольшого
repo-local набора, а история остаётся доступной без участия в active routing.

Оставить активными:

- `README.md`;
- `docs/source-of-truth.md`;
- ADR-010 и ADR-012;
- два current owner architecture documents;
- minimal Goal governance и playbook;
- одну текущую `AI_REF_*` карточку.

Сохранить как provenance:

- accepted ADR;
- release evidence;
- документы с уникальными owner decisions или доказательствами.

Удалить из текущего дерева или свести к компактному archive index:

- завершённые task plans, полностью продублированные ADR/evidence;
- старые S01-S15 routing docs, которые больше не задают порядок;
- AI_DIALOG_MASTRA планы после удаления runtime;
- повторяющиеся architecture обзоры без уникального решения.

Перед удалением каждого документа проверить inbound links и перенести уникальные
решения в accepted ADR/source map. Git history считается достаточным хранилищем
для полностью дублирующего provenance.

Критерии:

- `AGENTS.md` и README ведут только по active набору;
- `docs/tasks/README.md` явно показывает одну active AI-card;
- active docs не требуют внешний planning repo;
- broken repo-local links отсутствуют;
- evidence и accepted decisions не потеряны.

После independent `accept` автоматически перейти к CONV-5.

### CONV-5: Anti-clutter guardrails

Точная compact card реализации:
`docs/tasks/AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md`.

Один результат: repo-local architecture check, когда его запускает обычный
`build`/CI entrypoint, блокирует возврат второго runtime и разрастание активной
AI-документации. Неизменяемое внешнее принуждение самого entrypoint относится к
CI/branch-protection конфигурации и не входит в этот repo-local срез.

Guardrails:

- не более одной AI-card со статусом `implementing`/`independent_review`;
- active docs не ссылаются на retired external planning authority;
- production code не импортирует `@mastra/core`;
- отсутствуют альтернативные runtime selectors без accepted ADR;
- compatibility export требует явного consumer или accepted ADR;
- удаление tests не может заменить migration/concurrency/send-gate evidence.

Goal завершается только после independent `accept` CONV-5 и общего teach-back.

## 7. Стоп-гейты

Немедленно остановиться для owner decision, если требуется:

1. изменить этот порядок срезов или ownership;
2. изменить DB schema/migration либо public contract;
3. изменить prompt, model, reasoning, tools, AI-policy, privacy, send gate или
   manager takeover;
4. включить runtime, использовать secrets, сделать платный внешний вызов,
   deploy или изменить другой repo.

Исторические owner gates CONV-1—CONV-3 уже разрешены и приняты. Владелец
отдельно разрешил architecture/roadmap/schema scope точной карточки CONV-3A.
Остальные перечисленные стоп-гейты сохраняются. Commit и обычный push
accepted-срезов в `origin/main` уже одобрены; force-push не одобрен.

## 8. Commit и push protocol

Каждый `CONV-*` является существенным отдельимым куском и публикуется отдельно:

1. Исполнитель завершает только текущий срез и фиксирует evidence.
2. Свежий независимый Reviewer выдаёт `accept` либо возвращает срез в repair.
3. Repair не смешивается со следующим срезом и проходит повторный review.
4. После `accept` создать отдельный commit с ID среза в сообщении, например
   `AI convergence CONV-1: direct live-v2 adapter`.
5. Перед публикацией выполнить `git fetch origin main` и убедиться, что
   интеграция актуального `origin/main` не требует неразрешённого решения.
6. Отправить accepted commit в `origin/main` обычным fast-forward/merge push.
7. Force-push, переписывание опубликованной истории и `--no-verify` запрещены.
8. Зафиксировать commit SHA, итоговый remote `main` SHA и push result в карточке
   среза до автоматического перехода к следующему `CONV-*`.

Если `main` разошёлся, merge/rebase конфликтует или branch protection требует
PR, остановиться и выбрать безопасный publish path без обхода review.

Мелкие repair-коммиты допустимы только внутри текущего среза. Несвязанные
изменения не включаются. `output/`, локальные архивы, secrets и generated
artifacts не коммитятся.

## 9. Общая evidence

Для каждого технического среза обязательны:

- base/head SHA;
- полный file list и `git diff --stat`;
- AST/caller audit production и test paths;
- targeted tests;
- applicable real PostgreSQL concurrency/migration evidence;
- typecheck и build;
- architecture/boundary checks;
- `git diff --check`;
- непроверенные области и rollback;
- свежий independent Reviewer verdict.

Невыполненная обязательная проверка означает `needs_evidence`, не `accept`.

## 10. Финальный Definition of Done

- Один app-owned direct runtime обслуживает widget AI.
- Mastra dependency/runtime/config отсутствуют.
- Executable legacy_s05 path отсутствует.
- Public intake не ждёт model call и работает через durable queue.
- Latest-wins, fresh context, cancellation, commit fence и takeover доказаны.
- Model output, validated plan и committed turn разделены явными контрактами.
- Logical AI run отделён от физических retry/lease attempts; stale attempt не
  может стать победителем или оставить неоднозначный итог.
- App-owned observability остаётся sanitized source of truth.
- Активная документация компактна и repo-local.
- Guardrails предотвращают повторное появление dual runtime и active-doc sprawl
  внутри проверяемого build boundary; защита самого invocation boundary требует
  отдельной внешней CI/branch-protection настройки.
- Нет production deploy/activation без отдельного owner approval.

## 11. Rollback Goal

Каждый срез откатывается отдельным commit revert до последнего independent
`accept`. Нельзя использовать один общий rollback, возвращающий одновременно
runtime, legacy code и удалённые документы.

До CONV-3 Mastra/legacy остаются rollback comparator. После их удаления rollback
идёт на accepted commit CONV-2, а не через ручное восстановление отдельных
файлов.

## 12. Prompt для новой сессии

```text
Запусти Goal AI-RUNTIME-CONVERGENCE по
docs/tasks/AI_RUNTIME_CONVERGENCE_GOAL_RU.md.

Сначала прочитай AGENTS.md, README.md, docs/source-of-truth.md,
docs/AGENT_WORKFLOW.md, AI refactor playbook, minimal Goal governance, ADR-012,
owner architecture docs, эту Goal и
docs/tasks/AI_REF_CONV_5_ANTI_CLUTTER_GUARDRAILS_RU.md.

Фактическая опубликованная база передачи:
d3f9cbd2213ec60bba3953c43f212aa307fd8175. Сначала заново проверь
HEAD/origin/main, dirty tree, package/build/architecture checks и active-doc
routes; `output/` не трогай. Продолжи только CONV-5 по точной карточке. Не
изменяй production behavior, schema/migrations/public contract,
prompt/model/tools/policy/privacy/send gate/takeover, deploy или внешние repo.

После technical_done остановись для свежего независимого Reviewer. Только
после independent `accept` сделай понятный русский commit и обычный push;
затем проведи общий teach-back. Субагенты/Multi-agent/Terra/Ultra, force-push и
deploy запрещены.
```
