# Task Pack: что делать после локального Telegram sender

Status: prepared handoff for next Codex session
Repo: `granit-operations`
Related repos: `granit-plan-app`
Owner/agent: Codex

## Про что этот файл

Это короткий пакет задач для новой сессии: сесть, открыть этот файл и по шагам довести локальный Telegram sender slice до состояния, которое можно уверенно показывать на staging smoke.

Главная идея: у нас уже есть локальная реализация Telegram inbound, manager mini-panel и отдельного delivery sender-а. Теперь надо не писать новый большой функционал, а спокойно проверить, подчистить безопасные места, описать ручную проверку и только потом решать staging Bot API smoke.

Update 2026-05-21: requester clarified that there are currently no real clients and no real managers depending on the Telegram path. Use this as an acceleration assumption: after local audit/prep, controlled staging Bot API smoke with test bot/private chats and fake staging rows should be the next fast verification step. This does not approve production, worker/scheduler, notification sender or Telegram AI outbound.

## Что уже есть

- Telegram webhook выключен по умолчанию и проверяет secret.
- Входящее сообщение клиента из Telegram сохраняется в общий Postgres контур заявок и диалогов.
- Менеджер может привязать личный Telegram через `/start <token>`.
- Менеджер может взять диалог и написать ответ после takeover.
- Ответ менеджера сначала сохраняется как `conversation_messages.sender_role='manager'`.
- Для ответа создается `message_deliveries.status='pending'`.
- Отдельный sender забирает `pending/retrying` доставки и вызывает Telegram `sendMessage`.
- Manager UI показывает delivery status, attempts, last error и Telegram message id.

## Что это не значит

- Это не production approval.
- Это не включение Telegram AI outbound.
- Это не автозапущенный worker/scheduler.
- Это не отправщик уведомлений менеджеру из `manager_notification_outbox`.
- Это не перенос бизнес-логики в Telegram.

Источник правды остается в Postgres operations state.

## Source Of Truth для новой сессии

Перед работой прочитать:

