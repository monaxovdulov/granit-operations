# Staging release gate: landing, каталог и operations

Статус: `owner_authorized_simplification`.

## Один результат

`preview.granitkr.ru` принимает только exact SHA ветки
`monaxovdulov/landing-granit-static/main` и только тогда, когда SHA-256
опубликованного `catalog-index.v1.json` совпадает с pinned catalog текущего
`granit-operations` staging. Состояние staging показывает точные SHA обоих
репозиториев и catalog version/hash.

## Base и источники истины

- исходный operations для упрощения:
  `e075d30f3b13bd23454cf8edfc13b1f5624860f2`, ветка
  `agent/ai-layer-refactor`;
- исходный landing remote main:
  `7ad23165eb18dbbbf8953d8242aaae90c0f5e888`;
- текущий preview release:
  `7ad23165eb18dbbbf8953d8242aaae90c0f5e888`;
- pinned catalog version: `landing-catalog.34e6b5f78a6e`;
- pinned catalog SHA-256:
  `73086e6635f56a841df31552ef402caf2d2ac960d1e0d3f24f6aaae04139b710`;
- архитектурный контракт каталога:
  `docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md`, раздел 3.1;
- server-side release gate: `/usr/local/sbin/granit-deploy-gate` и
  `/usr/local/libexec/granit/validate-preview-release` на preview-хосте;
- server-side shallow cache landing Git:
  `/srv/granit-prod/repos/landing-granit-static.git`;
- существующий deploy wrapper после gate: `/usr/local/sbin/granit-deploy`.

Пользовательский dirty work в обоих основных checkout не изменяется. Рабочие
изменения выполняются в отдельных clean worktree.

## Scope

- versioned landing catalog index;
- operations health release metadata с operations SHA и pinned catalog
  provenance;
- server-side проверка landing SHA и получение exact Git tree текущего `main`
  через read-only GitHub deploy key и persistent shallow cache вместо полного
  клонирования репозитория при каждом deploy;
- server-side сборка deploy archive и `release.json` из доверенного Git tree и
  live operations metadata до переключения preview symlink;
- workflow из `landing/main`, который передаёт серверу только SHA;
- ручной безопасный запуск workflow только для `main`;
- русская FAQ-методичка с типовыми действиями, ошибками и rollback;
- согласованный commit/push, установка server gate и landing deploy. Backend
  image не пересобирается, потому что catalog hash не изменился.

## Вне scope

- production symlink, production Caddy routes и production deploy;
- изменение prompt/model/tool/send-gate или платный model eval;
- DB schema/migration;
- автоматическое удаление старых releases, Docker images или логов;
- перенос каталога в сетевой runtime fetch, vector DB или третий репозиторий.

## Done when

1. feature-branch SHA и произвольные файлы из CI отклоняются server-side, а
   deploy archive собирается самим сервером из текущего `main`;
2. повторный deploy использует server Git cache и не клонирует весь landing с
   нуля;
3. main SHA с неверным catalog hash отклоняется;
4. новый landing SHA с прежним catalog hash не требует backend rebuild;
5. согласованный main SHA разворачивается и публикует release metadata;
6. operations `/health` и landing `/release.json` показывают одну catalog
   version/hash и точные runtime SHA;
7. live browser journey открывает полноразмерные примеры и deep-link каталога;
8. backend остаётся новым full-conversation runtime;
9. production target и production symlink не меняются.

## Риски и rollback

- Ошибка центрального gate может заблокировать staging deploy. Rollback:
  восстановить сохранённую предыдущую версию validator и повторно проверить
  совместимый SHA из `main`. Production при этом не переключается.
- Несогласованная catalog pair должна fail closed, а не публиковаться частично.
- Повреждённый server Git cache блокирует deploy. Его можно удалить и заново
  инициализировать из `main`; активный preview release от этого не меняется.
- Landing rollback допустим только к release, чей catalog hash совпадает с
  operations. Operations rollback выполняется совместно с совместимым landing
  release.
- Read-only GitHub deploy key хранится только на preview-хосте, не попадает в
  Git, release archive или логи.

## Методичка владельца

Типовые ситуации, готовые формулировки запросов и расшифровка ошибок находятся
в `docs/runbooks/STAGING_LANDING_CATALOG_FAQ_RU.md`.
