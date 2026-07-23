# Аудит #13: качество ответов website widget AI

Status: staging_passed; production_untouched

Date: 2026-07-22

Environment: `https://preview.granitkr.ru`, staging only

## Итог

Issues #14–#17 реализованы и проверены на staging. Исходный плохой диалог из #14 воспроизведён по шагам: неопределённость теперь получает guided choice, контекст одного человека используется только как осторожный ориентир, первое раздражение останавливает повтор вопроса, а повторное раздражение передаёт диалог менеджеру. Неподтверждённые Минск и кладбище в ответ не попадают.

Корневая причина была преимущественно в app-owned слоях — policy, memory/normalizer, renderer, verifier, persistence gate и UI, — а не в выборе модели. Поэтому исправление закреплено детерминированными правилами до и после model path. Смена модели не нужна для закрытия этого класса ошибок.

Выкладка выполнена только на staging. Production, merge-state и готовность draft PR не менялись.

## Разбор исходного диалога

| Наблюдение | Failure mode | Владелец причины | Исправление | Регрессия |
|---|---|---|---|---|
| После `не знаю` повторялась товарная классификация | bad next question, robotic phrasing | policy + renderer | guided choice без требования знать внутреннюю классификацию | `issue14_uncertainty_guided_choice` |
| После повторного `не знаю` задавался семантически тот же вопрос | repeated question | memory + normalizer | учёт уже заданных слотов и запрет semantic duplicate | `dialogue_duplicate_question_monumentType` |
| `у меня дед` не использовалось как осторожный контекст одного человека | wrong context interpretation | policy | tentative one-person context с оговоркой «как ориентир» | `issue14_tentative_one_person_context` |
| Первое раздражение клиента приводило к очередному вопросу | bad tone | policy + renderer | короткое признание ошибки и прекращение повторов | `issue14_first_frustration_repair` |
| Повторное раздражение не останавливало AI | missed handoff | policy + send gate | apology + app-owned handoff, `stopAiAfterReply=true` | `issue14_repeated_frustration_handoff` |
| В ответе появлялись Минск и кладбище без слов клиента | unsupported fact | prompt + verifier + post-render guard | запрет unsupported location context и последняя проверка перед persistence | `dialogue_unsupported_location_blocked` |
| Поправка клиента не отзывала выдуманный контекст | stale/unsupported memory | memory + policy | явная ретракция без сохранения производного слота | `issue14_retract_invented_location` |
| Disclosure и состояние отправки выглядели как сообщения | UI ownership | widget UI | один компактный disclosure; truthful sent/accepted/typing states | widget component/browser regressions |
| Grounded URL показывал внутренние query/entity/anchor | renderer + transport + UI | backend renderer + widget + landing | структурированная catalog reference и exact entity mapping | contract/component/click-through regressions |

## Развёрнутые immutable revisions

| Компонент | Branch / deployed revision | Artifact / deploy evidence |
|---|---|---|
| `granit-operations` | `agent/widget-issues-14-17` / `b72d526a1ac166afd800b79f3315ac4d3e14657f` | staging image `sha256:983beca0d30bba41c7a7a7e92230e60b04b1a5b5b78b8959a44c4e6128b50815` |
| `business-ai-web-widget` | `agent/widget-issues-14-17` / `47448eb06a009c53a31903108f73361c847ac55f` | v1.1.2 ZIP SHA-256 `b3d5a1936cc03dff55722c0fd44d35c8222b446c6abb31cce15c578635044aec` |
| `landing-granit-static` | `agent/widget-issues-14-17` / `70d21eaee5bf496ade54fa654ffe007810776b0e` | successful preview workflow `29955271280`; immutable widget path by commit `47448eb...` |

Дополнительные widget hashes: loader `98b71bd917c1e51ff0fefe50c01fab43a6b64463dd3f2f357410b7a84675d617`, ESM `25c64d28d54261193b49ae1a8c22b966008c98190249fd953ed1313a650e0ab3`.

