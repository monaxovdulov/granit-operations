# Goal: упрощение AI-слоя и возврат навигации по каталогу

Статус: `implementing`. Goal активирована владельцем 2026-08-24 после
`understanding_verified` для `AI-RUNTIME-CONVERGENCE`.

Goal ID: `AI-LAYER-SIMPLIFICATION`.

Репозиторий-координатор: `granit-operations`.

Стартовый SHA: `4c91d162e13251883125ab5b1b32565172f570c6` на ветке
`agent/ai-layer-refactor`; единственный исходный path в worktree этого repo —
пользовательский untracked `output/`, он не изменяется.

## 1. Цель

Вернуть понятный и наблюдаемый AI-консультантский ход без второго runtime:

```text
fresh app-owned context + минимальный published catalog retrieval
  -> один model generation
  -> механические, safety и factual gates
  -> validated recommendation IDs
  -> revision-aware atomic commit
  -> history.v2 catalog actions
  -> widget button
  -> catalog category/item focus
```

Пользователь поручил:

- перестать терять конкретную внутреннюю причину validator reject за общим
  `candidate_invalid`;
- не блокировать обычный полезный ответ субъективными quality-эвристиками;
- по намерению «покажи / какие есть варианты» давать кнопку на релевантную
  категорию или конкретный опубликованный пример;
- восстановить переход из истории виджета в актуальный переделанный каталог,
  сохранив разговор и положение виджета;
- добавить минимальную app-owned наблюдаемость ошибок;
- не выполнять deploy, не использовать секреты и платные model/eval calls.

## 2. Неподвижная архитектура

- Один production runtime: app-owned direct `live_v2`.
- PostgreSQL queue, latest-wins, fresh context, attempt ledger, commit fence,
  send gate и manager takeover остаются app-owned.
- Модель предлагает текст и IDs; URL, public cards и state writes строит и
  подтверждает сервер.
- Первый catalog-вариант — server-side retrieval до единственного model call.
  Bounded read-only tool-loop допустим только после отдельного evidence, что
  подготовленного контекста недостаточно.
- Multi-agent, write tools и второй runtime запрещены.
- Raw prompts, provider errors, customer traces и PII не добавляются в
  observability.

## 3. Порядок срезов

1. `AILR-00` — `accept`; code-derived карта current/target Harness, production-
   код не менялся.
2. `AILR-01` — `accept`; точный sanitized validator reason сохраняется во
   внутренней app-owned observability, public fallback остаётся стабильным.
3. `AILR-02` — `accept`; owner policy stop-gate закрыт 2026-08-24:
   terminal reject остаётся только для структурно непригодного ответа,
   recoverable question defects чинятся детерминированно, а semantic
   unsafe/tone/repetition regex удаляются из live path. Четыре последовательных
   review нашли одну категорию дефекта на public ownership/replay boundary.
   Первый обязательный Архитектор выбрал единый ownership-first projector с
   coherent PostgreSQL snapshot; redesign реализован, но пятый Reviewer
   нашёл оставшуюся ретроспективную подмену per-job evidence после более
   позднего takeover. Второй свежий read-only Архитектор выбрал две
   независимые оси в одном pure projector: current ownership управляет
   будущими actions/polling, immutable job evidence — history status/reason. Узкий TDD
   repair технически завершён: 8 exact red, PostgreSQL 44/44, related 132/132,
   build/typecheck/architecture 21/21, однако шестой свежий Reviewer нашёл ещё
   один current-window false-green: old `replied`/без-job replay маскирует новый
   `pending` job. Третий свежий read-only Architect выбрал explicit latest
   visitor id/sequence + current generation identity в pure projector. Repair
   технически завершён: red 4/4, PostgreSQL 48/48, related 132/132,
   build/typecheck/architecture 21/21. Седьмой Reviewer не нашёл production-
   дефектов и запросил исправить две low-неточности handoff evidence; они
   исправлены. Восьмой свежий Reviewer принял exact 41-entry payload с
   critical/high/medium/low 0/0/0/0. Нового owner stop-gate нет.
   Factual verification возвращается только через structured published
   evidence AILR-03/04 до любого deploy Goal.
4. `AILR-03` — versioned catalog authority и воспроизводимый offline retrieval
   baseline для текущего `landing-granit-static`.
5. `AILR-04` — server-side retrieval до одного model call и server validation
   возвращённых recommendation IDs.
6. `AILR-05` — точный public history/widget/catalog navigation contract:
   category и item actions, deep-link, focus/highlight и сохранение разговора.
7. `AILR-06` — cross-repo deterministic acceptance, false-green проверки и
   удаление только доказанно мёртвых compatibility paths этого результата.

После `accept` каждого среза автоматически начинается preflight следующего.
Один diff не смешивает соседние пункты.

## 4. Стоп-гейты и разрешения

Владелец явно разрешил активировать AILR-00 и реализовать описанный validator,
observability, catalog RAG и навигацию с необходимой работой в
`granit-operations`, `business-ai-web-widget` и `landing-granit-static`.

Перед рабочим кодом соответствующей карточке всё равно нужен точный контракт.
Новая schema/migration, точная public DTO, prompt/tool policy или изменение
другого repo считаются разрешёнными только если точная форма уже записана в
карточке и подтверждена владельцем. Общее поручение не разрешает произвольное
расширение контракта.

Не разрешены:

- commit, push, PR, merge или deploy;
- secrets/runtime configuration и реальные платные вызовы;
- raw customer traces или изменение retention/privacy;
- DB migration без отдельного точного решения;
- работа с пользовательским `output/` и незавершёнными untracked paths в
  соседних репозиториях.

## 5. Evidence и rollback

Для каждого среза обязательны base/head SHA, file list, `git diff --stat`,
targeted tests, применимые typecheck/build/architecture checks,
`git diff --check`, непроверенные области, rollback и свежий независимый
Reviewer с Code Scout.

Каждый срез откатывается отдельным revert или удалением его непубликованного
diff. До deploy никакой data/runtime rollback не заявляется.

## 6. Definition of Done Goal

- точная внутренняя причина validator reject восстанавливается по app-owned
  run/attempt evidence и не попадает в public history;
- обычные quality-суждения не превращаются в terminal reject;
- catalog intent получает релевантные published category/item candidates при
  одном обычном model call;
- модель не создаёт URL, а сервер отклоняет ID вне переданного candidate set;
- widget показывает безопасные действия из `history.v2`;
- актуальный каталог разрешает deep-link, показывает нужный раздел/объект и
  сохраняет разговор/состояние виджета при навигации;
- empty/invalid retrieval, stale turn и takeover не создают ложный handoff или
  устаревший ответ;
- independent acceptance пройдена; deploy остаётся отдельной owner-командой.
