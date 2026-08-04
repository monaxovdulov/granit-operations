# Карточка среза AI-рефакторинга: AI-REF-PR0C — bounded hotfixes

Статус: `accept`; принят третьим fresh independent Reviewer после двух узких
repair-циклов.

Goal: `AI-LIVE-REF-ROADMAP`.

Позиция: `PR 0a accept -> PR 0b accept -> PR 0c -> PR 1`.

Ветка / base SHA / head SHA:
`codex/ai-refactor-agent-governance-design` /
`777d7dca351176b30042fa8b6bd136be041ddc04` /
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.

Фактическая модель: текущая Codex-модель, high reasoning.

## 1. Один результат

Короткий kill-list текущего live widget AI перестаёт fail-open включать grounded
enforce, ошибочно отвечать про дедушку/раздражение/deadline, перетирать
`watching` и немедленно запускать каждый burst-job. Public contract, schema,
prompt/model/tools и архитектура PR1/PR2 не меняются.

## 2. Baseline и источники истины

Источники по приоритету:

1. `docs/architecture/AI_LIVE_AGENT_REFACTOR_FINAL_OWNER_REVIEW_RU.md`, Epic 0
   и PR0c roadmap: fail-closed config, дедушка, bare `когда`, `ты что`,
   `watching`, `availableAt + 600ms`, active kill-list tests.
2. `docs/tasks/AI_REF_001_BASELINE_RECONCILIATION_RU.md`: утверждённый порядок
   Goal и граница PR0c до turn identity/latest-wins.
3. `docs/architecture/AI_REFACTOR_MINIMAL_GOAL_GOVERNANCE_RU.md`: один bounded
   slice, независимый Reviewer и автоматический переход после accept.
4. Живой код и принятые ADR-008/ADR-010: app-owned send gate и runtime остаются
   источником истины.

PR0b принят свежим независимым Reviewer. Его exact-hash PostgreSQL evidence:
migration `4/4`, runtime `13/13`, typecheck/build/M3 green; external DB не
трогалась.

Исполняемое baseline-воспроизведение 2026-08-04 от текущего worktree:

- invalid `AI_WIDGET_GROUNDED_MODE=typo` даёт `groundedMode="enforce"`;
- `памятник для мамы, не разбираюсь` возвращает текст `для дедушки`;
- `ты что посоветуешь?` получает `dialogue_frustration_repair`;
- `когда вы работаете?` нормализуется в
  `commercial_intent_deadline_intake`;
- `persistAiReplyWithSendGate` безусловно ставит `ai_collecting_info`, если
  ответ не handoff, даже для текущего `watching`;
- Postgres и memory enqueue ставят `availableAt=now`.

## 3. Точная область

Разрешённые production-модули:

- `apps/api/src/config.ts`;
- `apps/api/src/modules/ai/policy/widget-ai-dialogue-control.ts`;
- `apps/api/src/modules/ai/rendering/widget-ai-reply-renderer.ts`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- memory repository только для parity `availableAt + 600ms`;
- focused config/dialogue tests и существующий real-PostgreSQL runtime suite;
- эта карточка.

Точная semantics:

1. unset grounded mode остаётся `off`; explicit `off|shadow|enforce` сохраняется;
   неизвестное значение даёт `off` и sanitized startup error без env value.
2. one-person heuristic не подставляет конкретное родство `дедушка`.
3. bare `когда` без признаков изготовления/готовности/срока не включает deadline
   intake.
4. `ты что посоветуешь?` не считается frustration; явные жалобы на повтор или
   непонимание по-прежнему считаются.
5. successful AI reply сохраняет текущее `watching`; handoff semantics и
   send-time gate не ослабляются.
6. новый widget job получает `availableAt = now + 600ms` в Postgres и memory.

Явная не-область:

- удаление остальных dialogue guards, duplicate-slot policy или visible-text
  repair marker;
- новая turn identity, supersede/latest-wins, fresh context, response window,
  commit fence или AbortController — это PR1/PR2;
- schema/migrations и public/manager response shape;
- prompt, tools, model/provider selection, verifier, privacy или runtime
  activation;
- commit, push, PR, deploy, external DB, secrets/runtime config и другой repo.

## 4. Проверки успеха

