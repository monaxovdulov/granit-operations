# Evidence: STAGING-WIDGET-AI-INVALID-CANDIDATE-FIX — duplicate question repair

Status: needs_review
Date: 2026-08-18
Repo: `granit-operations`
Slice: staging website widget AI validation hotfix
Task link: `docs/tasks/STAGING_WIDGET_AI_RAG_ROLLOUT_RU.md`
Contract/version: `granit_model_turn.v1`

Base/runtime commit:
`2122ce143129492797514bb73bdf4a1069e273a2` /
`1eb99c36b35bd7f40171964e73fd5ec9e91f073e`.

Technical commit stat: 8 files changed, 308 insertions, 20 deletions.

## Что проверяли

После успешного provider call безопасный model output не должен блокироваться
только потому, что Luna повторила один вопрос в `answerText` и `question.text`
с разным регистром первой буквы. Независимая проверка ещё не выполнена; автор не
принимает собственный runtime diff.

## Доказанная первопричина

- Live staging run для сообщения владельца завершился `candidate_invalid`:
  model generation succeeded, profile validator rejected, send gate не
  запускался.
- Второй live run показал тот же terminal path.
- Raw provider response исходных run отсутствует по design: Responses API
  вызывается с `store:false`, сырой candidate не хранится.
- Один ограниченный диагностический call той же `gpt-5.6-luna` без записи в
  диалог/БД вернул один вопрос дважды: в конце `answerText` со строчной буквы и
  отдельно в `question.text` с прописной.
- Старый byte-exact `endsWith(question.text)` не удалял такой суффикс;
  `composeCanonicalText` видел `answerText`, заканчивающийся `?`, и возвращал
  `duplicate_question`.

## Изменение

- Duplicate suffix сравнивается через существующую Unicode/case/punctuation
  normalization и удаляется только на text boundary.
- После bounded repair остаётся один canonical question; самостоятельный второй
  вопрос в `answerText` по-прежнему отклоняется.
- Validation span получает allowlisted app-owned diagnostic version вида
  `candidate_validator.<code>.v1`; raw output, prompt и PII не сохраняются.
- Price/deadline/availability/warranty/tone, known-slot, repeat, send gate и
  manager takeover правила не менялись.

## Команды и проверки

| Check | Result | Notes |
|---|---|---|
| Red regression до fix | passed as evidence | Новый case-difference test получил прежний `duplicate_question` |
| Focused runtime tests | passed | 5 files, 36/36 tests |
| Exact reproduced candidate after fix | passed | `ask_clarifying_question`, один canonical question |
| `npm run typecheck` | passed | API source/tests и manager |
| `npm run check:architecture` | passed | 19/19 guard self-tests; 140-source closure обновлён |
| `npm run build` | passed | architecture, typecheck и manager Vite build |
| `git diff --check` | passed | whitespace errors отсутствуют |

## Прямое и косвенное влияние

- Прямое: composition/validation одного `ModelTurnOutput`, sanitized validation
  span evidence.
- Косвенное: безопасный repaired candidate теперь доходит до fresh send gate и
  atomic reply commit вместо manager fallback.
- Не затронуто: DB/schema, public contract, runtime/model selection, catalog,
  queue/retry identity, takeover, Telegram и production.

## Непроверено

- Fresh independent Reviewer ещё не выдал verdict.
- Новый SHA ещё не merged/deployed; live post-deploy smoke не выполнен.
- Audit runtime всё ещё не использует новый catalog/RAG snapshot; это отдельный
  уже записанный staging gap.

## Rollback

- Code: revert hotfix commit.
- Staging: вернуть предыдущий backend image/SHA; DB rollback не нужен.
- Operational kill switch: `AI_WIDGET_ENABLED=false`, если после deploy появится
  новый небезопасный failure mode.
