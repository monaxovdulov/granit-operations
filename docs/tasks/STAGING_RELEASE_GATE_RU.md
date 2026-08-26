# Staging release gate: landing, каталог и operations

Статус: `owner_authorized_implementation`.

## Один результат

`preview.granitkr.ru` принимает только exact SHA ветки
`monaxovdulov/landing-granit-static/main` и только тогда, когда SHA-256
опубликованного `catalog-index.v1.json` совпадает с pinned catalog текущего
`granit-operations` staging. Состояние staging показывает точные SHA обоих
репозиториев и catalog version/hash.

## Base и источники истины

- operations: `e03a1789dbcfd015d3d4cc06aa553513fa0bc1fe`, ветка
  `agent/ai-layer-refactor`;
- landing remote main: `9d1710867b53323cbd9b99d6642541c7ddd4ec77`;
- текущий preview release:
  `70dfa0e9e78a75cc3d0fc800147e381fe7cd3cf6`;
- release-кандидат landing: `7ad23165eb18dbbbf8953d8242aaae90c0f5e888`;
- pinned catalog version: `landing-catalog.34e6b5f78a6e`;
- pinned catalog SHA-256:
  `73086e6635f56a841df31552ef402caf2d2ac960d1e0d3f24f6aaae04139b710`;
- архитектурный контракт каталога:
  `docs/tasks/AI_REF_AILR_03_CATALOG_SHOW_ONE_SHOT_RU.md`, раздел 3.1;
- server-side enforcement: `/usr/local/sbin/granit-deploy` на preview-хосте.

Пользовательский dirty work в обоих основных checkout не изменяется. Рабочие
изменения выполняются в отдельных clean worktree.

## Scope

- versioned landing catalog index и release manifest;
- operations health release metadata с operations SHA и pinned catalog
  provenance;
- server-side проверка landing SHA и получение exact Git tree текущего `main`
  через read-only GitHub deploy key;
- server-side сборка deploy archive из доверенного Git tree, release manifest и
  live operations metadata до переключения preview symlink;
- workflow из `landing/main`, создающий release manifest и выполняющий deploy;
- русская документация ownership, проверки версии и rollback;
- согласованный commit/push/deploy обоих staging-компонентов.

## Вне scope

- production symlink, production Caddy routes и production deploy;
- изменение prompt/model/tool/send-gate или платный model eval;
- DB schema/migration;
- автоматическое удаление старых releases, Docker images или логов;
- перенос каталога в сетевой runtime fetch, vector DB или третий репозиторий.

## Done when

1. feature-branch SHA и произвольные файлы из CI отклоняются server-side, а
   deploy archive собирается самим сервером из текущего `main`;
2. main SHA с неверным catalog hash или operations SHA отклоняется;
3. согласованный main SHA разворачивается и публикует release metadata;
4. operations `/health` и landing `/release.json` показывают одну catalog
   version/hash и точные runtime SHA;
5. live browser journey открывает полноразмерные примеры и deep-link каталога;
6. backend остаётся новым full-conversation runtime;
7. production target и production symlink не меняются.

## Риски и rollback

- Ошибка центрального gate может заблокировать staging deploy. Rollback:
  восстановить сохранённый wrapper и повторно проверить старый preview SHA без
  переключения production.
- Несогласованная catalog pair должна fail closed, а не публиковаться частично.
- Landing rollback допустим только к release, чей catalog hash совпадает с
  operations. Operations rollback выполняется совместно с совместимым landing
  release.
- Read-only GitHub deploy key хранится только на preview-хосте, не попадает в
  Git, release archive или логи.