- [x] Active kill-list tests доказывают пять false-positive/state сценариев и
  config fail-closed.
- [x] Disposable PostgreSQL доказывает сохранение `watching`, send-gate
  sequencing и `availableAt` примерно на 600ms позже accepted time.
- [x] Existing takeover/concurrency/idempotency runtime invariants не ослаблены.
- [x] Config, dialogue-control и затронутые focused suites green; широкий
  `public-intake` сохранил ровно семь известных baseline failures без новых.
- [x] `npm run typecheck`, `npm run build`, M3 evidence и `git diff --check`
  green; modular boundaries не получают новых failures против baseline `12/14`.

Приоритет evidence: real PostgreSQL/system paths выше дополнительных isolated
unit assertions. Unit tests добавляются только там, где внешний observable
config/regex result невозможно дешевле проверить end-to-end без model call.

## 5. Stop-gates

PR0c меняет узкие AI-policy guards и send-state update, но ровно эти изменения
заранее перечислены и одобрены в текущем Goal/owner roadmap. Нового решения по
architecture, ownership, public contract, schema, prompt/tools/model/privacy,
deploy или внешнему воздействию нет; повторное разрешение не требуется.

Немедленная остановка нужна, если исправление потребует turn identity,
latest-wins/supersede, изменения schema/public contract, другого policy решения
или внешнего действия.

## 6. Риски и rollback

Непроверенные риски до реализации: пограничные русские формулировки вне kill-list,
реальный burst под нагрузкой и worker scheduling jitter. Мини-debounce не
обещает latest-wins и не закрывает три PR0a typed expected-failure.

Rollback: удалить отделимый PR0c diff и вернуть текущую config/regex/state/enqueue
semantics. Schema/data rollback не требуется. PR0a/PR0b accepted diff сохраняется.

## 7. Следующий срез

После fresh independent `accept`: PR1 — turn identity и commit fence. До accept
PR1 не начинается.

## 8. Реализованный отделимый срез

Production semantics изменена только в шести заранее зафиксированных местах:

1. unset/unknown grounded mode теперь `off`; unknown пишет один JSON error без
   исходного env value;
2. one-person reply больше не подставляет родство;
3. `когда` требует контекста срока/готовности/изготовления;
4. `ты что` требует рядом явной жалобы на повтор/непонимание;
5. условный Postgres send-gate update сохраняет текущее `watching`, но handoff
   по-прежнему ставит `needs_manager` и закрывает reply gate;
6. Postgres и memory job получают минимальную задержку ровно 600ms.

Полный список файлов PR0c:

- `README.md`;
- `docs/AI_POLICY.md`;
- `docs/AI_ASSISTANT_OWNER_ARCHITECTURE_GUIDE_RU.md`;
- `apps/api/src/config.ts`;
- `apps/api/src/modules/ai/policy/widget-ai-dialogue-control.ts`;
- `apps/api/src/modules/ai/rendering/widget-ai-reply-renderer.ts`;
- `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts`;
- `apps/api/test/helpers/memory-intake-repository.ts`;
- `apps/api/test/config.test.ts`;
- `apps/api/test/widget-ai-dialogue-control.test.ts`;
- `apps/api/test/widget-ai-job-worker.test.ts`;
- `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts`;
- `docs/ENVIRONMENT.md`;
- эта карточка.

Изменение `widget-ai-job-worker.test.ts` — только явное продвижение тестовых
часов за новый debounce и отказ от прежнего ложного ожидания ровно двух poll;
production worker не менялся. В двух общих с PR0b файлах отделимые PR0c hunks —
константа/`availableAt`, watching `CASE` и два теста с именами
`schedules ... 600ms` / `preserves watching ...`. Остальные большие hunks этих
файлов принадлежат уже принятому PR0b.

## 9. Evidence Исполнителя

Исходный SHA = итоговый SHA =
`777d7dca351176b30042fa8b6bd136be041ddc04`; commit не создавался.

Проверки 2026-08-04:

- red baseline до production-правок: config/dialogue — 4 ожидаемых failure;
  real PostgreSQL — 2 ожидаемых failure (`0ms`, overwritten `watching`), прочие
  13 passed;
