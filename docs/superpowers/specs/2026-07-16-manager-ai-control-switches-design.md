# Управление AI из manager admin

Дата: 2026-07-16

## Цель

Дать всем авторизованным менеджерам два независимых уровня управления AI виджета:

- глобальный аварийный переключатель для всех диалогов;
- локальный переключатель для конкретного диалога.

Глобальный стоп всегда сильнее локального разрешения. Отключение должно предотвращать новые
provider calls и не пропускать уже сгенерированный ответ через send-gate.

## Решения

- PostgreSQL является единым источником истины для обоих уровней.
- Глобальное состояние хранится в singleton-строке с автором, временем изменения и версией.
- Локальное состояние использует `conversations.agent_allowed_to_reply` и `ai_state`.
- Эффективное разрешение: `global_enabled AND conversation_enabled`.
- Перед model call проверяются оба уровня.
- Перед сохранением outbound оба уровня повторно проверяются в одной транзакции.
- Уже начатая генерация может завершиться, но её результат не сохраняется и не отправляется,
  если за это время выключен любой переключатель.
- После включения AI отвечает только на следующее новое inbound-сообщение. Пропущенные сообщения
  автоматически не обрабатываются.
- Локальное включение переводит диалог из `manager_active` в `ai_collecting_info`.
- Глобальное переключение не меняет локальные состояния диалогов.
- Все пользователи с правом manager mutation могут менять оба переключателя.
- Глобальное выключение и включение требуют подтверждения в UI.

## Данные

Новая таблица `ai_runtime_controls` содержит одну строку `site_widget`:

- `scope` — singleton key;
- `enabled` — глобальное разрешение;
- `version` — монотонная версия для optimistic concurrency;
- `changed_by_manager_id` и `changed_by_manager_email` — автор изменения;
- `changed_at` — время изменения.

Начальное значение — `enabled=true`, чтобы additive migration не выключила уже разрешённый
staging runtime. Runtime env `AI_WIDGET_ENABLED` остаётся верхнеуровневым deployment kill switch;
эффективный runtime gate равен `env_enabled AND db_global_enabled AND conversation_enabled`.

## Manager API

- `GET /manager/ai-control` возвращает глобальное состояние, автора, время и версию.
- `PATCH /manager/ai-control` принимает `enabled` и ожидаемую `version`.
- `PATCH /manager/leads/:leadId/conversations/:publicConversationId/ai-control` принимает
  `enabled` и возвращает обновлённую карточку лида.
- Конфликт версии глобального переключателя возвращает `409`, после чего UI перечитывает
  актуальное состояние.
- Все mutation endpoints используют существующую manager authentication/authorization boundary.

## Runtime flow

1. Inbound сохраняется независимо от состояния AI.
2. Repository возвращает локальный gate с глобальным DB-флагом, объединённым в
   `agentAllowedToReply`.
3. При закрытом gate orchestration завершается без provider call.
4. Transactional reply persistence обновляет conversation только при локальном разрешении и
   существующем глобальном разрешении.
5. Если gate закрылся во время генерации, run завершается как blocked/gate closed, outbound не
   создаётся.

## UI

Глобальный control располагается в верхней панели manager admin:

- явный статус `AI во всех диалогах включён/остановлен`;
- switch disabled во время сохранения;
- подтверждение на каждую смену;
- подпись `изменил <email>, <time>` после первой manager-операции;
- красный alert при глобальном stop.

В карточке каждого диалога отображается switch:

- `AI в этом диалоге`;
- при глобальном stop локальный switch сохраняет своё значение, но UI показывает, что глобальный
  стоп имеет приоритет;
- выключение переводит диалог в `manager_active`;
- включение переводит диалог в `ai_collecting_info`;
- смена действует только для будущих inbound-сообщений.

## Ошибки и гонки

- UI выполняет optimistic update только после успешного API response.
- При network/API error switch возвращается к серверному состоянию и показывает ошибку.
- Глобальная версия защищает от одновременных противоположных действий менеджеров.
- Send-gate остаётся последней авторитетной проверкой и не доверяет состоянию React или ранее
  прочитанному gate snapshot.

## Проверка

- Migration/schema parity для singleton control.
- API tests для read/update, authorization, invalid body и version conflict.
- Repository tests для global off before generation и global/local off during generation.
- Проверка отсутствия outbound linkage при закрытом send-gate.
- UI tests для confirmation, pending/error state, global precedence и локального enable/disable.
- Проверка, что повторное включение не запускает обработку старого inbound.

## Не входит в scope

- Отмена уже отправленного provider request.
- Обработка пропущенных сообщений после включения.
- Scheduler, временное автоматическое включение или роли с разными правами.
- Production rollout или изменение provider credentials.
