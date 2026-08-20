# Черновой пакет: упрощение AI-слоя

Статус: `draft_unreconciled`; это заготовка будущей Goal, а не active AI-card и
не разрешение менять runtime.

Предлагаемый Goal ID: `AI-LAYER-SIMPLIFICATION`.

Ветка: `agent/ai-layer-refactor`.

Исходная база черновика: `2122ce143129492797514bb73bdf4a1069e273a2`
(`origin/main` на 2026-08-20).

Незамёрженная зависимость на момент создания: ветка
`agent/fix-widget-duplicate-question`, head
`a5bda98e6c715e4ddfeac16dcf0779cc55b89656`, PR #22. Ни один факт из этого PR
не считается частью baseline новой ветки до отдельной сверки его статуса и
кода в актуальном `main`.

## 1. Назначение пакета

Подготовить последовательность небольших вертикальных срезов, которые уберут
из live-диалога лишние смысловые валидаторы, сборщики и fallback-переходы, не
сломав app-owned очередь, свежесть хода, атомарный commit, send gate и manager
takeover.

Этот документ специально не фиксирует точные файлы, функции и команды будущих
срезов. Перед началом каждого среза Исполнитель обязан заново восстановить
реальный executable path по коду на свежем SHA и создать компактную карточку по
`docs/tasks/AI_REFACTOR_SLICE_TEMPLATE_RU.md`.

## 2. Решение-гипотеза

Минимальная целевая схема для обычного хода:

```text
fresh conversation state + необходимый контекст каталога
  -> один model generation
  -> короткие механические и safety/factual gates
  -> revision-aware atomic commit
  -> send gate
```

Для обычного low-risk диалога не нужны:

- отдельный live-судья тона или helpfulness;
- regex, определяющий смысл реплики или следующий вопрос;
- разделение человеческого текста на `answerText` и дублируемый
  `question.text`, если оно не доказало отдельной машинной ценности;
- repair-loop, повторяющий тот же вызов без нового evidence;
- автоматическая передача менеджеру из-за ошибки генератора или валидатора;
- multi-agent, supervisor или второй runtime.

Гипотеза уровня сложности: детерминированный workflow с одним модельным
решением на обычный ход. Bounded read-only tool-loop допустим только если
AILR-06 докажет на реальных запросах, что подготовленного server-side контекста
недостаточно. До такого доказательства автономный agent loop не принимается.

Упрощение не удаляет Harness. В коде остаются только механизмы, для которых
назван наблюдаемый failure mode:

| Функция Harness | Что предполагается сохранить |
|---|---|
| Context | свежий диалог, подтверждённое состояние, компактный каталог |
| Tools | только узкие read-only возможности, если они действительно нужны |
| Constraints | takeover/send fence, privacy, запрещённый контент, подтверждение коммерческих фактов |
| Verification | schema, evidence/ID, актуальность revision и внешний eval результата |
| Correction | осмысленный retry технического сбоя, rollback и точная деградация без ложного handoff |

## 3. Evidence, inference и unknown

### Evidence на момент черновика

- Repo-local owner architecture требует один свежий ход, один текст модели,
  одну проверку и одну транзакцию.
- Отдельная ветка PR #22 была создана после наблюдаемого `candidate_invalid`, где
  нормальная генерация была заблокирована структурным validator path.
- В inspected-коде на той ветке существовали terminal checks для tone,
  repeated reply, known slot и композиции вопроса, а общий reject превращался
  в публичный `manager_review` fallback.
- Эти факты относятся к проверявшимся SHA, а не автоматически к будущему
  `main`.

### Inference

- Главный риск находится не в слабости модели, а в том, что несколько
  смысловых слоёв конкурируют за владение одним ответом.
- Удаление класса quality-blockers вероятнее даст системный эффект, чем
  последовательное расширение regex и repair-правил.
- Самый дешёвый достаточный runtime, вероятно, является одношаговым модельным
  решением внутри уже существующего надёжного workflow.

### Unknown до AILR-00/01

- точный current-main graph от inbound до public fallback;
- какие проверки остаются production-reachable после PR #22;
- доля отказов каждого validator reason на реальном распределении;
- нужен ли model tool-loop для текущего каталога или достаточно server-side
  retrieval/context assembly;
- фактическая граница шума eval, latency и model-calls-per-turn;
- какие изменения потребуют public contract или DB migration.

Ни один unknown не заполняется предположением из старого документа.