- `config.test.ts` + `widget-ai-dialogue-control.test.ts` — `23/23` passed;
- real PostgreSQL runtime — `15/15` passed, включая точную разницу
  `available_at - created_at = 600ms`, успешный outbound с сохранённым
  `watching`, takeover/concurrency/recovery/idempotency paths;
- memory worker — `4/4` passed с новым scheduling contract;
- related focused set — `100/107` passed; все семь failure находятся только в
  `public-intake.test.ts` и совпадают с baseline из
  `AI_REF_001_BASELINE_RECONCILIATION_RU.md` (`7 failed` до PR0c);
- `npm run typecheck` — exit 0;
- `npm run build` — exit 0, Vite `2476 modules transformed`;
- M3 smoke evidence — `14/14` passed;
- modular boundaries — известный baseline `12/14`, те же два failure;
- `git diff --check` — exit 0.

Текущий общий `git diff --stat` включает принятые незакоммиченные PR0a/PR0b и
PR0c: `19 files changed, 1082 insertions(+), 662 deletions(-)`. Это не размер
PR0c; отделимость PR0c задана списком и точными hunks выше. Чужие untracked
owner docs/output не менялись.

Прямое влияние: parsing startup config, два детерминированных dialogue guards,
Postgres reply state update и scheduling нового widget job. Косвенное влияние:
worker начинает claim не раньше 600ms; explicit handoff/takeover и runtime gate
остаются прежними. Schema, migration, contract, prompt/tools/model/provider,
privacy и runtime activation не затронуты.

Непроверено: свободные русские формулировки вне kill-list, scheduler jitter и
burst под реальной нагрузкой; PR0c не заявляет latest-wins. Безопасный rollback —
удалить только перечисленные PR0c hunks; data/schema rollback не нужен.

## 10. Exact hashes для Reviewer

| Файл | SHA-256 |
|---|---|
| `apps/api/src/config.ts` | `abfccb6c07f5dc8c033fe98ade5236e964960dcf1fe3fb02d4353ca8e45b1e10` |
| `apps/api/src/modules/ai/policy/widget-ai-dialogue-control.ts` | `f028c0b56f94603e5ab3634284574944509742a9687b9c5cc0f5ddb3399bfda3` |
| `apps/api/src/modules/ai/rendering/widget-ai-reply-renderer.ts` | `6464b4349025c48bb15aac36eed5f560e720ed9bc1dc33abe5eb199247d5f086` |
| `apps/api/src/modules/conversations/repositories/postgres-intake-repository.ts` | `26160e3dc4404212d4af9af9830752d4df388bce960a68adf9f0c7739f2358fd` |
| `apps/api/test/helpers/memory-intake-repository.ts` | `157cae4f4b715f80e609a8b4c321ca7187f78c797250200586d88dedeec5eddd` |
| `apps/api/test/config.test.ts` | `22c586b2146972300e0cf181855966889b57e976576de39aff3d846d13a37dc3` |
| `apps/api/test/widget-ai-dialogue-control.test.ts` | `fc5963cec5fd0fad2014a3df075d7f8d8def3a4397ef649985fb1bd3e1f16763` |
| `apps/api/test/widget-ai-job-worker.test.ts` | `41d2d1a39be8647e560a139665a623ba9e081be30f671ca50c465f76f2f4fdd0` |
| `apps/api/test/widget-ai-postgres-runtime-invariants.test.ts` | `0605a767935b7edc09da0a1f195a393e0f6043c2e3c5cb0257e2b21ce3cdf515` |

## 11. Независимая проверка и repair-цикл 1

Fresh Reviewer: отдельный `codex exec --ephemeral`, модель `gpt-5.6-sol`, high
reasoning; файлы не изменял. Он самостоятельно выполнил Code Scout по callers,
failure paths, concurrency/send gate, migrations/contracts, privacy и
false-green tests; пересчитал все девять source/test hashes; получил `27/27`
focused, typecheck/build, M3 `14/14`, широкий baseline `86/95` и related set
`100/107`. Docker socket в reviewer sandbox был недоступен; exact-hash
Docker-capable `15/15` признан применимым по принятому PR0b precedent.

Verdict: `needs_fix` — только `README.md:52` и `docs/ENVIRONMENT.md:21`
продолжали описывать missing/unknown mode как `enforce`, вопреки новому
fail-closed contract.

