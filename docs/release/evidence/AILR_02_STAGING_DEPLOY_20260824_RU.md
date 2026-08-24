# AILR-02 — staging deploy 2026-08-24

Статус: `deployed_for_owner_manual_check`.

Окружение: только staging. Production не изменялся.

## Развёрнутый runtime

| Компонент | Точная версия |
|---|---|
| Backend/manager source | `granit-operations@b7542d3e0b59b746332f69f81b08a60f30be9599` |
| Container image | `sha256:c001bf29c8cde58d05bce46144019df4d9d4bd244305cfbd431dcd1a748ab045` |
| Container revision label | `b7542d3e0b59b746332f69f81b08a60f30be9599` |
| Preview | `https://preview.granitkr.ru/` |
| Public backend | `https://manager.botops.ru` |

Создан immutable checkout
`/srv/botops/releases/operations/b7542d3e0b59b746332f69f81b08a60f30be9599`.
Образ собран из exact SHA; repository architecture guard прошёл 21/21,
bounded API/manager typecheck и manager Vite build прошли. Пересоздан только
staging service `ops-api`; PostgreSQL и Caddy не перезапускались. Миграции не
запускались, потому что срез не меняет схему.

Runtime flags для widget и job worker включены, server-side OpenAI key
присутствует; секретные значения не читались и не записывались. Текущая
runtime-модель осталась без изменения: `gpt-5.4-mini`.

## Проверки после запуска

| Проверка | Результат |
|---|---|
| `http://127.0.0.1:3101/health` | `200`, `granit-operations-api` |
| `https://manager.botops.ru/health` | `200`, `granit-operations-api` |
| `https://preview.granitkr.ru/` | `200` |
| Exact-origin CORS | `204`, origin `https://preview.granitkr.ru`, methods `GET, POST, OPTIONS` |
| Ошибочный origin `https://preview.granito.ru` | ACAO отсутствует |
| Container state | running на exact revision |
| Логи после старта | 14 startup/health/preflight lines, 0 error-pattern lines |

Visitor POST, платный model call, manager takeover и browser interaction не
выполнялись. Ручная проверка владельцем остаётся обязательным release gate.
Кнопки нового каталога не входят в AILR-02 и этим deploy не заявляются.

Во время `npm ci` повторились унаследованные предупреждения: Node `22.12.0`
ниже declared engine `>=22.19.0` для `undici@8.10.0`, а npm audit сообщает
9 dependency vulnerabilities. Сборка завершилась успешно; предупреждения не
исправлялись в deploy-only действии.

## Откат

Предыдущий backend:
`d3ce2908faeb2905c54e635cf5b00925296eed3a`, image
`sha256:f3c65292cace9b6bc273ebc13f9a6d1eee7894ff13e24320ce1b28b16f51fa44`.

- compose backup:
  `/srv/botops/compose.yml.pre-ailr02-20260824T210339Z`;
- previous image tag:
  `granit-staging-ops-api:rollback-d3ce2908-pre-ailr02-20260824T210339Z`.

Так как миграций не было, откат БД не требуется. Для runtime rollback нужно
вернуть compose backup и пересоздать только `ops-api` с существующим rollback
image.