## 4. Как используется developing-ai-agents

Для проектирования и оценки принят внешний skill:

- plugin: `developing-ai-agents@developing-ai-agents-skill`;
- версия plugin: `0.6.0`;
- upstream: `ilkruglov/developing-ai-agents-skill`;
- проверенный upstream SHA: `bf1330f05a64c8999d835f3180089ae51118f739`;
- `scripts/validate.py` прошёл;
- upstream unit tests: `64/64`.

Обязательный маршрут для каждого будущего среза:

1. `references/playbooks/harness-review.md` — восстановить фактический контур
   только по коду;
2. `references/templates/harness-spec.md` — записать current и target state;
3. `references/playbooks/build-evals.md` и
   `references/templates/eval-plan.md` — определить baseline, выборки, решающую
   метрику, шум и release gate до оптимизации;
4. книжный принцип минимальной достаточной архитектуры — сначала простейший
   вариант, добавление слоя только для доказанного failure mode;
5. книжные ссылки используются только через проверенные SHA-якоря skill.

Skill является инженерной рамкой, а не источником фактов о проекте. При
расхождении приоритет имеют accepted repo-local owner decisions, ADR и
проверенный executable code на текущем SHA.

## 5. Общий preflight каждой задачи

Черновик среза получает `GO` только после заполнения всех пунктов:

- [ ] зафиксированы `HEAD`, `origin/main`, branch, dirty tree и пользовательские
  незавершённые изменения;
- [ ] проверен статус PR #22 и других зависимостей;
- [ ] восстановлен production path от ingress до persisted/public outcome;
- [ ] найдены callers, альтернативные implementations и compatibility exports;
- [ ] пройдены normal, failure, retry, cancellation, stale/takeover и replay
  paths;
- [ ] перечислены prompt/model/tool/validator/fallback contracts на этом SHA;
- [ ] проверены schema/migrations, public contracts, privacy и другие repo;
- [ ] есть воспроизводящий тест, sanitized trace или измеримый baseline;
- [ ] current и target Harness заполнены ссылками на файл/функцию;
- [ ] критерии успеха проверяются независимо от заявления Исполнителя;
- [ ] определены rollback и непроверенные области;
- [ ] каждый сработавший stop-gate получил точное owner decision.

Результат preflight:

```text
GO       — задача подтверждена кодом и может стать active card
NO-GO    — нужна новая owner/architecture/schema/public-contract развилка
NO-OP    — требуемое состояние уже доказано на current SHA
SPLIT    — один результат скрывает более одного независимо рискованного diff
```

`NO-OP` является нормальным успешным исходом. Запрещено придумывать изменение,
чтобы у среза появился diff.

## 6. Черновой порядок срезов

### AILR-00 — фактическая карта runtime и Harness

Один результат: по current code восстановлен один authoritative путь
`inbound -> context -> model -> validation -> commit -> public outcome`, а
каждый разрыв между current и target отмечен как evidence-backed gap.

До `GO` проверить:

- production entrypoints, DI/assembly и все model generator callers;
- реальные terminal states и публичное отображение каждого из них;
- validator reason taxonomy и доступную sanitized observability;
- сохранённые queue/latest-wins/takeover/atomicity инварианты;
- состояние PR #22 относительно `main`.

Проверяемый выход:

- current/target Harness spec;
- таблица `evidence / inference / unknown` с file/line;
- список кандидатов на удаление с подтверждёнными production callers;
- рекомендация уровня сложности: one call, workflow или bounded tool-loop.

Вне среза: изменение runtime, prompt, policy, schema и deploy.

### AILR-01 — baseline и eval-контракт до оптимизации

Один результат: существует воспроизводимый eval-loop на реальном
распределении, способный отличить улучшение от шума и false green.

Минимальные наборы:

| Набор | Источник | Правило |
|---|---|---|
| Development | обезличенные реальные обращения и ручные smoke-сценарии | доступен при разработке |
| Holdout | то же распределение, физически отделённое | не используется для настройки |
| Adversarial | реальные инциденты, включая greeting/order question, catalog query, duplicate question и false handoff | выполняется на каждом behavioral slice |

Версионировать как один tuple:

```text
model + reasoning + prompt hash + tool/retrieval version
+ dataset version + runtime SHA + environment
```

Кандидаты метрик, окончательные определения и пороги задаются только после
baseline:

