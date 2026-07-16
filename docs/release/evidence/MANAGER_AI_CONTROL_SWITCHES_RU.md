# Manager AI control switches — evidence

Дата: 2026-07-16

Статус: `implemented_and_locally_verified`

## Результат

В manager admin добавлены два уровня управления AI:

- глобальный переключатель для всех site-widget диалогов;
- локальный переключатель для каждого диалога.

PostgreSQL является источником истины. Эффективный gate равен deployment enablement,
глобальному DB control и локальному conversation control. Глобальный stop проверяется до
generator/provider boundary и повторно внутри транзакционного send-gate. Ответ, генерация
которого уже началась, не сохраняется и не отправляется после закрытия gate.

## Реализованные гарантии

- Все manager mutation roles могут менять оба control; viewer получает `403`.
- Глобальные изменения используют optimistic version и возвращают `409` при stale update.
- UI требует подтверждение глобального включения и выключения.
- UI показывает автора и время последнего глобального изменения.
- Глобальный stop не изменяет локальные флаги диалогов.
- Локальный stop переводит диалог в `manager_active`.
- Локальное включение переводит диалог в `ai_collecting_info`.
- Повторное включение не запускает обработку старых inbound messages.
- При заранее закрытом глобальном gate generator не вызывается.
- При закрытии глобального gate во время генерации run становится blocked, а outbound отсутствует.
- Runtime env `AI_WIDGET_ENABLED` остаётся верхнеуровневым deployment kill switch.

## Коммиты

- `37974c6` — design manager AI control switches;
- `0073cb5` — implementation manager AI control switches;
- `5d55bb6` — тесты manager API и PostgreSQL gate;
- `3169024` — уточнение публичного fail-closed контракта.

## Проверка

```text
npx vitest run apps/api/test/manager-ai-control.test.ts --maxWorkers=1 --minWorkers=1
3/3 PASS

P2_TEST_DATABASE_URL=<disposable-postgres> npx vitest run \
  apps/api/test/p2-observability-postgres.test.ts \
  -t "global AI control" --maxWorkers=1 --minWorkers=1
2/2 PASS

npm test -- --maxWorkers=1 --minWorkers=1
357 PASS; 12 conditional PostgreSQL tests skipped

npm run build
PASS
- bounded API source/test typecheck;
- manager typecheck;
- Vite production build, 2477 modules transformed.
```

Disposable PostgreSQL получил migrations `0001–0012` и был удалён после проверки.

## Границы

- Deployment, push и staging migration не выполнялись.
- Live/provider calls не выполнялись.
- Staging/production runtime не изменялся.
- Проверка UI ограничена TypeScript и production build; browser E2E не выполнялся.
