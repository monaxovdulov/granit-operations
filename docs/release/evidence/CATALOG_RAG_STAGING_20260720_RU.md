# Evidence: CATALOG-RAG-STAGING-20260720 — каталог и grounded AI

Status: passed
Date: 2026-07-21
Repos: `landing-granit-static`, `granit-operations`
Contract/version: `granit-cha.catalog.2026-07-20.v1`, `CatalogKnowledgePort`

## Развёрнутый состав

- Landing branch: `agent/catalog-rag-staging`; staging branch: `codex/site-widget-v1.0.0-rc`.
- Landing deployed SHA: `5adc4783d8eae2c35d966e54b2e5f185da0813e8`.
- Landing workflow: `Deploy static landing to preview`, run `29766848014`, success.
- Operations branch: `agent/catalog-knowledge-staging`.
- Operations deployed SHA: `38a3e9c4d35c7837650456169ee9ebac9846ac46`.
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
| Operations tests | PASS | 149/149, 18 test files |
| Typecheck/build | PASS | monorepo typecheck и build |
| AI dry-run eval | PASS | 40/40; реальный file provider, 465 published / 16 draft |
| Semantic verifier / send gate | PASS | live verdict `pass`, `grounding_verified=true`, violations `[]`; неподтверждённая цена не опубликована |
| Manager takeover | PASS | live authenticated PATCH `200`: `manager_active`, `agent_allowed_to_reply=false`; следующий ход получил `agent_reply_blocked` без AI-сообщения |
| Operations health | PASS | API healthy; PostgreSQL healthy |
| Live AI/RAG smoke | PASS | ответ и история сохранены; `Арфа` найдена реальным provider, выдан существующий deep link, verifier `pass`, 19 489 мс |

## Staging runtime

- `FileCatalogKnowledgeProvider` подключён в server assembly; нормальный runtime не использует `empty.v1`.
- Snapshot загружается с проверкой catalog hash, record hash, duplicate IDs, review gate и разрешённого URL-контракта.
- Staging in-container dry-run подтвердил версию, hash и 465/16 records; provider test прошёл 7/7 внутри deployed контейнера.
- Generator и verifier используют `gpt-5.4-mini-2026-03-17`; prompt `granit_widget_ai_prompt.grounded.v6`. Retrieval-only `searchText` остаётся в полном runtime snapshot, но детерминированно исключается из model-facing projection для снижения latency.
- Для совместимости с существующим staging без изменения legacy/Mastra tables миграции grounded runtime применены в отдельной PostgreSQL schema `grounded`; shared leads/conversations остаются в `public`.
- Live-вопрос про памятник «Арфа» создал AI run `replied`: catalog version/hash совпали, verifier verdict `pass`, violations `[]`, ответ сохранён в публичной истории. Ответ содержит точный URL `/catalog.html?section=pamyatniki&entity=ent_1395cd250bbce644514c7e44#block-vertical-monuments` и честно сообщает, что цена доступными данными не подтверждена.
- Browser открыл этот URL: section `pamyatniki`, anchor `block-vertical-monuments`, entity существует, текст `Арфа`, класс подсветки `is-deep-linked`.
- Менеджерская панель доступна и показывает Yandex login. Live manager route проверен краткоживущей staging-сессией существующего активного manager user; сессия после smoke отозвана. Ответ API подтвердил наличие диалога и двух сообщений, затем takeover остановил AI на следующем ходе.
- Telegram AI outbound не включался.

## Live evidence

- Staging credential установлен только в server runtime; значение не читалось, не выводилось и не попало в Git/evidence.
- Live ответ получен через публичный endpoint с точным Origin `https://preview.granitkr.ru`, затем считан через публичный history endpoint: visitor + persisted `ai_assistant` reply.
- AI run: `replied`, generator/verifier `gpt-5.4-mini-2026-03-17`, latency `19489`, `grounding_verified=true`, repair applied, catalog hash `c383a4...fa699`.
- Следующий visitor message после live takeover сохранён третьим сообщением; public response: `automation.status=fallback`, reason `agent_reply_blocked`, история осталась `manager_active` и не получила нового AI reply.
- In-app Browser использован для staging/deep-link проверки. Chrome connector в этой сессии не был установлен; это не помешало проверке публичного пути и реального authenticated manager API.

## Rollback

- Landing: вернуть staging branch/deploy на `151062cb6d19c12a25edb6a8d226bea8d96c8d83`.
- Operations: быстрый откат на сохранённый compose/image предыдущего SHA `bba4b99f1f1878ab1d050585ab6bf19afdd6e289`; полный pre-catalog rollback — образ `rollback-59552bba6d7513e01ac6ec8b78e8a082d4c9f7e0`, затем безопасный recreate только `ops-api`.
- Pre-change staging DB backup: `/srv/botops/backups/pre-catalog-grounded-20260720T1750Z.dump`.
- Schema `grounded` изолирована и может оставаться неактивной при rollback; существующие public/Mastra tables не удалялись и не переписывались.

## Оставшееся до production

- Получить отдельный production sign-off и разрешение на production deploy/config; текущая работа production не изменяла.
- Настроить/подтвердить production-only OpenAI secret через production secret mechanism и выполнить отдельный production smoke после разрешённого релиза.
- Полноценный визуальный smoke manager UI после Yandex login остаётся полезной ручной приёмкой, но manager visibility, authenticated route и takeover/send gate уже подтверждены на staging.