## Automated coverage

| Check | Result |
|---|---|
| Operations full suite | PASS — 20 files, 171 tests |
| Operations typecheck/build | PASS |
| Offline eval dry-run | PASS — `granit_widget_eval.real_dialogs.v5`, 45 cases |
| Catalog snapshot used by eval | PASS — `granit-cha.catalog.2026-07-20.v1`, SHA-256 `c383a4f954bb784d38df3f25819f1e659c45d52d703cf95321c33fb1ea0fa699`, 465 published / 16 draft |
| Widget unit/component suite | PASS — 87 tests |
| Widget browser suite | PASS — 26 Playwright tests |
| Widget typecheck/build/package/runtime smoke | PASS |
| Landing static/manifest/entity-map smoke | PASS — 10 sections, 56 blocks, 462 verified frontend links, 860 assets |
| Landing Chromium integration smoke | PASS — v2 lifecycle and exact «Арфа» card |

Корпус содержит пять отдельных multi-turn cases исходного диалога #14. Отдельно проверяются correction, semantic duplicate, unsupported location, post-render guard, handoff, retry/lease fencing, restart recovery и idempotent reply recovery.

## Staging rollout

- До migration создан backup `/srv/botops/backups/pre-widget-12b42809-20260722T195410Z.dump`, SHA-256 `9128db8b4378146381f4ddf5570251695211bafe24262547c3a5dbed554fc503`.
- Сохранены compose rollback copy `/srv/botops/compose.yml.pre-widget-12b42809-20260722T195410Z` и image tag `granit-staging-ops-api:rollback-ebdc6b22-20260722T195410Z`.
- Migration `0016_widget_ai_jobs.sql` применена к staging DB; таблица и индексы проверены.
- Worker включён только на staging: poll 250 ms, lease 45 s, retry 1.5 s, максимум 3 попытки.
- Локальный и публичный `/health` вернули `{"ok":true,"service":"granit-operations-api"}`.
- CORS допускает точный origin `https://preview.granitkr.ru`; посторонний origin не получает allow-origin.
- После smoke нет активных `pending`, `processing` или `retrying` jobs. В логах за контрольное окно отсутствуют worker iteration failure, Drizzle query errors и encoding errors.

При rollout были обнаружены и исправлены два staging-дефекта до закрытия задач:

1. Raw SQL передавал `Date` в postgres.js без Drizzle encoder. Lease-запросы переведены на typed `lte(...)`/`isNotNull(...)`; добавлена полная повторная проверка и redeploy.
2. Детерминированная policy сохраняла служебный verdict `app_policy_pass`, не разрешённый DB constraint. Verdict приведён к разрешённому `pass`, добавлена регрессия и выполнен повторный deploy.

## Live functional evidence

### Async delivery, reference и idempotency

Staging session `656dc426-a9f3-48de-8afc-6e8cd1d5e4bb`, conversation `4b43f03e-5943-4b77-bc92-5d5511eaa164`:

- persistence acknowledgment: 305 ms;
- persisted terminal reply: 9.958 s;
- ответ: `Да, модель «Арфа» есть в каталоге. Карточка.`;
- видимый action label: `Посмотреть «Арфа»`;
- structured href: `/catalog.html?section=pamyatniki&entity=ent_1395cd250bbce644514c7e44#block-vertical-monuments`;
- raw technical URL в тексте отсутствует;
- повтор того же idempotency key вернул тот же message id за 60 ms; в DB осталась ровно одна job, `replied`, attempt 1/3.

### Exact #14 multi-turn

Staging session `7ad423af-809d-4c90-965f-181eef62abca`, conversation `c4ed9ece-bed7-4d39-8353-1893b32c123e`:

