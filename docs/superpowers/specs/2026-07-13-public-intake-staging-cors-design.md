# Staging CORS для public intake

Дата: 2026-07-13  
Статус: одобрено владельцем для staging-only реализации и проверки

## Цель

Разрешить RC-виджету на `https://preview.granitkr.ru` отправлять сообщения в staging API `https://botops.ru/public/intake/*`, не открывая CORS для других origin и не затрагивая manager API, AI, DTO, базу данных, Caddy или production.

## Выбранный подход

Использовать официальный `@fastify/cors` версии `^11.x`, совместимый с Fastify `^5.x`, внутри инкапсулированного Fastify plugin с prefix `/public/intake`. Такой scope ограничивает CORS hook и preflight route только публичными intake-маршрутами.

Конфигурация читается из уже документированного server-only env `PUBLIC_INTAKE_ALLOWED_ORIGINS`. Значение — разделенный запятыми список точных HTTP(S) origin. Пробелы удаляются, дубликаты исключаются. Wildcard, URL с path/query/hash/credentials и не-HTTP(S) значения запрещены; неверная конфигурация останавливает запуск. Пустое значение оставляет cross-origin доступ закрытым.

Для текущего staging разрешается только:

```text
https://preview.granitkr.ru
```

## CORS-политика

- область: только `/public/intake/*`;
- allowed origin: точное совпадение со списком;
- methods: `POST`, `OPTIONS`;
- request headers: `Content-Type`, `Accept`;
- credentials: выключены;
- ответы для разрешенного origin содержат `Access-Control-Allow-Origin` с конкретным origin и `Vary: Origin`;
- запрещенный origin не получает разрешающий CORS header;
- same-origin/server-to-server запрос без `Origin` продолжает работать;
- `/manager/*`, `/auth/*`, `/health` и другие маршруты не получают public-intake CORS headers или preflight route.

## Изменения

1. Добавить `@fastify/cors` в API workspace.
2. Добавить строгий parser `PUBLIC_INTAKE_ALLOWED_ORIGINS` в API config.
3. Передать parsed allowlist в `buildApi`.
4. Зарегистрировать public intake внутри plugin с prefix `/public/intake` и scoped CORS.
5. Обновить environment documentation со staging-примером без секретов.
6. В staging Compose передать env в `ops-api`, добавить значение только в `/srv/botops/.env.runtime`, пересобрать только `ops-api` и не изменять Caddy/production.

## Проверки

- unit/config: trim, dedupe, empty default, invalid/wildcard rejection;
- route: exact allowed preflight и POST, требуемые headers/methods, отсутствие credentials, `Vary: Origin`;
- route: запрещенный origin не получает allow-origin;
- route: same-origin/no-Origin POST работает;
- route: manager GET/OPTIONS не получают public CORS;
- полный typecheck/test/build;
- live browser-harness: реальный preflight и POST с preview, проверка payload, response, console/network, retry/reload/storage/events и ключевого accessibility state.

## Rollback

Вернуть staging `ops-api` на предыдущий образ/commit, удалить только `PUBLIC_INTAKE_ALLOWED_ORIGINS` из staging runtime env и пересоздать только `ops-api`. Caddy, БД и production не меняются.
