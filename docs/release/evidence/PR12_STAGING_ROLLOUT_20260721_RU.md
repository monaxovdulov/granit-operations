# Evidence: PR12-STAGING-ROLLOUT-20260721 — catalog URL grounding fix

Status: passed
Date: 2026-07-21
PR: `#12`
Environment: staging

## Развёрнутый состав

- Operations branch: `agent/catalog-knowledge-staging`.
- Развёрнутый behavior SHA: `ebdc6b22a0887714ac537ba446950e5c79a25dda`.
- Предыдущий staging SHA: `72908c7d1fc173e9cd620b2222fdefa00e3ad5dc`.
- Новый container image: `sha256:c90fdd6dc911d224cbffc426566640913d61f30c62102d9b824f9720b3f8fecc`.
- Rollback image: `granit-staging-ops-api:rollback-72908c7d-20260721T132734Z`, image `sha256:cc91e361e494dfd942690ddeabb36727690eb846f4f52cc073e44f826eea72fe`.
- Публичные URL: `https://preview.granitkr.ru/catalog.html`, `https://manager.botops.ru`.
- Production и landing deployment не изменялись. Telegram AI outbound не включался.

Коммит, добавляющий этот evidence-файл после rollout, является documentation-only и намеренно не входит в runtime image. Развёрнутый behavior-кандидат остаётся точным SHA выше.

## Predeploy и backup

- Worktree кандидата был clean и detached на точном behavior SHA.
- Remote branch и локальный кандидат перед rollout совпадали.
- Между предыдущим staging SHA и кандидатом нет изменений в `packages/db/migrations`.
- Compose validation: `docker compose config --quiet` — PASS.
- DB backup: `/srv/botops/backups/pre-pr12-ebdc6b22-20260721T132734Z.dump`.
- Backup integrity: PostgreSQL custom archive, `pg_restore --list` — PASS; размер `216684` bytes, mode `600`, SHA-256 `cbbfa29b3edb746f3f111fc2155adc330cef61067a38e90f9b324bcdb94eb889`.
- Compose backup: `/srv/botops/compose.yml.pre-pr12-ebdc6b22-20260721T132734Z`.

## Runtime-конфигурация

- `AI_WIDGET_ENABLED=true` подтверждён без вывода credential values.
- `OPENAI_API_KEY` присутствует; значение не читалось и не записывалось в evidence.
- `AI_WIDGET_GROUNDED_MODE=enforce` явно закреплён в staging compose.
- CORS allowlist содержит только точный origin `https://preview.granitkr.ru` для widget path.
- Generator/verifier: `gpt-5.4-mini`; generator timeout `12000` ms, verifier timeout `15000` ms, общий deadline `30000` ms.
- `DATABASE_SEARCH_PATH=grounded,public` сохранён.

## Проверки после rollout

| Check | Result | Evidence |
|---|---|---|
| Docker build | PASS | monorepo typecheck и manager Vite build прошли внутри build stage |
| API/PostgreSQL | PASS | public `/health` — `200`; API running, PostgreSQL healthy |
| CORS exact origin | PASS | allowed origin — `204` с allow-origin/methods; unrelated origin — `204` без allow-origin/methods |
| Catalog dry-run | PASS | 40 cases; 465 published / 16 draft; catalog hash `c383a4f9...fa699` |
| Public catalog contract | PASS | `Арфа`, entity `ent_1395cd250bbce644514c7e44`, block `block-vertical-monuments` и точный URL присутствуют в live `data/catalog.json`; deep link — `200` |
| Live grounded reply | PASS | synthetic POST — `202`, `automation=replied`, latency `11105` ms; канонический URL присутствует |
| Semantic verifier | PASS | AI run `replied`, verdict `pass`, violations `[]`, catalog version/hash совпали |
| Persistence/history | PASS | public history: `visitor`, `ai_assistant`; после второго хода — `visitor`, `ai_assistant`, `visitor` |
| Manager visibility | PASS | authenticated `GET /manager/leads/:id` — `200`, оба исходных сообщения видимы |
| Manager takeover | PASS | authenticated PATCH — `200`, `manager_active`, `agent_allowed_to_reply=false` |
| Atomic send gate | PASS | следующий synthetic POST — `202`, `fallback`, reason `agent_reply_blocked`; AI message count не вырос |
| Temporary auth cleanup | PASS | logout — `204`; две созданные smoke manager sessions отозваны, активных — `0` |
| Runtime errors | PASS | после rollout в API log не обнаружены ответы `4xx/5xx` |

Успешный AI-ответ:

```text
Показываю памятник «Арфа»: /catalog.html?section=pamyatniki&entity=ent_1395cd250bbce644514c7e44#block-vertical-monuments
```

## Safe fallback evidence

Перед успешным минимальным regression-кейсом были три отдельные synthetic-попытки:

- две завершились `turn_timeout` при latency около 12–16 секунд;
- одна дошла до каталога и verifier, но app-side evidence validation вернула `grounding_validation_failed` / `invalid_slot_evidence`;
- ни в одном из этих случаев неподтверждённый AI-текст не был опубликован: public API вернул `degraded` с `retry_available`;
- все три synthetic conversations после проверки переведены takeover-ом в `manager_active`; активных synthetic AI conversations не осталось.

Это фиксирует наблюдаемую нестабильность внешнего model path, не маскируя её увеличением staging timeout. Успешный эталонный запрос затем прошёл весь путь за 11,1 секунды.

## Rollback

Быстрый rollback не требует DB restore, потому что миграций и преобразований данных в rollout не было:

1. вернуть `/srv/botops/compose.yml.pre-pr12-ebdc6b22-20260721T132734Z` как активный compose;
2. вернуть rollback image tag на `granit-staging-ops-api:latest`;
3. пересоздать только `ops-api` без зависимостей;
4. подтвердить local/public health и CORS.

DB archive сохранён как аварийная точка восстановления; применять его без отдельной причины не требуется.

## Ограничения

- Проверены публичный API, persistence, manager read model и takeover route. Полноценный ручной визуальный проход manager UI после Yandex login остаётся отдельной необязательной приёмкой.
- Production deployment/config требуют отдельного разрешения и в этом rollout не затрагивались.