- `/home/devuser/ai-projects/granit-plan-app/docs/TASK_BOARD_RU.md`
- `/home/devuser/ai-projects/granit-plan-app/docs/task-board/task-board-data.json`
- `docs/tasks/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- `docs/tasks/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/architecture/TELEGRAM_MANAGER_BOUNDARIES_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_TRANSFORM_GIST_RU.md`

## Перед любыми правками

1. Проверить dirty state в обоих репозиториях:
   - `/home/devuser/ai-projects/granit-operations`
   - `/home/devuser/ai-projects/granit-plan-app`
2. Не откатывать чужие изменения.
3. Показать короткий план.
4. Не делать production/deploy/secrets changes.

## Задача 1. Audit текущего Telegram diff

Зачем: убедиться, что локальный sender path действительно безопасен перед ручным smoke и staging.

Проверить код:

- `apps/api/src/services/telegram-delivery-service.ts`
- `apps/api/src/repositories/telegram-delivery-repository.ts`
- `apps/api/src/services/telegram-bot-service.ts`
- `apps/api/src/routes/telegram.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `apps/manager/src/App.tsx`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0006_p0_channel_neutral_conversation.sql`
- `packages/db/migrations/0007_telegram_manager_mini_panel.sql`

Что проверить:

- Webhook не вызывает `sendMessage`, `forwardMessage`, `copyMessage`.
- Только sender вызывает Telegram `sendMessage`.
- Sender строит payload из Postgres: customer `chat_id` и сохраненный текст ответа менеджера.
- Success пишет `sent`, Telegram `message_id`, `provider_sent_at`, timeline.
- Failure пишет `retrying` или `failed`, `attempt_count`, `last_error`.
- Нет destination -> `blocked_no_destination` без provider call.
- Manager UI показывает status, attempts, error, Telegram message id.
- Telegram AI outbound остается заблокирован.

Итог audit записать одним словом:

- `accept` - можно идти дальше.
- `needs-fix` - есть баг, надо исправить.
- `needs-evidence` - код ок, но доказательств мало.
- `needs-human-decision` - нужно решение владельца.

## Задача 2. Safe refactor только при реальной пользе

Зачем: уменьшить риск перед staging, но не раздувать scope.

Разрешено:

- вынести повторяющиеся Telegram status/event labels в маленькие helpers;
- улучшить names/types вокруг delivery status без изменения API;
- добавить tests для уже существующих инвариантов;
- поправить repository query safety, если audit нашел конкретный риск;
- улучшить docs/comments там, где код сложно проверить.

Нельзя:

- включать Telegram AI outbound;
- делать production worker/scheduler;
- делать notification sender для `manager_notification_outbox`;
- менять deploy/env/secrets;
- превращать Telegram в отдельную CRM;
- переписывать архитектуру ради красоты.

Если refactor сделан, он должен быть покрыт focused tests.

## Задача 3. Local manual smoke checklist

Зачем: чтобы руками проверить путь без реального production Telegram и без догадок.

Нужно создать или обновить evidence/checklist doc, где пошагово описано:

1. Поднять локальный Postgres.
2. Применить migrations `0001..0007`.
3. Seed manager user.
4. Запустить API и manager UI.
5. Через `curl` отправить fake Telegram webhook payload.
6. Создать bind token в manager UI или API.
7. Симулировать `/start <token>`.
8. Симулировать customer inbound.
9. Симулировать manager callback `takeover`.
10. Симулировать manager callback `reply`.
11. Симулировать manager text reply.
12. Проверить в DB `message_deliveries.status='pending'`.
13. Проверить в manager UI delivery badge.
14. Если используется test bot token, отдельно запустить `npm run deliver:telegram:once`.

Важно: реальный Telegram Bot API smoke делать только после отдельного явного подтверждения.

## Задача 4. Staging Bot API smoke prep

Зачем: подготовить безопасный план настоящей отправки через Telegram, но не выполнять его автоматически.

С учетом no-real-clients/no-real-managers assumption staging smoke можно двигать быстрее: не ждать production readiness, но использовать только test bot/private chats, фиксировать DB rows до/после и запускать sender вручную один раз.

Нужно описать:

- какие env нужны;
- какой test bot/chat использовать;
- какие команды запускать;
- какие DB rows проверить до и после;
- где должен появиться внешний Telegram `message_id`;
- как откатить или пометить тестовые строки;
- какие логи/evidence сохранить.

Не превращать staging smoke в production rollout: не включать worker/scheduler, notification sender или Telegram AI outbound.

## Задача 5. Docs и status hygiene

Зачем: чтобы доска, task docs и evidence не врали про состояние.

Обновлять только если факт реально изменился:

- `docs/tasks/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- `docs/tasks/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/release/evidence/TELEGRAM_INBOUND_MANAGER_MINI_PANEL_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_SENDER_RU.md`
- `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_TRANSFORM_GIST_RU.md`
- planning board в `granit-plan-app`, если статус меняется

Если меняется Mermaid flow, обновить локальную gist copy и сам gist. Не использовать `classDef` и `linkStyle`.

## Обязательные проверки

Минимум:

```bash
git diff --check
npm run typecheck
npm test -- apps/api/test/telegram-delivery-service.test.ts
npm run smoke:api
npm test
```

Если тронут planning repo:

```bash
git diff --check
node docs/task-board/scripts/build-task-board.mjs
```

Если тронут manager UI:

```bash
npm -w @granit/manager run typecheck
npm run build
```

## Что написать в финале новой сессии

- Verdict: `accept`, `needs-fix`, `needs-evidence` или `needs-human-decision`.
- Что изменено.
- Какие проверки прошли.
- Ссылка на gist/локальную схему.
- Что осталось заблокировано.
- Отдельно: Telegram AI outbound все еще заблокирован.

## Готовый prompt для новой Codex-сессии

```text
Ты работаешь в проекте Granit AI.

Открой `/home/devuser/ai-projects/granit-operations/docs/tasks/TELEGRAM_SAFE_SENDER_NEXT_TASK_PACK_RU.md` и выполни пакет задач из него.

Главная цель: audit/refactor/local-smoke-prep для текущего Telegram inbound + manager mini-panel + outbound delivery sender slice.

Не включай Telegram AI outbound. Не делай production/deploy/secrets changes. Не делай worker/scheduler и notification sender без отдельного подтверждения. Не откатывай чужие изменения.

Перед изменениями проверь dirty git state в `/home/devuser/ai-projects/granit-operations` и `/home/devuser/ai-projects/granit-plan-app`, прочитай source-of-truth docs из task pack и покажи короткий план.

В финале дай verdict, измененные файлы, проверки и результаты, ссылку на gist/схему, и отдельно укажи, что Telegram AI outbound все еще заблокирован.
```