- `ordinary_turn_delivery_rate`;
- `explicit_question_answered`;
- `unnecessary_manager_handoff_rate`;
- `repeated_question_rate`;
- `catalog_relevance`;
- hard constraint violations отдельно от качества;
- `model_calls_per_committed_turn`, latency p50/p95, tokens и стоимость;
- `Pass^k` для устойчивости повторных прогонов.

Платные прогоны, raw customer traces и изменение retention требуют отдельного
stop-gate. До него допустимы только существующие sanitized evidence, mocks и
локальные fixtures.

### AILR-02 — разделить AI failure и настоящий handoff

Один результат: техническая или validation-ошибка AI не переводит разговор в
`manager_review`; handoff появляется только из подтверждённого customer/policy
intent или фактического manager takeover.

До `GO` проверить:

- все mappings generator/validator/persistence/send-gate outcomes;
- public widget contract и тексты деградации;
- manager notification/takeover side effects;
- retryability и поведение следующего сообщения клиента.

Acceptance-гипотеза:

- `AI unavailable != manager requested` во всех production paths;
- внутренний failure reason остаётся sanitized и диагностируемым;
- сохранённое сообщение не теряется;
- явный запрос человека и takeover работают как раньше.

Вероятный stop-gate: AI-policy, fallback, handoff/takeover или public contract.
Точное решение фиксируется до рабочего кода.

### AILR-03 — один авторитетный `finalText`

Один результат: модель возвращает один готовый пользовательский текст, который
не собирается из конкурирующих разговорных полей и не переписывается после
validation.

Предварительная гипотеза контракта:

```ts
{
  finalText: string;
  stateUpdates?: ProposedStateUpdate[];
  recommendationIds?: string[];
  handoffIntent?: ProposedHandoffIntent;
}
```

Точная schema выбирается только после проверки всех consumers и persisted
observability. Машинные actions остаются отдельными proposal и не дают модели
прямой записи или отправки.

Acceptance-гипотеза:

- исчезает класс duplicate `answerText/question.text`;
- persisted/sent text совпадает с validated text и hash;
- state/recommendation/handoff proposals можно независимо отклонить;
- rollback возвращает прежний internal output contract без schema migration.

Вероятный stop-gate: prompt/model output contract и AI-policy.

### AILR-04 — terminal validator по allowlist

Один результат: live-path блокирует текст только по закрытому списку
механических, safety и factual причин; quality-суждения не запрещают обычный
ответ.

Кандидаты terminal gates для проверки по коду:

- invalid/oversized machine shape, если её нельзя безопасно восстановить;
- forbidden content или доказанный unsafe commercial claim;
- неизвестный/неопубликованный evidence ID для фактического утверждения;
- stale response window, потерянная lease или manager takeover;
- критический persistence/send failure.

Кандидаты для переноса из blocker в eval/telemetry:

- tone/helpfulness;
- «похож на повтор»;
- выбор или повтор известного slot;
- наличие/форма уточняющего вопроса;
- стилистические и funnel-эвристики.

Acceptance-гипотеза:

- закрытый reason-code allowlist доказан тестами;
- неизвестный terminal reason fail-closed на уровне machine contract, но не
  маскируется ложным manager handoff;
- реальные unsafe claims по-прежнему не отправляются;
- adversarial natural-language variants не зависят от регистра, пунктуации и
  одной точной фразы.

Вероятный stop-gate: AI-policy/privacy/send gate.

### AILR-05 — один обычный модельный вызов и prompt-owned диалог

Один результат: low-risk ход делает не более одного generation call, а модель
сама решает, ответить ли, уточнить ли и как сформулировать текст, используя уже
известные сведения.

До `GO` проверить:

- существуют ли сейчас semantic verifier/repair/retry paths и достижимы ли они;
- чем отличаются provider retry и повтор смысловой генерации;
- где дублируются правила между prompt, TypeScript policy и tests;
- можно ли удалить правило, не потеряв hard constraint.

Acceptance-гипотеза:

- greeting, начало вопроса без `?`, correction и catalog inquiry идут через
  общий model path;
- regex не определяет раздражение, намерение, следующий вопрос или handoff;
- обычный ход имеет `model_calls_per_committed_turn = 1`;
- технический retry классифицирован отдельно и ограничен;
- prompt version и hash видны в eval/trace без сохранения raw private prompt.

Вероятный stop-gate: prompt/model settings/tools.

