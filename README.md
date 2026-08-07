# Granit Operations

`granit-operations` — backend системы обработки обращений проекта «Гранит».
Он принимает публичные заявки и сообщения виджета, хранит состояние в
PostgreSQL, запускает серверную AI-обработку и предоставляет защищённую панель
менеджера.

Статус: активная разработка. Наличие кода не означает разрешение на production.
AI и Telegram выключены по умолчанию. Текущий backend runtime ещё не подтверждён
свежей staging-выкладкой и сквозным smoke на SHA этого репозитория.

## Публичный контур

```text
business-ai-web-widget
  исходный код браузерного Web Component
  ↓ проверенная immutable-сборка

customer landing
  pinned loader.js + site-widget.esm.js + manifest.json
  ↓ строгий site_widget.v2

granit-operations
  intake API → PostgreSQL → AI queue/runtime → send gate
  manager UI → takeover и ручное управление
```

Точные commit SHA, пути и SHA-256 текущей проверенной связки находятся в
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Эта карта содержит только
компоненты текущего исполняемого пути.

## Связанные компоненты

- [`monaxovdulov/business-ai-web-widget`](https://github.com/monaxovdulov/business-ai-web-widget)
  владеет исходным кодом Web Component, отображением и строгим разбором
  публичного контракта. Пакет называется `@monaxovdulov/site-widget`; его
  registry-канал может оставаться restricted при публичном source-репозитории.
- `monaxovdulov/landing-granit-static` — текущий customer landing. Он не является
  источником виджета: landing хранит проверенные runtime-файлы по точному source
  commit и подключает pinned `loader.js`.
- `granit-operations` владеет persistence, очередью, AI runtime, manager UI,
  send gate и manager takeover.

Полный внешний аудит browser-to-backend пути требует совместной проверки этого
репозитория, публичного widget source и pinned runtime в landing.

## Состояние

| Состояние | Область | Граница утверждения |
|---|---|---|
| Реализовано | `site_form.v1`, `site_widget.v2`, PostgreSQL persistence и durable AI queue | Подтверждено текущим кодом, контрактами, миграциями и тестами |
| Реализовано | Manager auth/UI, send gate и manager takeover | Есть в коде; production approval не следует из реализации |
| Реализовано | Прямой server-side AI runtime | Model output проходит app-owned validation и свежий send gate |
| Выключено | AI visitor replies | Нужны `AI_WIDGET_ENABLED=true`, worker flag и серверный ключ; defaults — `false` |
| Выключено | Telegram inbound и delivery | Нужны отдельные flags, credentials и release approval; default — `false` |
| Ещё не доказано | Текущий backend в staging | Нет свежего evidence, связывающего deployed runtime с текущим backend SHA |
| Ещё не доказано | Production readiness | Нет production approval и полного release evidence |

Подробные ограничения AI находятся в [`docs/AI_POLICY.md`](docs/AI_POLICY.md).

## Безопасный локальный запуск

Понадобятся Node.js с npm, PostgreSQL и `psql`. Команды ниже оставляют AI,
Telegram и browser CORS выключенными.

1. Создайте локальный файл окружения.

   ```bash
   cp .env.example .env
   ```

2. При необходимости измените только локальный `DATABASE_URL` в `.env`.

3. Загрузите значения в текущую shell-сессию.

   ```bash
   set -a
   . ./.env
   set +a
   ```

4. Установите зависимости и создайте пустую базу.

   ```bash
   npm ci
   createdb granit_operations
   ```

5. Примените миграции по порядку.

   ```bash
   for migration in packages/db/migrations/*.sql; do
     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
   done
   ```

6. Соберите проект и запустите API.

   ```bash
   npm run build
   npm run dev:api
   ```

7. Проверьте health endpoint в другой shell-сессии.

   ```bash
   curl http://127.0.0.1:3001/health
   ```

Этап завершён, когда API отвечает
`{"ok":true,"service":"granit-operations-api"}`. Приложение читает окружение
процесса и само не загружает `.env`.

## Маршрут внешнего аудитора

1. Зафиксируйте SHA и границы системы по
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) и
   [`docs/BOUNDARIES.md`](docs/BOUNDARIES.md).
2. Проверьте публичные форматы по
   [`docs/PUBLIC_INTAKE_CONTRACT.md`](docs/PUBLIC_INTAKE_CONTRACT.md),
   [`packages/contracts`](packages/contracts) и JSON Schema в
   [`packages/contracts/schemas`](packages/contracts/schemas).
3. Проверьте AI policy, persistence и send gate по
   [`docs/AI_POLICY.md`](docs/AI_POLICY.md), текущим миграциям и тестам.
4. Запустите применимые локальные проверки.

   ```bash
   npm run check:architecture
   npm run typecheck
   npm run smoke:api
   npm run eval:widget-ai:offline
   ```

5. Сообщайте о чувствительных находках по [`SECURITY.md`](SECURITY.md), не через
   публичный Issue.

Проверка этапа завершена, когда каждое утверждение привязано к текущему SHA или
явно отмечено как недоказанное. Исторические task/evidence документы не заменяют
свежую runtime-проверку.

## Структура репозитория

| Каталог | Назначение |
|---|---|
| `apps/api` | Fastify API, manager auth и server-side runtime |
| `apps/manager` | React/Vite/Mantine manager UI |
| `packages/contracts` | Версионированные публичные контракты |
| `packages/db` | PostgreSQL schema и последовательные миграции |
| `docs` | Архитектура, policy, ADR и evidence |

## Лицензия

Код распространяется по
[PolyForm Noncommercial License 1.0.0](LICENSE): некоммерческое использование,
изменение и распространение разрешены на условиях лицензии. Для коммерческого
использования требуется отдельное разрешение владельца.