| Turn | Visitor | Ack / terminal | Проверенный результат |
|---|---|---|---|
| 1 | исходный запрос расчёта | 325 ms / 12.775 s | начальное уточнение |
| 2 | `не знаю` | 22 ms / 712 ms | guided choice без внутренней терминологии |
| 3 | `у меня дед` | 36 ms / 717 ms | осторожный one-person context |
| 4 | первое раздражение | 34 ms / 716 ms | apology/repair без повторного slot question |
| 5 | повторное раздражение | 42 ms / 723 ms | короткий handoff; conversation стал `manager_pending` |

Ни в одном ответе не появились неподтверждённые Минск или кладбище. Отдельный correction smoke на `я ничего про минск не говорил` вернул явную ретракцию: место не учитывается как факт.

### Manager gate и reload

В изолированной staging session `a89ca8cd-d4da-45a7-a002-9cd0064fdfcd` после контролируемого переключения conversation в `manager_active` следующее сообщение получило ack за 158 ms, `automation.status=disabled`, `next_step=manager_review`; AI job не создавалась. Количество jobs осталось 1 → 1.

Widget v1.1.2 после reload восстановил историю и ровно один terminal marker «Сообщение принято. Менеджер проверит детали и ответит вам.»: typing 0, spinner 0, горизонтальный viewport 390/390.

### Safe degradation

Один отдельный live browser prompt про «Арфу» завершился `grounding_validation_failed`. UI правдиво показал спокойный сохранённый/manager marker, без зависшего typing. Это наблюдаемая безопасная деградация verifier/model path, а не ложный ответ или потеря сообщения. Успешный grounded «Арфа» session и exact-card transition подтверждены отдельно; событие оставлено как quality telemetry, не скрыто.

## Screenshot evidence и визуальная оценка

- [Отправлено — desktop](assets/widget-issues-14-17/staging-desktop-sent.png)
- [Принято и typing — desktop](assets/widget-issues-14-17/staging-desktop-accepted-typing.png)
- [Ответ и compact catalog action — desktop](assets/widget-issues-14-17/staging-desktop-replied.png)
- [Точная карточка «Арфа» — desktop](assets/widget-issues-14-17/staging-catalog-arfa-focused.png)
- [История после reload — mobile](assets/widget-issues-14-17/staging-mobile-reloaded-history.png)
- [Manager handoff — desktop](assets/widget-issues-14-17/staging-desktop-manager-handoff.png)
- [Safe degradation — mobile](assets/widget-issues-14-17/staging-mobile-degraded.png)
- [Manager-active после reload — mobile](assets/widget-issues-14-17/staging-mobile-manager-active-reload.png)

Визуально widget согласован с тёплой бежевой палитрой landing, статусы вторичны, но читаемы, disclosure стал компактнее, технический URL скрыт. На mobile нет горизонтального overflow, controls доступны. Header status переносится на две строки, но не ломает layout. Единственное небольшое эстетическое замечание: disclosure/time под ответом занимают дополнительную вертикаль; это не функциональный blocker.

## Catalog/knowledge boundary

- Customer-visible ссылки строятся только из verified published `/frontend/url` claim.
- Backend хранит structured reference, а widget разрешает только каноническую same-origin форму `/catalog.html?section=...&entity=ent_...#block-...`.
- Landing содержит 462 проверенных frontend link mappings; точная «Арфа» entity `ent_1395cd250bbce644514c7e44` ведёт к карточке `pm-v-003`.
- Неизвестные или malformed references не превращаются в произвольные ссылки и безопасно деградируют.

## Rollback и граница выпуска

Backend rollback: вернуть сохранённый compose/image tag, пересоздать только staging `ops-api`; при необходимости восстановить staging DB из зафиксированного dump. Landing rollback: повторно развернуть предыдущую immutable preview revision. Widget runtime content-addressed, поэтому предыдущий loader остаётся доступен для возврата ссылки.

Production не изменялся. Все три PR остаются draft; merge или ready-for-review не выполнялись.
