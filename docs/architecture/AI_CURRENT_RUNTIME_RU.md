# Текущий AI runtime

Статус: current-runtime map, проверен 2026-08-27 по production source
closure SHA-256
`10f0d33caa0caa9ea93087a0c8553ec234db2b5874bbe7ae9b1a500d5e14f66d`,
закреплённому в `tooling/ai-architecture-contract.json`.

Этот документ описывает фактический production assembly текущего checkout. Он
не является roadmap, active-card, release approval или доказательством того,
что этот SHA опубликован в staging/production. При расхождении текущий код,
контракты, migrations и executable tests имеют приоритет.

## Исполняемый путь

```text
public widget intake
  -> PostgreSQL message/job state
  -> RecordedLiveV2TurnService
  -> executeModelTurn
  -> app-owned validation и свежий send gate
  -> atomic reply/run/job commit
```

`executeModelTurn` оставляет app-owned validation и send gate приложению; model
output сам по себе не является разрешением на отправку.

- `apps/api/src/app-context.ts` собирает единственный прямой runtime без
  selector.
- `apps/api/src/modules/ai/services/recorded-live-v2-turn-service.ts` вызывает
  только `executeModelTurn`, записывает model observations и передаёт только
  validated plan к persistence boundary.
- `apps/api/src/modules/ai/profiles/live-v2/model-turn-orchestrator.ts` владеет
  текущим ходом модели.
- `apps/api/src/modules/ai/adapters/openai-live-v2-decision-generator.ts` —
  текущая provider boundary. Возврат второго production runtime требует нового
  принятого ADR.

`RecordedLiveV2TurnService` больше не принимает internal selector и не вызывает
legacy candidate orchestrator. Старый `executeLiveV2Turn` остаётся отдельным
source/test debt и не является исполняемой веткой production service.

## Runtime contract

- `production_entry`: `executeModelTurn`
- `tool_owner`: model-owned `search_catalog`
- `model_call_budget`: at most `2`
- `validation_owner`: app-owned validation
- `persistence_gate`: fresh send gate before atomic commit

## Один model-turn

1. Приложение формирует `AiTurnInput`: текущую visitor-реплику, историю,
   известные факты/requirements и gate snapshot.
2. Первый model call возвращает строго одно действие: `final` или
   `search_catalog`.
3. Если модель выбрала `search_catalog`, приложение валидирует аргументы и
   выполняет один bounded server-side поиск по текущему catalog snapshot.
4. Результат поиска возвращается модели; второй model call обязан вернуть
   финальный результат. Повторный tool request блокируется как
   `tool_loop_blocked`.
5. Поэтому обычный ход делает один model call, а ход с model-owned
   `search_catalog` — не более двух. Backend не добавляет скрытые catalog
   filters от имени модели.

## App-owned ограничения и отправка

- `model-turn-validator.ts` разбирает schema, проверяет action, вопрос,
  state patches, handoff и recommendation IDs. Recommendation принимается
  только из candidate set и опубликованного catalog snapshot; URL и кнопки
  строит приложение.
- Закрытый initial gate не допускает model call. После генерации
  `executeModelTurn` перечитывает gate; unavailable/closed gate не даёт плану
  стать отправляемым ответом.
- `RecordedLiveV2TurnService` и repository boundary сохраняют terminal run,
  job и reply через app-owned fence/send gate. Manager takeover и потеря lease
  блокируют in-flight persistence.
- Invalid context/assets завершаются terminal no-reply. Provider/invalid-output
  paths дают наблюдаемый safe fallback либо no-reply по текущему контракту;
  неявный retry здесь не добавляется.

## Проверяемый Harness

| Функция | Текущий механизм |
|---|---|
| Context | `AiTurnInput`, fresh conversation context, known facts и gate snapshot |
| Tools | schema `search_catalog`, app-executed bounded search, максимум один tool round |
| Constraints | structured output schemas, catalog ID validation, initial/fresh gate и commit fence |
| Verification | model-turn/catalog tests и PostgreSQL runtime invariant tests |
| Correction | safe fallback, terminal no-reply, blocked/gate-unavailable outcomes без скрытого успеха |

Основное executable evidence:

- `apps/api/test/model-turn-orchestrator.test.ts`;
- `apps/api/test/model-turn-validator.test.ts`;
- `apps/api/test/catalog-show-transcript.test.ts`;
- `apps/api/test/m2-live-v2-runtime-integration.test.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`.

## Что не следует из этой карты

- Старый grounded eval/service остаётся отдельным legacy consumer и не
  описывает production model-turn. Его замена или удаление не входит в LGC-00.
- Наличие current code не доказывает staging SHA, production readiness или
  качество ответов на реальных диалогах.
- Закрытые Goal/cards, owner roadmaps и cleanup planning сохраняют provenance,
  но не меняют runtime и не активируют следующую задачу автоматически.
