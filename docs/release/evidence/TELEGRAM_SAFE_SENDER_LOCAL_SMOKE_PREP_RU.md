# Evidence: Telegram safe sender audit + local smoke prep

Date: 2026-05-21
Repo: `granit-operations`
Status: local audit/refactor/checklist evidence + controlled staging Bot API smoke, not production approval
Verdict: `accept`

## Ускоряющая Assumption

Requester stated on 2026-05-21: сейчас нет реальных клиентов и реальных менеджеров, которые зависят от Telegram path. Следующий staging Telegram smoke можно считать controlled low-blast-radius test, а не customer rollout.

Практический эффект:

- prioritize staging Bot API smoke next instead of adding more local-only ceremony;
- use only test bot/test private chats and fake staging rows;
- run sender manually once, not as worker/scheduler;
- still keep production/deploy/secrets changes, notification sender and Telegram AI outbound out of scope.

## Что Было Проверено

- Webhook route `POST /telegram/webhook` не вызывает `sendMessage`, `forwardMessage` или `copyMessage`.
- `TelegramBotService` нормализует private Telegram updates и пишет состояние через общий repository contract.
- Менеджерская привязка и callback/text reply path теперь принимаются только из `chat.type='private'`.
- `findManagerTelegramActor` сверяет не только `external_chat_id`, но и `external_user_id`.
- Ответ менеджера после takeover сначала сохраняется как `conversation_messages.sender_role='manager'`.
- Для ответа менеджера создается `message_deliveries.status='pending'`.
- Только отдельный sender вызывает Telegram Bot API `sendMessage`.
- Sender строит payload из Postgres: customer `channel_identities.external_chat_id` и сохраненный `conversation_messages.body`.
- Success path пишет `sent`, внешний Telegram `provider_message_id`, `provider_sent_at` и timeline `conversation.delivery_sent`.
- Failure path пишет `retrying` или `failed`, `attempt_count`, `last_error` и delivery timeline.
- Missing destination пишет `blocked_no_destination` без provider call.
- Manager UI показывает delivery status, attempts, last error и Telegram message id.
- Telegram AI outbound остается заблокирован через `TelegramOutboundBlockedError`.

## Safe Refactor

Найденный риск: до audit привязка менеджера и lookup актера фактически опирались на `external_chat_id`. Если менеджер случайно использовал `/start <token>` в групповом чате, другой участник того же чата мог попасть в manager action path.

Что изменено:

- Non-private Telegram message/callback updates возвращают `ignored_unsupported_update`.
- Manager actor lookup в Postgres дополнительно требует совпадения `external_user_id`.
- Добавлен regression test: token не привязывается из group chat, остается пригодным для private `/start`.

## Checks Run

| Command | Result |
|---|---|
| `npm test -- apps/api/test/public-intake.test.ts -t "non-private"` | passed, 1 focused test |
| `git diff --check` in `granit-operations` | passed |
| `git diff --check` in `granit-plan-app` | passed |
| `node docs/task-board/scripts/build-task-board.mjs` in `granit-plan-app` | passed |
| `npm run typecheck` | passed |
| `npm test -- apps/api/test/telegram-delivery-service.test.ts` | passed, 4 tests |
| `npm run smoke:api` | passed, 36 tests |
| `npm test` | passed, 47 tests |
| `npm run build` | passed, manager Vite build completed |
| staging `psql -f packages/db/migrations/0008_allow_manager_conversation_messages.sql` | passed |
| staging local replay of manager Telegram update | passed, webhook returned `manager_reply_queued` |
| staging `npm run deliver:telegram:once` in `ops-api` container | passed, `{"claimed":1,"sent":1,"retrying":0,"failed":0,"blocked":0}` |
| Telegram `getWebhookInfo` after retry | passed, `pending_update_count=0` |

## Local Manual Smoke Checklist

Цель: руками проверить путь без production Telegram и без реального внешнего send call.

1. Поднять локальный Postgres для `granit-operations`.
2. Применить migrations `0001..0008`.
3. Создать manager user:

