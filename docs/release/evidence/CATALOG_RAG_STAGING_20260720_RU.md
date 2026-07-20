# Evidence: CATALOG-RAG-STAGING-20260720 — каталог и grounded AI

Status: blocked
Date: 2026-07-20
Repos: `landing-granit-static`, `granit-operations`
Contract/version: `granit-cha.catalog.2026-07-20.v1`, `CatalogKnowledgePort`

## Развёрнутый состав

- Landing branch: `agent/catalog-rag-staging`; staging branch: `codex/site-widget-v1.0.0-rc`.
- Landing deployed SHA: `5adc4783d8eae2c35d966e54b2e5f185da0813e8`.
- Landing workflow: `Deploy static landing to preview`, run `29766848014`, success.
- Operations branch: `agent/catalog-knowledge-staging`.
- Operations deployed SHA: `caf5130aa101f74d329c822983a5e4e2cea858e1`.
- URLs: `https://preview.granitkr.ru/catalog.html`, `https://manager.botops.ru`.
- Production не изменялся.

## Каталог

- Сохранён исходный незакоммиченный V2 snapshot, затем новый каталог собран поверх widget staging SHA `151062cb6d19c12a25edb6a8d226bea8d96c8d83`.
- Каноническая реализация одна: `/catalog.html`, `catalog.css`, `catalog.js`, `data/catalog.json`, `data/catalog-inline.js`, `assets/catalog/`.
- 10 разделов, 56 data-driven блоков, 10 универсальных renderer types.
- 465 published records; 16 review-required records остаются draft и отсутствуют в клиентском поиске/ссылках.
- 323 approved asset requirements; 352 понятных placeholders; 612 файлов в актуальном `assets/catalog/`.
- Catalog content hash: `c383a4f954bb784d38df3f25819f1e659c45d52d703cf95321c33fb1ea0fa699`.
- Snapshot file SHA-256: `de5cfe0197790e73262d14b3cf5046ec04c5128430eb98e5c1ca3e894e82d98a`.
- 462 опубликованных frontend link contracts; deep link `Арфа` ведёт в существующий `block-vertical-monuments` и подсвечивает entity.

## Удаление legacy

- Удалены старая реализация `catalog.html`/`catalog.js`, `data/catalog-data.json`, legacy CSS каталога и временные/дублирующие `catalog-v2*`.
- Удалены доказанно неиспользуемые `assets/catalog/full/` и `assets/catalog/thumbs/`: 633 файла, 10 861 128 байт.
- До удаления поиск по всему репозиторию не нашёл потребителей legacy asset paths вне удаляемого legacy data-файла; финальный smoke запрещает их возврат.
- Rollback старого каталога выполняется только Git-deploy предыдущего staging SHA, fallback-копии в runtime нет.

## Проверки

| Check | Result | Notes |
|---|---|---|
| Landing deterministic smoke | PASS | 10 sections, 56 blocks, 465/16 published/draft, 462 links, 860 локальных asset references |
| Landing GitHub Action smoke/deploy | PASS | run `29766848014` |
| Browser desktop/tablet/mobile | PASS | 1440×900, 768×1024, 390×844; overflow 0, broken images 0 |
| Все section URL | PASS | 10 URL, суммарно 56 блоков |
| Staging deep link | PASS | правильный block и две подсвеченные репрезентации entity `Арфа` |
| Staging lead form | PASS | UI success только после API success; подтверждена 1 строка `site_form/new` с catalog page URL |
| Snapshot reproducibility | PASS | две сборки byte-stable, version/hash совпали |
| Retrieval | PASS | 7/7: name, alias, article, material, section, dimensions, draft exclusion/deep link |
| Operations tests | PASS | 143/143, 18 test files |
| Typecheck/build | PASS | monorepo typecheck и build |
| AI dry-run eval | PASS | 40/40; реальный file provider, 465 published / 16 draft |
| Semantic verifier / send gate | PASS | тесты блокируют неподтверждённые факты и неразрешённые URL |
| Manager takeover | PASS | тесты подтверждают `manager_active` и запрет следующих AI replies |
| Operations health | PASS | API healthy; PostgreSQL healthy |
| Live AI/RAG smoke | BLOCKED | intake и persistence работают, generator возвращает `model_error` из-за недействительного staging OpenAI credential |

## Staging runtime

- `FileCatalogKnowledgeProvider` подключён в server assembly; нормальный runtime не использует `empty.v1`.
- Snapshot загружается с проверкой catalog hash, record hash, duplicate IDs, review gate и разрешённого URL-контракта.
- Staging in-container dry-run подтвердил версию, hash и 465/16 records; provider test прошёл 7/7 внутри deployed контейнера.
- Для совместимости с существующим staging без изменения legacy/Mastra tables миграции grounded runtime применены в отдельной PostgreSQL schema `grounded`; shared leads/conversations остаются в `public`.
- Тестовое сообщение виджета сохранилось и создало AI run `degraded/model_error`; секрет или тело сообщения в evidence не записаны.
- Telegram AI outbound не включался.

## Блокер

Безопасная проверка OpenAI API из staging-контейнера вернула HTTP 401 `invalid_api_key`. Поэтому нельзя честно подтвердить критерий «проверенный AI-ответ → deep link» в реальном live-вызове. Для продолжения нужен действующий staging-only OpenAI credential через существующий secret/config mechanism. Production secret/config менять не требуется.

Manager UI нельзя было открыть через доступный in-app Browser (`ERR_BLOCKED_BY_CLIENT`), а запрошенный Chrome connector в текущей сессии не установлен. Persistence и manager-visible repository path подтверждены БД и тестом public intake → authenticated manager list; интерактивный manager UI smoke остаётся повторить после предоставления браузерной сессии/connector.

## Rollback

- Landing: вернуть staging branch/deploy на `151062cb6d19c12a25edb6a8d226bea8d96c8d83`.
- Operations: восстановить сохранённый pre-catalog compose и образ `rollback-59552bba6d7513e01ac6ec8b78e8a082d4c9f7e0`, затем выполнить безопасный recreate только `ops-api`.
- Pre-change staging DB backup: `/srv/botops/backups/pre-catalog-grounded-20260720T1750Z.dump`.
- Schema `grounded` изолирована и может оставаться неактивной при rollback; существующие public/Mastra tables не удалялись и не переписывались.

## Оставшееся до production

- Заменить недействительный staging-only OpenAI credential, повторить live AI/RAG ответ и проверить выданный deep link в браузере.
- Повторить authenticated manager UI smoke и takeover на staging.
- После успешного staging sign-off отдельно согласовать production deploy/config; текущая работа production не изменяла.