### AILR-06 — минимальный достаточный доступ к каталогу

Один результат: на реальных запросах выбран и реализован самый простой вариант,
который даёт релевантный актуальный каталог без write-capabilities агента.

Сначала сравнить при одинаковом бюджете:

1. server-side retrieval до model call с компактными evidence cards;
2. bounded read-only `search_catalog` tool-loop.

Вариант 2 допустим только если вариант 1 статистически не проходит заранее
заданный eval gate. Multi-agent и write-tools исключены.

Acceptance-гипотеза:

- запросы про форму, материал и конкретный товар получают релевантные
  published records текущего каталога;
- модель не создаёт URL и не пишет catalog/state напрямую;
- evidence содержит version/provenance, public card собирается сервером;
- пустой или нерелевантный retrieval не превращается в manager handoff;
- latency/token budget и rollback измерены.

Вероятный stop-gate: tool contract, retrieval/model policy, другой repo или
платный eval.

### AILR-07 — удалить доказанно мёртвые смысловые слои

Один результат: после принятия AILR-02—06 production tree не содержит
недостижимых validator/composer/policy/repair paths, которые могут снова стать
вторым владельцем ответа.

Удаление разрешается только после AST/caller и runtime evidence. Если слой ещё
исполняется для отдельного hard constraint, он сначала переносится в
соответствующую тонкую границу предыдущего среза.

Acceptance-гипотеза:

- один production runtime и один final-text owner;
- architecture contract явно rebaseline-нут на reviewed closure;
- tests не стали зелёными из-за удаления assertions;
- behavior metrics совпадают с последним accepted behavioral SHA в пределах
  измеренной границы шума.

Вне среза: новое поведение, schema, prompt и deploy.

### AILR-08 — staging rollout и ручная проверка

Один результат: exact independently accepted SHA доступен на staging для
ручного прогона, а deployed identity, config и rollback доказаны.

До `GO` обязательны:

- independent `accept` всех включённых срезов;
- exact artifact/SHA identity;
- eval release gate с числовыми порогами;
- проверенный rollback;
- owner approval на deploy/runtime config/paid smoke;
- отдельное решение, нужен ли paired landing/widget smoke.

Порядок по умолчанию:

```text
offline replay -> staging -> ручной smoke -> bounded canary (если одобрен)
```

Этот черновик не разрешает deploy, изменение секретов или production.

## 7. Межсрезовые правила оценки

Каждый behavioral slice сравнивается с одним зафиксированным baseline и меняет
один механизм либо проводит явную ablation.

Обязательные правила:

- реальные incident cases добавляются в adversarial set до исправления;
- автор изменения не является единственным судьёй открытого текста;
- constraint violations считаются отдельно и имеют veto;
- число повторов назначается до сравнения;
- разница меньше измеренной границы шума не считается улучшением;
- holdout не используется для подбора prompt/validator/tool;
- новый production incident после обезличивания становится regression case;
- ни один quality score не может скрыть рост false handoff или hard violation.

## 8. Стоп-гейты и границы разрешения

Поручение на создание пакета разрешило:

- создать эту ветку;
- установить и использовать `developing-ai-agents`;
- подготовить черновой пакет задач.

Последующее поручение отдельно разрешило commit и обычный push этой ветки.
Оно не разрешает PR, merge или deploy и не считается разрешением на:

- рабочие изменения prompt/tool/model/AI-policy/privacy/send gate/takeover;
- public contract или schema/migration;
- платные model/eval calls и raw trace capture;
- изменение другого репозитория.

При активации будущей Goal точные уже одобренные решения переносятся в её
карточку, чтобы не спрашивать повторно. Неодобренные пункты остаются
`needs_human_decision`.

## 9. Rollback планировочного пакета

До commit: удалить только этот draft, запись в task index, связанный
architecture-contract rebaseline и AILR-записи из workflow state, восстановив
предыдущее состояние текущей Goal.

После commit: обычный revert отдельного docs-only commit, включающего все четыре
изменённых файла. Runtime,
schema, данные и staging этот пакет не меняет.

## 10. Следующее безопасное действие

После отдельного поручения активировать только AILR-00. Его результатом будет
не рефакторинг, а code-derived карта и решение `GO / NO-GO / NO-OP / SPLIT` для
AILR-01. К AILR-02 и далее нельзя переходить, пока AILR-00/01 не дали
воспроизводимый baseline и не закрыты применимые owner stop-gates.