```bash
npm run seed:manager-user
```

4. Запустить API с локальными env, где `TELEGRAM_BOT_ENABLED=true`, `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID=bot-main`, `TELEGRAM_WEBHOOK_SECRET=test-secret`; `TELEGRAM_BOT_TOKEN` для этого smoke не нужен, пока sender не запускается.
5. Запустить manager UI через обычный локальный build/dev flow проекта.
6. Через `curl` отправить fake webhook без secret и убедиться, что ответ `401`.
7. Через `curl` отправить fake webhook с non-private `/start <token>` payload и убедиться, что ответ `ignored_unsupported_update`, а token не израсходован.
8. Создать bind token в manager UI или через `POST /manager/me/telegram-bind-token` с manager session cookie.
9. Симулировать private `/start <token>`:

```bash
curl -sS -X POST http://localhost:3001/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: test-secret' \
  --data '{"update_id":2300,"message":{"message_id":800,"date":1780000000,"chat":{"id":9001,"type":"private"},"from":{"id":9001,"first_name":"Owner","username":"owner_manager"},"text":"/start TOKEN_FROM_MANAGER_PANEL"}}'
```

10. Симулировать customer inbound:

```bash
curl -sS -X POST http://localhost:3001/telegram/webhook \
  -H 'content-type: application/json' \
  -H 'x-telegram-bot-api-secret-token: test-secret' \
  --data '{"update_id":2301,"message":{"message_id":801,"date":1780000060,"chat":{"id":88,"type":"private"},"from":{"id":88,"first_name":"Иван","username":"customer"},"text":"Нужен менеджер"}}'
```

11. В manager UI найти заявку/диалог и убедиться, что Telegram inbound виден как общий диалог, а AI не отвечает.
12. Симулировать manager callback `takeover:PUBLIC_CONVERSATION_ID`.
13. Симулировать manager callback `reply:PUBLIC_CONVERSATION_ID`.
14. Симулировать private manager text reply.
15. Проверить в DB:

```sql
SELECT status, attempt_count, last_error, provider_message_id
FROM message_deliveries
ORDER BY created_at DESC
LIMIT 5;
```

Ожидаемо: новая строка `status='pending'`, `attempt_count=0`, `provider_message_id IS NULL`.

16. Проверить в manager UI delivery badge: `Ждет отправки`, tooltip показывает attempts.
17. Для локального smoke sender можно не запускать. Под текущей no-real-clients/no-real-managers assumption следующий быстрый шаг - controlled staging smoke с test bot token:

```bash
npm run deliver:telegram:once
```

Не подменять этот smoke production rollout: только test bot/private chats и один ручной sender run.

## Staging Bot API Smoke Prep

Первичный controlled staging smoke выполнен 2026-05-21 UTC. Раздел ниже остается как reusable checklist для следующего smoke.

С учетом acceleration assumption выше, это рекомендуемый следующий шаг: controlled staging smoke с test bot/private chats и ручным `npm run deliver:telegram:once`.

Env names needed:

