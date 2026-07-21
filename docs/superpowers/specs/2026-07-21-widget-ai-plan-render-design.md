# Дизайн: plan-render слой для website widget AI

## Контекст

Staging website widget AI уже работает через текущий app-owned runtime:

`PublicWidgetIntakeService -> GroundedWidgetAiService -> OpenAI provider -> semantic verifier -> catalog -> Postgres`.

Проблема не в отсутствии AI слоя и не в `OPENAI_API_KEY`: модель вызывается, но customer-facing ответ может быть отклонен после verifier из-за app-side grounding/contract validation. Для обычных коммерческих ходов вроде "Нужен расчет памятника с установкой" это приводит к публичному degraded-ответу вместо полезного следующего вопроса.

## Решение

Не создавать новый AI runtime. Внутри существующего `GroundedWidgetAiService` разделить ход на две ответственности:

1. Planning: определить действие, intent, handoff, requested slot и извлеченные данные.
2. Rendering: собрать безопасный клиентский текст из app-owned правил для коммерческих сценариев.

Модель и verifier остаются в работе для понимания контекста, извлечения slots/requirements и catalog-grounded консультаций. Backend получает право заменить текст модели app-owned формулировкой там, где важны цена, расчет, сроки, гарантия, договор, наличие или другие коммерческие обещания.

## Поведение

- Обычный расчетный запрос не должен падать в `grounding_validation_failed`; система задает следующий недостающий вопрос.
- Финальная/точная смета, обязательная цена или коммерческое предложение передаются менеджеру.
- Если model/verifier/catalog ломается на расчетном intake-ходе, runtime использует deterministic fallback planner/renderer и все равно отвечает безопасно.
- Для некоммерческих grounded ответов текущий model -> verifier -> validation path сохраняется.
- Manager takeover и send-time persistence gate остаются финальной защитой.

## Границы

В scope:

- новый небольшой renderer/planner helper внутри `apps/api/src/modules/ai`;
- интеграция в существующий `GroundedWidgetAiService`;
- regression tests для расчетного запроса, handoff и fallback.

Out of scope:

- новый провайдер, новый сервис, новый external orchestrator;
- изменение public widget contract;
- изменение catalog snapshot schema;
- Telegram AI outbound.

## Проверка

- `apps/api/test/grounded-widget-ai.test.ts`: расчетный ход использует app-owned plan/render без provider call; provider/verifier failure для расчетного хода дает safe reply.
- `apps/api/test/public-intake.test.ts`: public endpoint возвращает `automation.status = replied`, AI reply persisted before response.
- Full `npm test -- --maxWorkers=1` и `npm run typecheck`.
