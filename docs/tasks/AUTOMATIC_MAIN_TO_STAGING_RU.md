# Автоматический `main → staging` для backend/manager

Статус: `done`; live activation и rollback evidence приняты 2026-08-27.

## Результат

Push или merge в `monaxovdulov/granit-operations/main` запускает проверки
репозитория и, только после их успеха, передаёт staging точный commit SHA.
Staging повторно проверяет current `main`, совместимость каталога, собирает
immutable backend image, пересоздаёт только `ops-api` и принимает релиз только
если local/public health показывают этот SHA.

## Base и источники истины

- Base SHA: `f827cf39f87fb36b324b4ba92d7e689054efc5fb`.
- Текущий runtime: исполняемый код, `package-lock.json`, тесты и
  `apps/api/src/release-metadata.ts`.
- Каталог: `apps/api/src/modules/ai/catalog/catalog-index.v1.json` и
  `pinned-catalog-index.ts`.
- Landing boundary: ADR-011 и server-side staging release gate.
- Фактический staging shape: `/srv/botops`, Compose service `ops-api`,
  immutable operations releases и `/health.release.operationsSha`.

## Scope

- GitHub Actions только для `granit-operations/main`;
- полный repository release gate до SSH;
- forced-command SSH, принимающий только точный lowercase SHA;
- server-side fetch exact current `main`, проверка каталога с current landing
  `main`, immutable image build и переключение только `ops-api`;
- smoke exact deployed SHA и автоматический rollback image при красном smoke;
- installation/rollback runbook без значений secrets.

## Вне scope

- production и customer landing deploy;
- DB schema/migrations и persisted data;
- prompt, model, AI policy, flags и runtime secrets;
- commit, push, установка server key, GitHub secrets или live deploy в рамках
  repo-local реализации.

## Done when

1. workflow запускается только от `push` в `main`, имеет read-only token,
   staging concurrency и pinned official actions;
2. SSH получает только `${GITHUB_SHA}` после успешных Python/npm checks;
3. server gate отклоняет не-current SHA и несовместимый landing catalog;
4. build выполняется из server-fetched exact Git tree, а не CI archive;
5. переключается только `ops-api`; DB/Caddy/landing не пересоздаются;
6. local/public health публикуют exact SHA; красный smoke возвращает предыдущий
   image и SHA;
7. локальные тесты, build, workflow inspection и independent review зелёные.

Installation contract и operator rollback описаны в
[`../runbooks/STAGING_BACKEND_AUTODEPLOY_RU.md`](../runbooks/STAGING_BACKEND_AUTODEPLOY_RU.md).
Фактическая активация зафиксирована в
[`../release/evidence/AUTOMATIC_MAIN_TO_STAGING_20260827_RU.md`](../release/evidence/AUTOMATIC_MAIN_TO_STAGING_20260827_RU.md).

## Риски и rollback

- Server-only Compose contract недоступен из текущей SSH-сессии. До активации
  обязателен read-only preflight из runbook; несовпадение image/service contract
  должно блокировать установку.
- Неверный forced-command/runtime binding может заблокировать deploy, но не
  должен менять текущий staging до успешной сборки.
- Rollback repo-local diff: удалить изменения этого task. Runtime rollback:
  deployer возвращает предыдущий image ID под active tag и пересоздаёт только
  `ops-api`; при неуспешном rollback требуется ручная остановка и диагностика.