- `DATABASE_URL`
- `TELEGRAM_BOT_ENABLED=true`
- `TELEGRAM_BOT_PROVIDER_ACCOUNT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `PUBLIC_MANAGER_BASE_URL`
- manager auth env из `docs/ENVIRONMENT.md`

Test bot/chat:

- Использовать отдельного Telegram test bot, не production bot.
- Использовать private test customer chat, не реальный клиентский чат.
- Использовать private manager chat для `/start <token>`, не group/supergroup.

Commands:

```bash
npm run typecheck
npm test -- apps/api/test/telegram-delivery-service.test.ts
npm run smoke:api
npm test
```

После явного запуска staging smoke в текущей/следующей сессии:

```bash
npm run deliver:telegram:once
```

DB rows before sender:

```sql
SELECT md.id, md.status, md.attempt_count, md.last_error, md.provider_message_id, cm.body
FROM message_deliveries md
JOIN conversation_messages cm ON cm.id = md.conversation_message_id
WHERE md.channel = 'telegram'
ORDER BY md.created_at DESC
LIMIT 10;
```

Ожидаемо до sender: `pending`, попыток `0`, внешний id пустой.

DB rows after approved sender run:

```sql
SELECT md.status, md.attempt_count, md.last_error, md.provider_message_id, cm.provider_message_id, cm.provider_sent_at
FROM message_deliveries md
JOIN conversation_messages cm ON cm.id = md.conversation_message_id
WHERE md.id = 'DELIVERY_ID_FROM_BEFORE_QUERY';
```

Ожидаемо при success:

- `message_deliveries.status='sent'`;
- `attempt_count=1`;
- `message_deliveries.provider_message_id` содержит Telegram `message_id`;
- `conversation_messages.provider_message_id` содержит тот же id;
- `conversation_messages.provider_sent_at IS NOT NULL`;
- timeline содержит `conversation.delivery_sent`.

Rollback/cleanup for test rows:

- Не удалять production-like evidence rows без решения владельца.
- Для staging smoke пометить тестовые заявки понятной metadata/timeline note или зафиксировать их ids в evidence.
- Если тестовые данные мешают ручной панели, закрыть тестовую заявку через manager UI, не менять migrations/schema.

Evidence to save:

- commit SHA или локальный diff summary;
- env names without secret values;
- request ids / update ids fake или staging test values;
- DB before/after snippets with secret values removed;
- sender command result JSON;
- manager UI screenshot or textual check of delivery badge;
- external Telegram `message_id` value for test send.

## Controlled Staging Bot API Smoke Result

Scope:

- staging runtime under `/srv/botops`;
- bot username `@granit_manager_bot`;
- two private test Telegram accounts only;
- no real clients and no real managers on this path per requester assumption;
- no Telegram AI outbound, no worker/scheduler, no notification sender.

Staging setup performed:

- added Telegram env names to `/srv/botops/compose.yml` for `ops-api`;
- wrote Telegram runtime env to `/srv/botops/.env.runtime` without documenting secret values;
- applied DB migrations `0006_p0_channel_neutral_conversation.sql`, `0007_telegram_manager_mini_panel.sql`, and `0008_allow_manager_conversation_messages.sql`;
- rebuilt/restarted staging `ops-api`;
- set webhook URL to `https://manager.botops.ru/telegram/webhook` with `message` and `callback_query` allowed updates.

Smoke result:

- healthcheck returned `ok`;
- non-private fake `/start` webhook returned `ignored_unsupported_update`;
- customer private inbound created Telegram customer identity and conversation;
- manager private bind succeeded;
- takeover and reply context were created;
- manager text reply was queued as `conversation_messages.sender_role='manager'`;
- sender one-shot sent exactly one Telegram delivery.

Staging issue found and fixed:

- old staging constraint `conversation_messages_sender_role_check` allowed only `visitor` and `ai_assistant`;
- manager reply initially produced 500 from Postgres check constraint;
- added and applied `0008_allow_manager_conversation_messages.sql`;
- replayed the same manager update idempotently, then Telegram retry returned 200;
- Telegram webhook `pending_update_count=0` after retry.

Final DB evidence:

- conversation has one visitor inbound and one manager outbound message;
- `message_deliveries.status='sent'`;
- `attempt_count=1`;
- `last_error IS NULL`;
- delivery `provider_message_id` is present;
- outbound `provider_sent_at` is present.

Remaining human evidence:

- customer account visually confirmed receipt in Telegram chat on 2026-05-21.
- bot token was pasted into chat during smoke; requester explicitly deferred rotation for now.

## Схема

- Gist: https://gist.github.com/monaxovdulov/6c0f607dc2782c0def51962341d0af8e
- Local copy: `docs/release/evidence/TELEGRAM_OUTBOUND_DELIVERY_TRANSFORM_GIST_RU.md`

## Что Осталось Заблокировано

- Production/deploy/secrets changes.
- Автозапущенный worker/scheduler.
- Sender для `manager_notification_outbox`.
- Telegram AI outbound.
