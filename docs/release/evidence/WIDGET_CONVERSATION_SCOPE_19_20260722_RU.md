# Issue #19: единый website widget conversation scope между страницами

Status: staging_passed; production_untouched

Date: 2026-07-22

Environment: `https://preview.granitkr.ru`, staging only

Issue: `granit-operations#19`

## Итог

Разговор website widget больше не меняется при переходе между главной страницей и каталогом.
Исправление отделяет page-specific `widgetInstanceId` от платформенного
`conversationScopeId`. Обе страницы preview используют canonical scope `landing-customer`, при
этом сохраняют собственные mount identities `landing-main` и `landing-catalog`.

Backend, database schema и AI runtime не менялись. Production не разворачивался; все связанные
PR остаются draft.

## Root cause и исправление

До исправления session store хранил `public_session_id` только под
`sw:<widgetInstanceId>:public_session_id`. Главная и каталог использовали разные instance IDs,
поэтому один origin выбирал две независимые browser sessions.

Widget `v1.1.3` вводит:

- `conversationScopeId` — canonical namespace только для `public_session_id`;
- `legacyConversationScopeIds` — ordered aliases для безопасной однократной миграции;
- versioned marker `sw:<conversationScopeId>:legacy_session_migration_v1`, исключающий
  восстановление старой session после явного clear;
- сохранение open state и panel size по прежнему page-specific `widgetInstanceId`.

Canonical key всегда имеет приоритет. При его отсутствии выбирается первый валидный legacy UUID.
Для preview порядок фиксирован как `landing-main,landing-catalog`: конфликт детерминированно
выбирает main session, backend conversations не объединяются, оба legacy keys остаются на месте
для rollback.

## Immutable revisions

| Компонент | Branch / revision | Evidence |
|---|---|---|
| `granit-operations` | `agent/widget-issues-14-17` / `a0559d870f00cc733dfb85586a367f107fc96d12` | accepted design и migration/rollback contract |
| `business-ai-web-widget` | `agent/widget-issues-14-17` / `1d3602e8c5f0eff7af9538dbf114a9336ade05c7` | source widget `v1.1.3` |
| `landing-granit-static` | `agent/widget-issues-14-17` / `0e231a2871857926b67c2a5ae6f5af5dc78303c4` | deployed preview workflow `29966514905`, success |

Artifact checksums:

| Artifact | SHA-256 |
|---|---|
| `granit-site-widget-v1.1.3.zip` | `432ad14d198ab0e9c9499e33488f093fbc3699b8c5b27053c453828ce4081346` |
| `loader.js` | `11e6f318f0209698cd27438a627c0238a071cab86f1e86354215eaf5db321e4e` |
| `site-widget.esm.js` | `5183acd6cfa35fa636bb35875e14e3641308781155dfe1641eaa7573826901a7` |

Landing vendor-ит одинаковые bytes в `v1.1.3/` и immutable
`by-commit/1d3602e8c5f0eff7af9538dbf114a9336ade05c7/`.

## Automated coverage

| Check | Result |
|---|---|
| Widget TypeScript check | PASS |
| Widget unit/component suite | PASS — 4 files, 92 tests |
| Widget Chromium suite | PASS — 26 tests, 1 worker |
| Widget production build | PASS |
| Package composition/type/import/secret verification | PASS — 74 files, no findings |
| Runtime ZIP build and HTTP smoke | PASS — exact source commit, loader/ESM/manifest MIME, one intercepted stub request |
| Landing catalog/static smoke | PASS — 10 sections, 56 blocks, 465 published / 16 review-gated draft records, 462 verified links, 860 asset references |
| Deploy workflow YAML and manifest/hash contract | PASS |
| Landing local Chromium integration smoke | PASS |
| Preview deployment | PASS — workflow `29966514905`, 19 seconds |
| Staging read-only continuity smoke | PASS |

## Local browser regression

Committed harness `.github/scripts/w0-browser-smoke.mjs` использует реальный vendored runtime и
перехваченный deterministic API fixture. Он проверил:

1. main создаёт canonical session только после server acknowledgment;
2. `✓ Отправлено` появилось за 10.4 ms, затем тот же visitor bubble получил `✓✓ Принято`;
3. persisted answer, authoritative timestamps и `manager_active` terminal marker появились из
   history;
4. structured action открыл точную карточку «Арфа»;
5. catalog, reload catalog и возврат на main восстановили один transcript;
6. за весь основной flow был один POST и четыре history GET;
7. main-only, catalog-only и two-key conflict migration cases прошли реальную навигацию main →
   catalog без POST; каждый case выполнил два history GET;
8. conflict case выбрал `landing-main`, legacy keys не удалялись.

Неожиданные внешние запросы блокировались. Реальный backend/model локальный smoke не вызывал.

## Staging evidence

Использована существующая QA session
`656dc426-a9f3-48de-8afc-6e8cd1d5e4bb`, ранее зафиксированная в evidence issues #13–#17.
Проверка была read-only: browser route блокировал любой POST и разрешал только preview static GET
и exact `site_widget.history.v2` GET.

Результат `STAGING_WIDGET_CONTINUITY_READ_ONLY_OK`:

- deployed runtime source commit: `1d3602e8c5f0eff7af9538dbf114a9336ade05c7`;
- landing commit: `0e231a2871857926b67c2a5ae6f5af5dc78303c4`;
- journey: main → structured «Арфа» action → exact catalog card → reload catalog → main;
- canonical `public_session_id` не изменился;
- conversation state `ai_active` не изменился;
- transcript: 2 persisted messages, одинаковые public identities и порядок на всех шагах;
- authoritative timestamps, delivery states и acceptance markers совпали на всех шагах;
- history GET: 4;
- POST: 0;
- action href:
  `/catalog.html?section=pamyatniki&entity=ent_1395cd250bbce644514c7e44#block-vertical-monuments`.

Staging session была `ai_active`; сохранение `manager_pending` / `manager_active` terminal state
проверено тем же navigation harness локально с strict `site_widget.history.v2` fixture и source
component regression с manager-active history.

## Acceptance criteria

| Criterion | Result |
|---|---|
| Один `public_session_id` на customer-facing страницах preview | PASS |
| Transcript, timestamps, delivery markers и terminal manager state сохраняются | PASS |
| Catalog → main сохраняет разговор | PASS |
| Reload не создаёт POST или AI job | PASS — read-only staging POST count 0 |
| Безопасная legacy migration | PASS — canonical priority, ordered conflict policy, no merge/delete, clear marker |
| Browser regression с exact catalog card | PASS |
| Static smoke блокирует расхождение identity | PASS — exact common scope и ordered aliases на обеих страницах |
| Staging first, production untouched | PASS |

## Rollback

Landing rollback: повторно развернуть preview revision
`70d21eaee5bf496ade54fa654ffe007810776b0e`, которая использует widget source
`47448eb06a009c53a31903108f73361c847ac55f` (`v1.1.2`). Старые immutable runtime directories и
legacy keys сохранены.

Backend rollback не требуется: backend и DB не менялись.

## Remaining boundary

- Production deploy и production verification не выполнялись.
- Draft PR merge/ready state не менялся.
- Две ранее существовавшие разные backend conversations не объединяются автоматически; conflict
  policy только выбирает один canonical browser session и сохраняет оба legacy keys.
