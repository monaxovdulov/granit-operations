# Активация автоматического `main → staging`

Дата: 2026-08-27 UTC
Статус: passed

## Проверенная связка

| Объект | Точное значение |
|---|---|
| Base SHA | `f827cf39f87fb36b324b4ba92d7e689054efc5fb` |
| Первый автоматически выложенный SHA | `4e84d7bde22200ab032c05f7309b4260b258d0bf` |
| GitHub Actions run | `33110375712` |
| Landing `main` во время deploy | `d0ad27ef24bf2d699d3e11d80216eacee0db9f17` |
| Catalog SHA-256 | `73086e6635f56a841df31552ef402caf2d2ac960d1e0d3f24f6aaae04139b710` |
| Active operations image ID | `sha256:7910bd8343b0921c7d750327e9719c3f37b7f8c7f5f51f0b09519e63c7ad5e41` |

Run: <https://github.com/monaxovdulov/granit-operations/actions/runs/33110375712>

## Installation и trust boundary

- На staging установлены root-owned exact copies deployer, release validator и
  forced-command gate из `4e84d7b...`; локальные и установленные SHA-256
  совпали.
- GitHub Actions login key ограничен `restrict` и
  `command="/usr/local/sbin/granit-operations-deploy-gate"`; произвольная
  команда была отклонена с exit `126`.
- Для GitHub Actions login, `granit-operations` fetch и
  `landing-granit-static` fetch созданы три разные ED25519 identity.
- Оба repository deploy key read-only и verified. Private fetch keys остались
  только на staging; Actions получает только отдельный login key.
- Environment `staging` разрешает deployment только из branch `main` и хранит
  две variables и два secrets без публикации значений secret.
- Actions ограничены GitHub-owned actions, default `GITHUB_TOKEN` read-only.

Перед активацией Compose имел legacy `release-gate-e075d30` image binding,
`build` и override `OPERATIONS_RELEASE_SHA`. Текущий image был сначала сохранён
под `granit-staging-ops-api:latest`; Compose backup:
`/srv/botops/compose.yml.pre-autodeploy-20260827T194706Z`, исходный SHA-256
`1e0b24d8289ed184fdc075c3220b05d7b70a2767ecd04d19617fb1d65b6c3c03`.
После перехода на immutable contract контейнеры не пересоздавались до deploy,
а local/public health оставались на предыдущем `e075d30...`.

## GitHub release gate и deploy

Первый dispatch дошёл только до SSH client и завершился до server connection:
публичный runner не резолвил `giorno.aeza.network`. Runtime не менялся. Binding
заменён на публичный IP `46.226.165.215`, а exact IP known-hosts line получена
из ранее доверенного ED25519 host key, не через runtime `ssh-keyscan`.

Повторный run прошёл:

- deploy Python tests: passed;
- repository tests: passed;
- build/typecheck/architecture gate: passed;
- release gate duration: `1m40s`;
- deploy duration: `2m22s`;
- sanitized terminal event связал operations SHA, landing SHA и catalog hash из
  таблицы выше.

## Smoke exact SHA

- `GET http://127.0.0.1:3101/health`: `200`,
  `release.operationsSha=4e84d7b...`;
- `GET https://manager.botops.ru/health`: тот же exact SHA и release metadata;
- active image label `org.opencontainers.image.revision`: exact `4e84d7b...`;
- manager root: `302` на `/manager`; manager shell содержит `id="root"` и
  `/manager/assets/*`;
- CORS preflight с origin `https://preview.granitkr.ru`: `204`, exact allowed
  origin, методы `GET, POST, OPTIONS`, headers `content-type, accept`.

До deploy и после всех проверок container IDs PostgreSQL и Caddy не изменились:

- PostgreSQL: `352e27d26a04`;
- Caddy: `f3c5135f63cf`.

Пересоздавался только `ops-api`.

## Live rollback drill

После успешного deploy выполнен distinct-image failure drill. Предыдущий image
`sha256:80f9506c16bd1f97470bc7a6ffa06babd979bc1e48a5cdd86c7d51b2a9570eb1`
был подставлен как candidate. Он не прошёл current health contract, после чего
тот же `activate_candidate` автоматически:

1. вернул `latest` на новый image `sha256:7910bd...`;
2. пересоздал только `ops-api`;
3. дождался local/public health с `4e84d7b...`;
4. подтвердил running image ID.

Candidate command завершилась ненулевым exit, как и должен завершаться красный
deploy; recovery был затем независимо подтверждён по health, image ID и label.
После recovery manager и CORS smoke повторно прошли; PostgreSQL и Caddy сохранили
прежние container IDs. Deploy lock освобождён.

## Границы и safe refusal

Не выполнялись migrations/schema changes, изменение `.env.runtime`, prompt,
model/tool policy, live model calls, landing deploy, production deploy или
перезапуск PostgreSQL/Caddy. Автоматизацию можно безопасно остановить удалением
environment login secret либо forced-command key; runtime остаётся на текущем
image. Полный server-config rollback доступен через сохранённый Compose backup и
предыдущий image ID.
