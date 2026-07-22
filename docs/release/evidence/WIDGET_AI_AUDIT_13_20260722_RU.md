# Аудит #13: качество ответов website widget AI

Status: predeploy_passed; fresh staging evidence pending  
Date: 2026-07-22  
Environment target: staging only

## Вывод

Плохой диалог из #14 оказался не одной ошибкой модели. Основные причины находились в app-owned слоях: политика не умела помогать при неопределённости, память не защищала от семантического повтора, неподтверждённый контекст проходил до ответа, а повторное раздражение не переводило диалог менеджеру. Поэтому смена модели не является основным исправлением этого набора ошибок.

Исправление закрепляет поведение детерминированно до и после model path. Модель по-прежнему помогает формировать grounded plan, но не может вернуть перечисленные ошибки в customer-visible ответе.

## Разбор исходного диалога

| Наблюдение | Failure mode | Владелец причины | Исправление | Регрессия |
|---|---|---|---|---|
| После `не знаю` повторялась товарная классификация | bad next question, robotic phrasing | policy + renderer | guided choice без требования знать внутреннюю классификацию | `issue14_uncertainty_guided_choice` |
| После повторного `не знаю` задавался семантически тот же вопрос | repeated question | memory + normalizer | учёт уже заданных слотов и запрет semantic duplicate | `dialogue_duplicate_question_monumentType` |
| `у меня дед` не использовалось как осторожный контекст одного человека | wrong context interpretation | policy | tentative one-person context с явной оговоркой «как ориентир» | `issue14_tentative_one_person_context` |
| Первое раздражение клиента приводило к очередному вопросу | bad tone | policy + renderer | короткое признание ошибки и прекращение повторов | `issue14_first_frustration_repair` |
| Повторное раздражение не останавливало AI | missed handoff | policy + send gate | apology + app-owned handoff, `stopAiAfterReply=true` | `issue14_repeated_frustration_handoff` |
| В ответе появлялись Минск и кладбище без слов клиента | unsupported fact | prompt + verifier + post-render guard | запрет unsupported location context и последняя проверка перед persistence | `dialogue_unsupported_location_blocked` |
| Поправка клиента не отзывала выдуманный контекст | stale/unsupported memory | memory + policy | явная ретракция без сохранения производного слота | `issue14_retract_invented_location` |
| Служебный disclosure и состояние отправки выглядели как сообщения | UI ownership | widget UI | один компактный disclosure; truthful sent/accepted/typing states | browser/component regressions widget v1.1.0 |
| Grounded URL показывал внутренние query/entity/anchor | renderer + transport + UI | backend renderer, widget, landing | структурированный catalog reference и exact entity mapping | contract/component/click-through regressions |

## Corpus и automated coverage

- Корпус: `granit_widget_eval.real_dialogs.v5`, 45 client-style cases.
- Пять отдельных multi-turn cases фиксируют исходный диалог #14 по шагам.
- Детерминированный тест воспроизводит полную последовательность, включая неопределённость, `у меня дед`, первое и повторное раздражение.
- Отдельно проверяются ретракция выдуманного location context, semantic duplicate, post-render guard и разрешение location wording только при наличии visitor evidence.
- Для каждого case зафиксированы ожидаемые `action`, requested slot, запрещённые фразы и, где нужно, handoff.

## Дополнительный transport-аудит

При проверке async flow найдены и исправлены три restart-сценария:

1. Потеря подтверждения после commit assistant message больше не вызывает вторую генерацию: worker находит уже сохранённый idempotent reply.
2. Устаревшая попытка worker не может завершить задачу после повторного lease claim: finish fenced по `attempt_count`.
3. Временная ошибка repository/DB не завершает polling loop навсегда: следующая итерация продолжает работу, ошибка журналируется.

Это покрыто тестами `widget-ai-job-worker.test.ts`; durable queue хранится в `widget_ai_jobs` из migration `0016_widget_ai_jobs.sql`.

## Catalog/knowledge boundary

- Customer-visible ссылки строятся только из verified published `/frontend/url` claim.
- В ответе сохраняется структурированная ссылка; raw technical URL удаляется из текста.
- Widget разрешает только каноническую same-origin форму `/catalog.html?section=...&entity=ent_...#block-...`.
- Landing mapping содержит 121 точное соответствие entity → catalog card; для «Арфа» это `ent_1395cd250bbce644514c7e44` → `pm-v-003`.
- Неизвестные или malformed references не превращаются в произвольные ссылки. Это намеренное safe degradation, а не заявка на полноту будущего каталога.

## Predeploy artifacts

| Компонент | Branch / commit | Artifact |
|---|---|---|
| `granit-operations` | `agent/widget-issues-14-17` / `12b428098c37014daf78a3b330199e9949b5460d` | API, policy, contracts, queue, migration |
| `business-ai-web-widget` | `agent/widget-issues-14-17` / `d21589b4e8e103180d3fa5cbf9d808e5b2ad82ad` | `granit-site-widget-v1.1.0.zip`, SHA-256 `b96831048b47672025f833893a6463ccb91a029a2d6d7eeb5fab8212c8f9b5f0` |
| `landing-granit-static` | `agent/widget-issues-14-17` / `d8d01b03d37afc84e0843fe8819e04d8e862a22a` | content-addressed runtime `d21589b...`, entity map |

## Predeploy checks

| Check | Result |
|---|---|
| Operations full suite | PASS — 20 files, 171 tests |
| Operations typecheck/build | PASS |
| Offline eval dry-run | PASS — corpus v5, 45 cases, 465 published / 16 draft records |
| Widget unit/component suite | PASS — 85 tests |
| Widget browser suite | PASS — 26 Playwright tests |
| Widget build/package/runtime smoke | PASS |
| Landing static/manifest/entity-map smoke | PASS |
| Landing Chromium integration smoke | PASS — v2 request, pending/accepted/typing/replied and exact «Арфа» card |
| `git diff --check` | PASS in all three repositories |

## Fresh staging evidence

Этот раздел намеренно остаётся pending до развертывания точных immutable SHA. Нужно подтвердить отдельно:

- migration `0016` и worker flag только на staging;
- measured time-to-ack отдельно от time-to-reply;
- exact #14 multi-turn behavior и manager handoff;
- clickable «Арфа» label без technical URL и переход к exact card;
- reload/history, timestamps, degraded/takeover terminal states;
- desktop/mobile screenshots и визуальную проверку;
- отсутствие production изменений.

До заполнения этого раздела аудит #13 не считается полностью закрытым.
