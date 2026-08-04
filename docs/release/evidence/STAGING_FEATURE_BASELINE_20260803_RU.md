# Staging feature baseline — 2026-08-03

Status: `feature_baseline_accepted_smoke_pending`
Среда: staging / preview

Эта запись фиксирует текущую staging baseline по продуктовым фичам между активными репозиториями
Granit. Это не полный smoke, не regression evidence и не production approval.

## Точная baseline

| Поле | Значение |
|---|---|
| Landing repo | `monaxovdulov/landing-granit-static` |
| Feature-bearing landing commit | `628e4a07ac4e8a01d8ef4690a9e5529ea5b22cb8` |
| Landing baseline record | `docs/runtime/STAGING_FEATURE_BASELINE_20260803_RU.md` |
| Widget repo | `monaxovdulov/business-ai-web-widget` |
| Widget package | `@monaxovdulov/site-widget` |
| Widget version | `1.1.4` |
| Widget source commit | `c44f99637e097a47b3c53099c95d7e8e01701ad8` |
| Widget release tag | `site-widget-v1.1.4` |
| Backend runtime URL | `https://manager.botops.ru` |
| Backend public health | `{"ok":true,"service":"granit-operations-api"}` |
| Operations repo main at record time | `3ead589a8975944000d14e0cdb25c480afa73bcc` |
| Operations deployed SHA | Неизвестен через public HTTP; `/health` пока не отдает build metadata. |

## Решение

Текущая staging baseline по фичам:

`landing-granit-static@628e4a07` + `@monaxovdulov/site-widget@1.1.4` из
`business-ai-web-widget@c44f9963`, backend runtime URL `https://manager.botops.ru`.

Эта baseline функционально новее и ближе к текущему продукту, чем исторический staging smoke
`CATALOG_RAG_STAGING_20260720_RU.md`. Старый smoke остается валидным evidence для своих exact
historical deployed SHA:

- landing deployed SHA: `5adc4783d8eae2c35d966e54b2e5f185da0813e8`;
- operations deployed SHA: `38a3e9c4d35c7837650456169ee9ebac9846ac46`.

Эта запись не переписывает и не заменяет старый smoke. Она фиксирует новую feature baseline,
а полный staging smoke должен быть оформлен отдельным evidence-документом после проверки.

## Принятый feature scope для staging

- Общий widget conversation scope между главной страницей и каталогом:
  `data-conversation-scope-id="landing-customer"`.
- Миграция legacy browser session из `landing-main` и `landing-catalog`.
- Widget runtime `v1.1.4` с фиксом slow scroll snapback.
- Сохранение истории диалога при переходах между главной, каталогом и reload.
- Catalog deep links из widget/AI replies в точные canonical catalog entity cards.
- Staging UX model `site_widget.v2`: ack/history, delivery markers, typing state, timestamps,
  persisted replies и manager terminal state handling.
- Immutable content-addressed widget runtime path по полному source commit.
- Rollback artifacts в landing сохранены для предыдущих widget runtime с `v1.0.0` по `v1.1.4`.

## Live checks от 2026-08-03

- `https://preview.granitkr.ru/` отдал widget loader из
  `/vendor/granit/site-widget/by-commit/c44f99637e097a47b3c53099c95d7e8e01701ad8/loader.js`.
- Live manifest показал package `@monaxovdulov/site-widget`, version `1.1.4`, git commit
  `c44f99637e097a47b3c53099c95d7e8e01701ad8`.
- `https://manager.botops.ru/health` вернул OK для `granit-operations-api`.
- CORS preflight для `Origin: https://preview.granitkr.ru` на
  `/public/intake/site-widget/messages` вернул `204` и разрешил `GET, POST, OPTIONS`.

В рамках этой записи не выполнялись real visitor message, lead, manager action, OpenAI call,
Mastra call, production deploy или mutation smoke.

## Открытый runtime gap

Backend staging живой, но exact deployed operations SHA не доступен через публичный HTTP. До полного
evidence нужно закрыть один из вариантов:

- добавить commit/build metadata в `/health` или отдельный readonly `/version`;
- либо прочитать server-side release marker/image label через SSH и приложить его в smoke evidence.

До этого нельзя утверждать, что `granit-operations@3ead589a` уже развернут на
`https://manager.botops.ru`; можно утверждать только, что публичный backend runtime жив и разрешает
preview-origin CORS.