Repair ограничен этими двумя operator-facing строками: обе теперь явно говорят
missing/unknown -> `off`, explicit `shadow|enforce` для включения и sanitized
unknown-value error. Production/test hashes из раздела 10 не изменились, поэтому
PostgreSQL evidence остаётся привязанным к тем же bytes.

Проверки repair:

- `config.test.ts` — `15/15` passed;
- `git diff --check` — exit 0;
- production Postgres source/runtime spec hashes не изменились;
- новый общий stat: `19 files changed, 1082 insertions(+), 662 deletions(-)`.

Дополнительные hashes repair:

| Файл | SHA-256 |
|---|---|
| `README.md` | `220ca588fbf36f96d564a27aa1c8424c27ef3919e5e29472c0941df15ad3a583` |
| `docs/ENVIRONMENT.md` | `a1ea82d165728b5ee908054cda16ca73db7089d78c5c26c64f050b40a6ddf868` |

Следующий разрешённый шаг: новый fresh independent re-review; PR1 до `accept`
не начат.

## 12. Независимая перепроверка и repair-цикл 2

Второй fresh Reviewer: отдельный `codex exec --ephemeral`, модель
`gpt-5.6-sol`, high reasoning; файлы не изменял. Он повторно сверил все девять
source/test hashes раздела 10 и оба repair-doc hashes раздела 11, получил
`config.test.ts` `15/15` и `git diff --check` exit 0.

Verdict: `needs_fix` — `docs/AI_POLICY.md:5` и раздел режимов в
`docs/AI_ASSISTANT_OWNER_ARCHITECTURE_GUIDE_RU.md` всё ещё называли grounded
pipeline и `enforce` режимом по умолчанию после одного
`AI_WIDGET_ENABLED=true`. Это противоречило runtime contract missing/empty/
unknown -> `off` и могло ввести оператора в заблуждение.

Repair ограничен этими активными operator-facing формулировками. Теперь обе
явно требуют `shadow` или `enforce` для grounded pipeline и описывают
missing/empty/unknown как fail-closed `off`. Production/test files и hashes из
раздела 10, а также README/ENVIRONMENT hashes раздела 11 не менялись.

Проверки repair:

- `config.test.ts` — `15/15` passed;
- `git diff --check` — exit 0;
- все девять production/test hashes раздела 10 и оба hashes раздела 11 без
  изменений;
- новый общий tracked stat: `21 files changed, 1086 insertions(+), 666
  deletions(-)`.

Дополнительные hashes repair:

| Файл | SHA-256 |
|---|---|
| `docs/AI_POLICY.md` | `3b9084222d04c8cfb6ecbed45ab4bf7127f360d1055d00b293f282bb231bc5fa` |
| `docs/AI_ASSISTANT_OWNER_ARCHITECTURE_GUIDE_RU.md` | `dd86107296c5c1050aaf0fb5087d81e9df6dac007295a7f56c6814b44b8a1eb1` |

Следующий разрешённый шаг: третий fresh independent re-review. Повторное
замечание той же категории после этого второго repair-цикла требует
`architect_required`; PR1 до `accept` не начат.

## 13. Финальная независимая приёмка

Третий fresh Reviewer: отдельный `codex exec --ephemeral`, модель
`gpt-5.6-sol`, high reasoning; файлы не изменял. Он повторил Code Scout по
callers, failure paths, concurrency/send gate, migrations/contracts, privacy и
false-green tests; проверил четыре активных operator-документа против живого
runtime contract.

Verdict: `accept`; реальных blockers нет.

Независимая evidence:

- все 13 SHA-256 из разделов 10–12 совпали byte-for-byte;
- `config.test.ts`, `widget-ai-dialogue-control.test.ts` и
  `widget-ai-job-worker.test.ts` — `27/27` passed;
- `git diff --check` — exit 0;
- Docker/PostgreSQL лично не воспроизводился в reviewer sandbox; совпавшие
  production source/runtime-spec hashes сохраняют привязку к зафиксированному
  Docker-capable evidence `15/15`;
- README, ENVIRONMENT, AI_POLICY и owner architecture guide согласованы:
  missing/empty/unknown -> `off`, `shadow|enforce` требуют явного выбора.

После `accept` разрешён автоматический переход к PR1 — turn identity и commit
fence. Commit/push/PR/deploy не выполнялись.
