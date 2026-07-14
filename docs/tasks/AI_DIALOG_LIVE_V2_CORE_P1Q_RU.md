# Task: AI-DIALOG-P1Q — provider-neutral live_v2 dialog core

Status: G1Q passed; repo-owned facts snapshot verified; runtime disabled; not deployed
Created: 2026-07-14
Repo: `granit-operations`
Slice: P1Q / G1Q
Owner/agent: owner + Codex

## Цель

Создать внутри app-owned AI boundary отдельное, строго типизированное ядро `live_v2`, которое
готовит ограниченный model-safe контекст, принимает только один из четырёх явных action,
fail-closed валидирует кандидат и детерминированно строит план применения. Ядро должно быть
достаточно содержательным для будущего естественного диалога, но на P1Q не вызывает модель,
не добавляет Mastra/OpenAI provider и не переключает активный direct runtime.

Исходная точка: принятый P1 evidence на `12742ae` и
`docs/release/evidence/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md`.

## Scope

- Новый изолированный профиль `apps/api/src/modules/ai/profiles/live-v2/` без transport,
  Fastify, DB, OpenAI и Mastra типов.
- Model-safe context из 6–8 релевантных текстовых сообщений в устойчивом порядке, с текущим
  inbound ровно один раз, отдельно вычисленным последним вопросом AI и только контролируемыми
  known slots.
- Строгий candidate contract ровно с одним action:
  `answer | ask_clarifying_question | handoff_to_manager | no_reply`.
- Fail-closed schema/semantic validation: точные ключи, action/reply/reason consistency,
  approved fact source IDs, запрещённые обещания, структурные negation/mixed-intent flags,
  handoff semantics, максимум один полезный вопрос.
- Детерминированный apply plan с отдельными blocked/takeover gates; упоминание менеджера, цены
  или срока в тексте само по себе не меняет состояние.
- Версионированные prompt/tone/facts descriptors. Facts становятся runtime-approved только после
  явного owner review точной таблицы; до этого неизвестные или неодобренные факты отклоняются.
- 15–20 фиксированных синтетических fixtures: продолжение без повтора, typo/paraphrase,
  отрицание и явный запрос менеджера, mixed intent, безопасный общий выбор, отсутствующий факт,
  опасное обещание и takeover.
- Golden regression frozen-профиля `legacy_s05` остаётся неизменной.

## Инварианты

1. P1Q не делает сетевых/model вызовов и не добавляет provider package.
2. P1Q не изменяет:
   - `apps/api/src/modules/ai/prompts/widget-ai-prompt.ts`;
   - `apps/api/src/modules/ai/policy/widget-ai-policy.ts`;
   - direct adapter/service request shape и S05 version constants.
3. Candidate имеет точный allowlist полей; лишние/неизвестные ключи — rejection.
4. `handoff_to_manager` допустим только при явном структурном handoff signal и не выводится из
   regex по тексту ответа.
5. `no_reply` не содержит reply draft; ответные action содержат непустой ограниченный текст.
6. Любая цена, срок, наличие, скидка, оплата, договор, гарантия, юридическое обещание или
   неизвестный source ID приводит к fail-closed outcome.
7. P1Q доказывает только обработку заранее заданных кандидатов. Понимание моделью отрицания,
   mixed intent и естественность ответа проверяются только authenticated fixed corpus в M3.

## Реализованная структура

Локальное provider-neutral ядро зафиксировано коммитом `78c9947`; accepted production facts
snapshot — коммитом `1d737e0`. Профиль не подключён к runtime и не развёрнут.

- `apps/api/src/modules/ai/profiles/live-v2/live-v2-contract.ts` — версии, строгие типы и
  controlled enums.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-context.ts` — ограниченная model-safe
  проекция `AiTurnInput`.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-assets.ts` — строгая проверка facts schema,
  test-only registry, approval-window и customer-safe model projection.
