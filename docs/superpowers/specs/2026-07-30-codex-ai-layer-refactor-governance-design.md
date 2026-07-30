# Design: управление Codex при рефакторинге AI-слоя

Status: design approved in discussion; implementation blocked until owner reviews this recorded spec

Date: 2026-07-30

Repo: `granit-operations`

Scope: coding-agent workflow for the future AI-layer refactor

Not runtime scope: customer-facing AI prompts, model policy, tools, or production enablement

## 1. Цель

Создать компактный и автоматически применяемый контракт, который управляет Codex
при будущем рефакторинге AI-слоя.

Контракт должен:

- удерживать один проверяемый scope за запуск;
- не позволять агенту самовольно расширять задачу;
- разделять архитектуру, реализацию, code-scout review и итоговый review;
- ограничивать объём production-diff;
- требовать воспроизводимые доказательства результата;
- не разрешать автору самостоятельно принять собственную работу;
- после технического результата проверять понимание владельца;
- блокировать следующий slice до закрытия технического и learning gate.

Будущая схема AI-слоя, которую предоставит владелец, будет отдельным входным
архитектурным контрактом. Этот документ не пытается заранее придумать или
реализовать её.

## 2. Почему нужен отдельный контракт

GPT-5.6 Sol способен уверенно вести длинные задачи, но его полезная инициативность
может перейти в лишние действия, повторные tool calls, широкий diff и продолжение
работы после достижения основного результата.

Обычного пожелания «не делай лишнего» недостаточно. Нужны наблюдаемые границы:

- один outcome;
- утверждённый touch set;
- измеримый completion bar;
- лимит production-diff;
- явные stop conditions;
- независимый review;
- запрет перехода к следующему slice.

При этом нельзя превращать системный prompt в длинный список повторяющихся
запретов. Постоянный контекст должен содержать только инварианты и маршруты к
детальным инструкциям.

## 3. Проверенные источники и границы применимости

### 3.1 Официальная документация OpenAI

Нормативные рекомендации для GPT-5.6 берутся из:

- [Prompting guidance for GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6);
- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model);
- [Multi-agent guide](https://developers.openai.com/api/docs/guides/responses-multi-agent);
- [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning);
- [Prompting Codex and ChatGPT](https://learn.chatgpt.com/docs/prompting);
- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md);
- [GPT-5.6 System Card](https://deploymentsafety.openai.com/gpt-5-6).

Подтверждённые выводы:

- prompt должен прежде всего задавать outcome, evidence, constraints, success
  criteria и stopping conditions;
- каждое постоянное правило следует формулировать один раз;
- `ALWAYS`, `NEVER`, `must` и `only` нужны только для настоящих инвариантов;
- повторяющиеся process/style instructions и нерелевантные tools стоит удалять;
- упрощение prompt надо проверять на собственных evals, а не считать
  универсальным улучшением;
- `text.verbosity` управляет формой текстового ответа, но не ограничивает объём
  кода или внутреннюю инициативность агента;
- reasoning effort повышают только после проверки на репрезентативных задачах;
- persisted reasoning полезен при стабильной цели, но устаревший reasoning может
  якорить модель на старом подходе;
- Multi-agent полезен для независимых bounded workstreams, но увеличивает расход
  токенов и coordination cost.

OpenAI приводит внутренний coding-agent eval, где более короткие system prompts
дали примерно `+10–15%` к eval score, `−41–66%` токенов и `−33–67%` стоимости.
Эти диапазоны являются направляющими результатами внутреннего eval, а не
гарантией для этого проекта.

### 3.2 Исследование Toloka

[Toloka: GPT-5.6 got smarter. Then it kept acting](https://toloka.ai/blog/gpt-5.6-got-smarter-then-it-kept-acting/)
сообщает результаты на 711 закрытых enterprise workflow tasks с проверкой
финального состояния БД.

Корректное прочтение чисел:

- Sol medium был примерно на `3.7` процентного пункта ниже GPT-5.5 medium;
- Terra medium был примерно на `8.7` процентного пункта ниже GPT-5.5 medium;
- рост exact duplicate tool calls был диапазоном, а `+8.5` п.п. — максимум для
  одного из сравнений, не универсальное значение Sol medium;
- attempted write-value reversal измерял паттерн `A -> B -> A`, но не доказывал,
  что `A` было правильным, а `B` промежуточным;
- рост extra records также был диапазоном, а не единым значением для всех
  конфигураций.

Это self-published company research, не peer-reviewed paper. Evidence package
содержит данные и scripts, но полные private tasks и raw trajectories не
публичны, поэтому независимая полная репликация невозможна.

System Card OpenAI отдельно показывает снижение `Avoidance only` с `0.88` для
GPT-5.5 до `0.83` для Sol. Это destructive-actions eval по сохранению
пользовательских изменений и данных, а не общий «индекс предотвращения опасных
команд».

Практический вывод для этого проекта: исследование поддерживает необходимость
явных stop rules и проверки конечного состояния, но не доказывает, что GPT-5.6
всегда хуже GPT-5.5.

### 3.3 Материалы Anthropic

Материалы Anthropic полезны как независимый источник принципов context
engineering:

- [The new rules of context engineering](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models);
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents);
- [Building verification loops](https://claude.com/blog/building-verification-loops-in-claude-code-with-skills);
- [A harness for every task](https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code).

Полезные общие идеи:

- корневой instruction-файл должен быть коротким router;
- подробности загружаются just in time;
- tests, types, runtime errors и project-specific checks образуют verification
  loop;
- большой disposable verification harness допустим, если production-diff
  остаётся узким;
- параллельная работа имеет смысл только при изолированных целях и состоянии.

Это guidance для Claude. Его нельзя автоматически переносить на GPT-5.6 без
проектных evals.

### 3.4 Предоставленное видео

[You're reading way too much code](https://www.youtube.com/watch?v=434cG4g5KLE)
является авторским опытом, а не исследованием.

Используемый инженерный вывод:

- можно дешёво генерировать disposable debuggers, linters, test harnesses и
  конкурирующие prototypes;
- такие эксперименты должны быть изолированы от production-кода;
- большой verification-diff не является разрешением на большой production-diff;
- production-код всё равно требует чтения, тестов и review.

История про 10 000 строк JavaScript не используется как количественный норматив.

## 4. Текущий repo baseline

На момент исследования:

- `main == origin/main == ee77a35`;
- пользовательский `output/` является untracked и не входит в scope;
- последний merge вернул значительную часть старого Mastra/live-v2 слоя;
- `docs/tasks/RECONCILE_REMAINING_BRANCHES_RU.md` ранее пометил этот runtime как
  `superseded` и запретил переносить его как primary orchestration;
- accepted `ADR-010` оставляет primary AI runtime app-owned;
- в migrations одновременно присутствуют дубли номеров `0010`, `0011` и `0012`;
- существует `0016_widget_ai_jobs.sql`, хотя часть документации всё ещё говорит,
  что следующая migration должна начинаться с `0016`;
- boundary test статически запрещает Mastra/live-v2 references вне узких optional
  integration paths.

Это означает, что первая техническая задача будущего рефакторинга должна быть
baseline reconciliation, а не реализация новой архитектуры.

Reconciliation обязан:

1. проверить код, docs, ADR, migrations и tests на одном SHA;
2. определить authoritative runtime;
3. отделить актуальную реализацию от legacy/superseded paths;
4. получить зелёный и воспроизводимый baseline;
5. только после этого разрешить следующий архитектурный slice.

Эта design spec не выполняет reconciliation и не утверждает заранее способ его
исправления.

## 5. Структура будущего governance package

### 5.1 Корневой `AGENTS.md`

Короткий автоматически загружаемый router.

Он содержит только:

- authority order;
- обязательный порядок чтения;
- правило одного slice;
- запрет subagents, Terra и Ultra;
- запрет самовольного scope expansion;
- обязательные review и learning gates;
- ссылки на playbook и slice template.

Он не копирует подробные архитектурные, model-specific или teaching
инструкции.

### 5.2 `docs/AI_AGENT_REFACTOR_PLAYBOOK_RU.md`

Подробный рабочий playbook:

- evidence audit и model guidance;
- lifecycle slice;
- model/role routing;
- self-tasking contract;
- scope и diff budgets;
- validation и evidence;
- code-scout и independent review;
- repair flow;
- teach-back protocol;
- stop/escalation rules.

### 5.3 `docs/tasks/AI_REFACTOR_SLICE_TEMPLATE_RU.md`

Шаблон конкретной задачи:

- status;
- base/head SHA;
- authoritative inputs;
- outcome;
- alternatives and decision;
- success criteria;
- scope/out-of-scope;
- expected touch set;
- change budget;
- roles/models;
- checks and evidence;
- findings and repair rounds;
- teach-back checklist;
- next-slice candidate.

Будущая архитектурная схема владельца хранится отдельной spec/ADR/task записью и
ссылается из конкретного slice. Она не встраивается целиком в `AGENTS.md`.

## 6. Authority order

Внутри repo-level guidance более новый и более конкретный accepted контракт
выше исторического документа:

1. текущая явная задача владельца;
2. отдельно одобренная архитектурная spec владельца;
3. accepted ADR и active source-of-truth;
4. одобренный task contract текущего slice;
5. AI refactor playbook;
6. historical tasks, plans и release evidence.

Исторический документ не становится active только из-за слова `active`,
`implemented` или `passed`. Агент сверяет дату, SHA, code и accepted ADR.

Если code, task, ADR и docs противоречат друг другу, агент не выбирает удобную
версию молча. Он фиксирует конфликт и останавливается на reconciliation или
owner decision.

## 7. Жизненный цикл одного slice

```text
baseline_checked
  -> slice_proposed
  -> scope_approved
  -> implementing
  -> technical_done
  -> code_scout_done
  -> independent_review
      -> needs_fix -> repairing -> technical_done
      -> needs_redesign -> slice_proposed
      -> accept
  -> teaching
  -> understanding_verified
  -> stopped
```

Правила:

- одновременно активен только один slice;
- один запуск выполняет только одну роль;
- следующий slice не начинается автоматически;
- обнаруженная соседняя работа записывается как candidate next slice;
- `technical_done` не означает `accepted`;
- `accept` review не означает `understanding_verified`;
- только `understanding_verified` закрывает slice;
- после закрытия агент останавливается.

Пауза разрешена на любом этапе. Пауза не переводит задачу в accepted и не
разблокирует следующий slice.

## 8. Последовательные роли и модели

Subagents, Terra и Ultra запрещены.

Для Architect, Code Scout, Reviewer и Teacher термин `read-only` означает запрет
на изменение production code, runtime config, migrations, tests и product docs.
Им разрешено обновлять только заранее назначенный task record, review report или
teach-back checklist текущего slice. Точные report paths входят в approved touch
set.

### 8.1 Architect: GPT-5.6 Sol

Режим: отдельный read-only запуск, baseline `reasoning=medium`.

Обязан:

- проверить текущий baseline;
- найти source-of-truth conflicts;
- сформулировать один outcome;
- предложить 2–3 реальных варианта для архитектурной развилки;
- сравнить diff, migration risk, failure modes, rollback и evidence;
- рекомендовать один вариант;
- подготовить slice contract.

Для механической задачи не требуется искусственно придумывать альтернативы.
Architect должен объяснить, почему реальной развилки нет.

Architect не пишет production-код.

`high` или `xhigh` допустимы только для сложной архитектуры, security,
failure-mode анализа или reviewer pass, когда дополнительный расход оправдан.
`max` не является default.

### 8.2 Implementer: GPT-5.5 xhigh

Режим: отдельный запуск после approval.

Обязан:

- реализовать только утверждённый task contract;
- не менять архитектуру по ходу работы;
- не выходить за touch set и change budget;
- запускать предусмотренные проверки;
- остановиться после `technical_done`;
- записать evidence и непроверенные области.

Если во время реализации появляется новая архитектурная развилка, Implementer
не выбирает её. Он останавливается и возвращает задачу Architect.

### 8.3 Code Scout: GPT-5.4 high

Режим: свежий read-only запуск после `technical_done`.

Ищет по коду то, что могли пропустить Architect и Implementer:

- callers, usages и скрытый blast radius;
- legacy, duplicate и альтернативные runtime paths;
- idempotency, retry, concurrency и failure-path ошибки;
- слабые, ложно-зелёные или отсутствующие tests;
- module-boundary и public-contract нарушения;
- dead code, type incompatibilities и migration conflicts;
- PII/secrets exposure и небезопасное logging.

Каждая находка содержит:

- файл и точную локацию;
- наблюдаемое доказательство;
- последствие;
- способ воспроизведения или проверки;
- confidence и неизвестные.

Code Scout не редактирует код. Он может записать findings только в назначенный
review report или task record, не принимает архитектурные решения и не объявляет
slice принятым.

### 8.4 Reviewer: GPT-5.6 Sol

Режим: свежий read-only запуск.

Вход:

- approved task contract;
- base/head SHA;
- diff;
- authoritative docs/ADR;
- validation evidence;
- code-scout report.

Reviewer сначала делает собственный проход, затем проверяет code-scout findings.
Отчёт Implementer и Code Scout считается утверждением, а не доказательством.

Reviewer обязан составить affected-surface map:

- modules, interfaces and dependencies;
- DB, migrations and state ownership;
- runtime behavior and failure behavior;
- prompts, tools, model config and policies;
- privacy, send gate and manager controls;
- tests, evals and observability;
- deploy, rollback and release evidence;
- cross-repo consumers.

Вердикт:

- `accept`;
- `needs_fix`;
- `needs_evidence`;
- `needs_redesign`;
- `needs_human_decision`.

Reviewer не исправляет код.

### 8.5 Repair: GPT-5.5 xhigh

Repair является новым запуском внутри того же slice ID.

Он исправляет только подтверждённые findings внутри прежнего scope. Если finding
требует расширения scope, создаётся новый proposal и текущий repair
останавливается.

После repair повторяются Code Scout и Reviewer в объёме, соответствующем
изменившемуся blast radius.

По умолчанию разрешён один repair run. Второй repair требует нового approval и
обновлённого change budget. Повтор той же категории дефекта после repair
переводит slice в `needs_redesign` или `needs_human_decision`.

### 8.6 Teacher: GPT-5.6 Sol

Teacher является отдельным read-only запуском после reviewer verdict `accept`.

Он получает task contract, accepted diff, reviewer verdict и teach-back
checklist. Teacher не меняет код, не переоткрывает принятый review без нового
доказательства и не начинает следующий slice.

## 9. Контракт самостоятельной постановки задачи

Codex создаёт slice в следующем порядке:

1. `Outcome`: один видимый результат.
2. `Authoritative inputs`: code, spec, ADR, task and evidence.
3. `Baseline`: SHA, dirty state and known contradictions.
4. `Success criteria`: что должно быть истинно.
5. `Scope`: разрешённые изменения.
6. `Out of scope`: явные соседние задачи.
7. `Expected touch set`: файлы, модули и contracts.
8. `Change budget`: production files и production LOC.
9. `Allowed actions`: reads, writes, tests and prototypes.
10. `Validation`: targeted tests, typecheck/build, evals and smoke.
11. `Role sequence`: model for each sequential pass.
12. `Evidence`: required artifacts and checks.
13. `Stop/escalation rules`: когда остановиться или вернуть решение владельцу.
14. `Teach-back checklist`: что владелец должен понять.

Task contract сначала получает approval. Реализация не начинается в том же
сообщении, где впервые предложена новая архитектурная развилка.

## 10. Scope и change budget

Перед implementation фиксируются:

- точный список ожидаемых production files;
- допустимые test/docs/harness paths;
- максимальное число production files;
- ориентир добавленных/изменённых production LOC;
- ожидаемый blast radius.

Hard stop:

- нужен неутверждённый module/file;
- production diff превысил ориентир более чем на 50%;
- возникло незаявленное изменение DB, public contract, prompt, tool, model
  config, privacy, send gate или cross-repo consumer;
- новая архитектурная развилка появилась во время implementation;
- тесты показывают необходимость соседнего рефакторинга;
- success criteria уже доказаны.

Порог LOC не заменяет инженерное решение. Большое удаление, generated artifacts
или механический move оцениваются по touched surfaces и риску, а не только по
net diff.

## 11. Правила минимальности

- Bug fix начинается с теста, воспроизводящего дефект.
- Высокорисковая гипотеза сначала проверяется isolated disposable prototype или
  harness.
- Disposable code не попадает в production без отдельного решения.
- Большой verification harness не оправдывает большой production-diff.
- Speculative abstractions, broad cleanup и массовые rename «заодно» запрещены.
- Новая dependency требует отдельного justification и approval, если её не было
  в task contract.
- После достижения success criteria дополнительная полировка запрещена.
- Завершённый tool call не повторяется без нового основания.
- Empty или partial retrieval допускает один-два осмысленных fallback, после
  чего фиксируется missing evidence.
- Transient operation retry ограничивается task contract.

## 12. Validation и evidence

До `technical_done` обязательны:

- targeted tests changed behavior;
- relevant typecheck/lint;
- affected package build;
- relevant boundary tests;
- applicable offline evals;
- minimal smoke, если он не требует external or paid action;
- `git diff --check`;
- полный `git diff --stat`;
- полный список touched files;
- base/head SHA;
- список непроверенных областей;
- rollback или безопасный способ отказаться от изменения.

Paid live eval, staging/prod writes, migrations, secrets/config changes и другие
review-required actions всё ещё требуют отдельного owner approval.

Отсутствие возможности запустить check не превращается в pass. Статус становится
`needs_evidence`.

## 13. Teach-back gate

После `accept` запускается отдельная роль Teacher. Код больше не меняется.

Живой Markdown checklist хранится в task record текущего slice и содержит:

- проблема и причина;
- реальные развилки;
- выбранное решение и причина выбора;
- ключевые project decisions;
- material edge/failure cases;
- evidence и способы проверки;
- broader context и downstream impact;
- граница следующего slice.

Протокол:

1. Сначала попросить владельца своими словами пересказать понимание slice.
2. Найти пробелы по checklist.
3. Задавать ровно один вопрос за раз.
4. Использовать открытые вопросы или варианты ответа.
5. Не раскрывать правильный ответ до ответа владельца.
6. При необходимости показать код, test, trace или debugger workflow.
7. Объяснять `why`, затем проверять `what` и `how`.
8. Разрешить команды `проще`, `как для пятилетнего`, `как для
   четырнадцатилетнего`, `как для стажёра`, `пауза` и `дай recap`.

`AskUserQuestion` используется, когда он доступен в текущем режиме. В остальных
режимах задаётся один обычный вопрос в чате.

### 13.1 Измеримый completion bar

`understanding_verified` возможен, только если владелец на деле:

1. объяснил причину проблемы и ключевую развилку;
2. обосновал выбранное решение против главной альтернативы;
3. разобрал минимум один material edge/failure case;
4. назвал evidence и сигнал, который опроверг бы корректность;
5. объяснил downstream impact и границу следующего slice.

Модель не использует субъективное «я убедилась» как единственный критерий.

Если persistent goal mechanism доступен и явно включён для teach-back, goal
остаётся активным до completion bar. Пользователь может поставить сессию на
паузу, но следующий slice остаётся blocked.

Learning checklist отражает состояние сессии, а не product source of truth.
Детальные human-knowledge notes создаются только после явной просьбы владельца
зафиксировать конкретное знание.

## 14. Failure behavior

- Source-of-truth conflict -> `needs_human_decision` или reconciliation.
- Missing evidence -> `needs_evidence`.
- Scope growth -> stop and new proposal.
- Review finding inside scope -> repair run.
- Review finding outside scope -> next-slice candidate.
- Architectural flaw -> `needs_redesign`, без repair по месту.
- Required model unavailable -> `needs_human_decision`, без автоматической
  подмены модели.
- User pause during teaching -> `teaching_paused`, next slice blocked.
- Completion bar passed -> `understanding_verified`, then stop.

## 15. Отклонённые альтернативы

### Один большой `AGENTS.md`

Отклонён: автоматически применяется, но раздувает постоянный context и
увеличивает риск повторов и конфликтов.

### Только `docs/AGENT_WORKFLOW.md`

Отклонён: меньше файлов, но Codex не обязан автоматически загрузить его до
начала работы.

### Subagents / Terra / Ultra

Отклонены решением владельца. Работа идёт последовательными свежими запусками с
явным разделением ролей.

### Один агент реализует и принимает собственную работу

Отклонён: self-review полезен как check, но не заменяет независимый свежий
review pass.

### Автономно выполнить весь refactor plan

Отклонён: разрешён только один slice, затем review, teach-back и stop.

### Бесконечный teaching loop по субъективному ощущению модели

Отклонён: сохранён строгий learning gate, но конец определяется наблюдаемым
completion bar. Пауза не равна принятию.

## 16. Acceptance criteria governance package

Будущая реализация этой design spec считается готовой, если:

- root `AGENTS.md` короткий и автоматически маршрутизирует к деталям;
- playbook содержит только недублирующиеся operational rules;
- slice template делает scope, budget, roles, evidence и learning gate
  обязательными;
- ни один файл не разрешает subagents, Terra или Ultra;
- один run не совмещает implementation и acceptance review;
- next slice нельзя начать до `understanding_verified`;
- historical docs не могут молча переопределить accepted source of truth;
- есть проверяемые scenarios для scope expansion, diff overflow, missing
  evidence, code-scout finding, repair и teaching pause;
- current runtime code, prompts, tools, model config и production state не
  меняются.

## 17. Out of scope

- Реализация будущей архитектуры AI-слоя.
- Исправление текущего Mastra/live-v2 baseline.
- Изменение runtime prompts, policies, tools или model settings.
- Создание migrations.
- Запуск paid live eval.
- Staging или production actions.
- Автоматическая смена модели внутри запуска.
- Subagents, Terra и Ultra.

## 18. Следующий шаг

После owner review этой записанной spec:

1. исправить замечания, если они есть;
2. составить узкий implementation plan только для governance package;
3. реализовать `AGENTS.md`, playbook и slice template;
4. проверить instruction routing и scenario coverage;
5. остановиться и передать governance package в review.

Actual AI-layer reconciliation и новая архитектура остаются отдельными будущими
slices.
