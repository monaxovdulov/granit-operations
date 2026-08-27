# Автоматический deploy backend/manager `main → staging`

Статус: active; первый exact-SHA deploy и rollback drill приняты 2026-08-27.

## Что делает схема

```text
push в granit-operations/main
  -> clean GitHub-hosted checks без deploy secrets
  -> staging environment job без checkout/исполнения repo-кода
  -> forced-command SSH передаёт только exact SHA
  -> staging заново читает current operations/main и landing/main
  -> catalog parity
  -> immutable image build
  -> recreate только ops-api
  -> local/public health с exact operations SHA
  -> rollback предыдущего image при любой ошибке после переключения
```

Landing продолжает выкладываться своим gate из
`landing-granit-static/main`. Этот workflow не вызывает landing deploy,
миграции, model API, production или другие Compose services.

## Versioned файлы

- `.github/workflows/deploy-staging-backend.yml` — checks и SSH dispatch;
- `deploy/staging/granit-operations-deploy-gate` — forced-command wrapper;
- `deploy/staging/deploy_operations_staging.py` — server orchestration;
- `deploy/staging/operations_release.py` — catalog/release validation;
- `deploy/staging/Dockerfile.operations` — digest-pinned staging image.

GitHub Actions использует official actions, pinned на full commit SHA, read-only
`GITHUB_TOKEN`, `persist-credentials: false` и отключённый package cache. Deploy
job не checkout-ит репозиторий и не запускает `npm`/Python из него.
Трёхчасовой timeout deploy job превышает сумму худших server-side timeout,
включая полный проверяемый rollback; это не разрешение на retry или параллельный
deploy.

## Обязательный read-only preflight

Выполнять на staging под фактическим runtime user без вывода `.env.runtime`:

```bash
test "$(uname -m)" = x86_64
test -f /srv/botops/compose.yml
test -f /srv/botops/.env.runtime
docker compose \
  --env-file /srv/botops/.env.runtime \
  -f /srv/botops/compose.yml \
  config --services
docker compose \
  --env-file /srv/botops/.env.runtime \
  -f /srv/botops/compose.yml \
  config --images
curl --fail --silent http://127.0.0.1:3101/health
curl --fail --silent https://manager.botops.ru/health
```

Продолжать можно только если:

- service называется ровно `ops-api`;
- его resolved image — ровно `granit-staging-ops-api:latest`;
- у `ops-api` нет Compose `build`, `command`, `entrypoint`, `working_dir`,
  `volumes`, `configs` или `secrets`, а Compose environment не переопределяет
  baked `OPERATIONS_RELEASE_SHA`;
- runtime user может читать Compose/env file, писать только в
  `/srv/botops/repos`, `/srv/botops/releases/operations` и deploy lock;
- runtime user может выполнять Docker только в уже принятой staging-модели;
- оба health endpoint показывают одинаковый предыдущий
  `release.operationsSha`;
- production Compose/host не участвуют.

Если contract отличается, не адаптировать deployer на месте: остановить
активацию и согласовать точное изменение versioned файлов.

## Server installation

Нужны три разные SSH identity:

1. GitHub Actions → staging login key. Его public key получает только forced
   command; private key хранится в GitHub staging environment.
2. Staging → `granit-operations` read-only deploy key.
3. Staging → `landing-granit-static` read-only deploy key.

GitHub repository deploy keys не переиспользуются между репозиториями. Private
keys operations и landing остаются только на staging и не попадают в Actions.

Установить root-owned versioned файлы из exact reviewed SHA:

```bash
sudo install -d -m 755 /usr/local/libexec/granit
sudo install -m 755 \
  deploy/staging/deploy_operations_staging.py \
  /usr/local/libexec/granit/deploy-operations-staging
sudo install -m 644 \
  deploy/staging/operations_release.py \
  /usr/local/libexec/granit/operations_release.py
sudo install -m 755 \
  deploy/staging/granit-operations-deploy-gate \
  /usr/local/sbin/granit-operations-deploy-gate
```

Для текущего staging runtime user `devuser` default read-only keys:

```text
/home/devuser/.ssh/operations-main-readonly_ed25519
/home/devuser/.ssh/landing-main-readonly_ed25519
/home/devuser/.ssh/known_hosts
```

Их mode должен быть `600`, каталог `.ssh` — `700`, `known_hosts` — `600`.
Если runtime user или server paths отличаются, активацию остановить и сначала
изменить/проверить versioned defaults; не адаптировать их скрытой shell-обвязкой.
Forced-command wrapper очищает inherited SSH environment через `env -i`, а
security-critical remote/key/known-hosts bindings не имеют env overrides.

В `authorized_keys` runtime user public deploy key из GitHub Actions должен
иметь forced command и запрет дополнительных SSH-возможностей:

```text
restrict,command="/usr/local/sbin/granit-operations-deploy-gate" ssh-ed25519 <public-key> granit-operations-staging-actions
```

До добавления ключа проверить, что server OpenSSH поддерживает `restrict`.
Не добавлять unrestricted копию этого public key.

## GitHub environment

Создать environment `staging`, разрешить deployment только из branch `main` и
добавить:

| Kind | Name | Значение |
|---|---|---|
| Variable | `STAGING_DEPLOY_HOST` | staging SSH hostname |
| Variable | `STAGING_DEPLOY_USER` | фактический runtime user |
| Secret | `STAGING_DEPLOY_SSH_KEY` | private forced-command login key |
| Secret | `STAGING_DEPLOY_KNOWN_HOSTS` | заранее проверенная exact host-key line |

Не получать `known_hosts` через `ssh-keyscan` внутри workflow. Fingerprint
сверяется отдельным доверенным каналом до записи secret.

Рекомендуемые repository settings:

- Actions разрешены только из GitHub и локального репозитория;
- third-party actions требуют full-length SHA;
- default `GITHUB_TOKEN` permissions — read-only;
- environment secrets доступны только deployment branch `main`.

## Активация и проверка

Активация — отдельное внешнее действие: server install, GitHub settings/secrets,
commit/push versioned diff и первый `main` run. Оно требует явного разрешения
владельца.

Первый run считается успешным только если:

1. `Release gate` прошёл Python tests, `npm test` и `npm run build`;
2. deploy log содержит только sanitized event с operations SHA, landing SHA и
   catalog SHA-256;
3. `GET http://127.0.0.1:3101/health` и
   `GET https://manager.botops.ru/health` показывают exact pushed SHA;
4. container image label `org.opencontainers.image.revision` равен этому SHA;
5. PostgreSQL, Caddy, landing и production не пересоздавались;
6. manager shell и публичный CORS smoke не регрессировали.

## Fail-closed и rollback

До переключения любая ошибка оставляет текущий staging без изменений:

- красные tests/build;
- SHA уже не current `main`;
- operations или landing Git fetch недоступен;
- каталог расходится;
- Compose image/service contract расходится;
- candidate image metadata не содержит exact SHA.

После переключения красный local/public health, новый push во время deploy или
другая post-smoke проверка возвращает image ID реально запущенного до deploy
контейнера под tag `latest` и
пересоздаёт только `ops-api`. Если автоматический rollback тоже красный,
deployer завершает работу отдельной явной ошибкой; нельзя считать staging
зелёным до ручного восстановления предыдущего image и exact SHA.

Чтобы безопасно остановить будущие автоматические deploy без изменения текущего
runtime, сначала отключить workflow или удалить доступ deploy key/environment
secret. Не удалять active image и release checkout до отдельной cleanup-задачи.
