# Goal: AI Runtime Convergence и очистка репозитория

Статус: `implementing`; Goal запущена 2026-08-04. Обязательный
current-main repair PR2 получил свежий independent `accept` и опубликован
в `origin/main` commit `ca1cdb798829674e40b4eab7e4e948476e71d61c`. CONV-1
получил свежий independent `accept` и опубликован в `origin/main` commit
`aff347bb00d07f8ee40f86203bd27a6a99b5b40f`. Активный срез — CONV-2,
остановленный до рабочего кода на обязательном owner stop-gate точного output
contract.

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

Текущий код содержит архитектурный разрыв:

```text
direct_openai       -> legacy_s05
mastra_openai_api   -> live_v2
```

Mastra не владеет очередью, состоянием, send gate или persistence, поэтому не
даёт уникальной системной возможности. Но live-v2 generator и часть проверок
пока подключены через Mastra-mode. Простое удаление dependency уничтожит
современный path вместе с ненужной оболочкой.

В документации repo-local source of truth уже принят, но active task index всё
ещё содержит много завершённых S01-S15, AI_DIALOG и Mastra-планов. Git history,
release evidence и accepted ADR должны сохранить provenance без превращения
всех старых планов в обязательный контекст новой сессии.

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

После independent `accept` автоматически перейти к CONV-4.

### CONV-4: Active documentation reduction

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

Один результат: CI/local architecture checks блокируют возврат второго runtime
и разрастание активной AI-документации.

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

Создание этой карточки не снимает перечисленные стоп-гейты. При запуске Goal
владелец может отдельно одобрить точный CONV-1 scope. CONV-2 всё равно требует
точного решения по output contract до рабочего кода. Commit и обычный push
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
- App-owned observability остаётся sanitized source of truth.
- Активная документация компактна и repo-local.
- Guardrails предотвращают повторное появление dual runtime и active-doc sprawl.
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
docs/AGENT_WORKFLOW.md, ADR-012, owner architecture docs, minimal Goal
governance и эту Goal-карточку. Зафиксируй фактические HEAD/origin/main, dirty
worktree и baseline callers. Не меняй код до компактной карточки CONV-1.

Начни только CONV-1: direct live-v2 adapter parity без runtime cutover, prompt,
model, policy, schema, public contract, deploy или платного model call. После
technical_done остановись для свежего независимого Reviewer. Commit/push только
после independent accept по publish-протоколу Goal; отдельное поручение для
каждого accepted-среза не требуется. Force-push и deploy запрещены.
```
