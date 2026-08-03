# Карточка среза AI-рефакторинга: AI-REF-XXX — название

Статус: `planned`

Goal:

Позиция в roadmap:

Ветка / base SHA / head SHA:

Фактическая модель Исполнителя:

Фактическая модель независимого Reviewer:

Допустимые статусы:

```text
planned
implementing
technical_done
independent_review
needs_fix
needs_evidence
needs_redesign
needs_human_decision
accept
teaching
understanding_verified
stopped
```

## 1. Один результат

Какое наблюдаемое состояние должно стать истинным:

-

Почему это следующий срез Goal:

-

## 2. Baseline и источники истины

| Проверка | Факт |
|---|---|
| `git status --short --branch` | |
| Base/head SHA | |
| Текущие обязательные тесты | |
| Известный красный baseline | |
| Незавершённые пользовательские изменения | |

Источники истины по приоритету:

1.
2.
3.

## 3. Область

Разрешённые модули и виды изменений:

-

Явно вне области:

-

Ожидаемый размер diff: ориентир, не hard stop:

-

Точный allowlist и hard limit, только если риск этого требует:

- не требуется / указать файлы и причину.

## 4. Критерии успеха

- [ ] Проверяемое утверждение:
  - Команда или доказательство:
  - Ожидаемый результат:
- [ ] Проверяемое утверждение:
  - Команда или доказательство:
  - Ожидаемый результат:

## 5. Стоп-гейты

Отметить только новое действие, ещё не одобренное Goal:

- [ ] Архитектурная развилка / roadmap / ownership.
- [ ] Migration/schema БД или публичный контракт.
- [ ] Prompt/tool/model-policy/privacy/send gate/takeover.
- [ ] Deploy/secrets/runtime config/платный вызов/другой repo.
- [ ] Нового стоп-гейта нет.

Уже полученное разрешение:

-

Если стоп-гейт сработал:

- статус `needs_human_decision`, точный вопрос владельцу и безопасная остановка.

## 6. Выполнение

Фактически затронутые файлы и модули:

-

Краткое решение:

-

Почему это системное решение, а не обход симптома:

-

Соседние находки, не выполненные в этом diff:

-

## 7. Evidence

| Проверка | Результат | Примечание |
|---|---|---|
| Целевые тесты | | |
| Failure/concurrency tests | | |
| Typecheck/lint | | |
| Build | | |
| Архитектурные/integration checks | | |
| `git diff --check` | | |
| `git diff --stat` и file list | | |

Непроверенные области:

-

Rollback или безопасный отказ:

-

## 8. Независимая проверка

Reviewer выполняет собственный Code Scout и проверяет:

- [ ] callers и скрытые пути;
- [ ] normal/failure behavior;
- [ ] concurrency/idempotency/stale state;
- [ ] schema/migrations/state ownership;
- [ ] contracts/prompts/privacy/send gate/takeover;
- [ ] false-green tests, observability и rollback;
- [ ] другие репозитории и deploy impact.

Подтверждённые находки:

-

Отброшенные гипотезы:

-

Verdict:

- [ ] `accept`
- [ ] `needs_fix`
- [ ] `needs_evidence`
- [ ] `needs_redesign`
- [ ] `needs_human_decision`

Обоснование:

-

## 9. Repair

Подтверждённые замечания и исправления внутри прежнего среза:

| Цикл | Замечания | Изменения | Проверки | Результат |
|---:|---|---|---|---|
| 1 | | | | |

Если одна категория дефекта повторилась дважды, вернуть `needs_redesign`.

## 10. Передача Goal

Почему изменение понадобилось:

-

Какое доказательство делает его принятым:

-

Какой риск остался:

-

Следующий срез после `accept`:

-

```text
Goal:
Текущий срез:
Статус:
Base/head SHA:
Результат:
Изменённые области:
Evidence:
Непроверено:
Rollback:
Verdict:
Следующий срез или stop-gate:
```