- `apps/api/src/modules/ai/profiles/live-v2/assets/prompt.v1.ts` и `tone.v1.ts` — версионированные
  prompt/tone assets.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-validator.ts` — строгая candidate validation,
  evidence allowlist и hard-safety checks.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-apply-plan.ts` — детерминированный план
  persistence/send/state transition.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-orchestrator.ts` — provider-neutral
  orchestration, fail-closed context/generator handling и свежая gate-проверка перед apply.
- `apps/api/src/modules/ai/profiles/live-v2/live-v2-profile.ts` — статически disabled профиль без
  runtime provider.
- `apps/api/src/modules/ai/profiles/live-v2/facts.v1.ts` — принятый владельцем 15-row snapshot,
  schema validation, exact source metadata и exclusive review boundary `2026-10-14`.
- `apps/api/test/fixtures/live-v2-synthetic.v1.ts` — test-only facts fixture и фиксированный
  synthetic corpus.
- `apps/api/test/live-v2-{context,assets,validator,apply-plan,synthetic-fixtures}.test.ts` — пять
  focused test-файлов.

## Out Of Scope

- Любой реальный `live_v2` model call до M3.
- Mastra dependency/runtime до M1.
- Переключение активного widget runtime с `direct_openai`.
- Миграции observability и manager UI — P2/P3.
- Доказательство soft quality, semantic classification или production/staging readiness.
- Price/deadline/availability/discount/payment/contract/warranty/legal facts.

## Files Touched

- `docs/tasks/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`
- `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md`
- `docs/tasks/README.md`
- Новый subtree `apps/api/src/modules/ai/profiles/live-v2/`, включая `assets/prompt.v1.ts`,
  `assets/tone.v1.ts` и owner-approved `facts.v1.ts`.
- `apps/api/test/fixtures/live-v2-synthetic.v1.ts`
- Пять focused test-файлов `apps/api/test/live-v2-*.test.ts`.
- Локальный evidence `docs/release/evidence/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`; он фиксирует
  прошедший core, но не является G1Q sign-off.

## Checks Run

Все Node-проверки были запущены последовательно, с
`NODE_OPTIONS=--max-old-space-size=512`; Vitest дополнительно с
`--maxWorkers=1 --minWorkers=1`, чтобы не перегружать сервер по памяти.

| Command/check | Result | Notes |
|---|---|---|
| Focused P1Q tests | passed: 5 files / 112 tests | Context, exact 15-row production asset, validator, apply/orchestration и ровно 18 synthetic cases |
| Frozen legacy/direct golden tests | passed: 3 files / 9 tests | Активный `legacy_s05` не переключён |
| Full API/unit suite | passed: 17 files / 211 tests | Один Vitest worker; повторено на exact snapshot commit `1d737e0` |
| Typecheck | passed | Heap limit 512 МБ |
| Build | passed | Последовательно после тестов, heap limit 512 МБ |
| Frozen direct diff/impact check | passed | Нет runtime wiring, provider dependency или изменения frozen direct файлов |

## Independent Review Follow-up

После независимой проверки в том же локальном slice закрыты следующие замечания:

- gate проверяется до построения контекста/генерации и повторно читается после валидного
  candidate непосредственно перед apply; takeover во время генерации и ошибка gate reader
  завершаются fail-closed без отправки;
- невалидный или слишком большой контекст даёт controlled `context_invalid`, не вызывает
  generator и не читает post-generation gate;
- facts registry отклоняет некалендарные даты, ещё не вступившие в силу и просроченные факты;
- hard-safety расширен на вариативные формулировки цены, срока, наличия, скидки, оплаты,
  договора, гарантии, юридических правил, неподтверждённых свойств и размеров;
- test naming больше не утверждает, что синтаксическая source metadata сама доказывает
  содержимое внешнего CMS source.

## Ограничения локального доказательства

- `managerRequest` и `mixedIntent` — структурные входные сигналы. P1Q проверяет их обработку,
  но не доказывает, что будущая модель правильно поняла отрицание или смешанный intent.
- `usedFactIds` доказывает только уникальные allowlisted ID. P1Q не доказывает семантическое
  соответствие свободного текста выбранному факту; это остаётся частью M3 fixed corpus и
  owner-reviewed wording.
- В known slots входят только app-owned controlled city и contact-presence flags без contact
  values. Domain slots не извлекаются моделью и не считаются подтверждёнными.
- Source commit/path/line/blob SHA валидируются как строгая metadata. Содержимое CMS проверяется
  отдельным owner review; runtime не читает CMS и не выполняет cross-repo verification.
- Естественность, semantic classification и качество реального model output этим slice не
  доказаны. Первый реальный `live_v2` вызов остаётся только M3 через Mastra и server-side
  `OPENAI_API_KEY`.

## Evidence Links

- `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
- `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md` — точная owner-accepted 15-row table.
- `docs/release/evidence/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md`
- Local core evidence, не G1Q sign-off:
  `docs/release/evidence/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`
- Authoritative G1Q closure evidence:
  `docs/release/evidence/AI_DIALOG_LIVE_V2_FACTS_G1Q_RU.md`

## Remaining Boundaries

- `core_local_checks_passed` не означает deploy, staging readiness или runtime enablement.
- G1Q пройден, но real model/Mastra call, staging и production по-прежнему запрещены.

## Next Action

G1Q пройден на implementation commit `1d737e0`; перейти к P2 app-owned run/span/quality
persistence без Mastra dependency, runtime switch или live model call.
