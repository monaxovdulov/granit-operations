# Task: AI-DIALOG-P1Q — provider-neutral live_v2 dialog core

Status: in_progress
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

## Предлагаемая структура

- `live-v2-contract.ts` — версии, строгие provider-neutral types и controlled enums.
- `live-v2-context.ts` — безопасная проекция `AiTurnInput`.
- `live-v2-assets.ts` — schema-validated prompt/tone descriptors и owner-reviewed facts snapshot.
- `live-v2-validator.ts` — strict candidate validation и hard-safety checks.
- `live-v2-apply.ts` — deterministic state/send plan.
- `live-v2-profile.ts` — provider port и orchestration composition без runtime wiring.
- `apps/api/test/live-v2-*.test.ts` — focused и synthetic fixture checks.

## Out Of Scope

- Любой реальный `live_v2` model call до M3.
- Mastra dependency/runtime до M1.
- Переключение активного widget runtime с `direct_openai`.
- Миграции observability и manager UI — P2/P3.
- Доказательство soft quality, semantic classification или production/staging readiness.
- Price/deadline/availability/discount/payment/contract/warranty/legal facts.

## Files Touched

- `docs/tasks/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`
- `docs/tasks/README.md`
- После design gate: новый subtree `apps/api/src/modules/ai/profiles/live-v2/`
- После design gate: focused tests `apps/api/test/live-v2-*.test.ts`
- После прохождения G1Q: `docs/release/evidence/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`

## Checks Run

Все Node-проверки запускаются последовательно, с `NODE_OPTIONS=--max-old-space-size=512`;
Vitest дополнительно с `--maxWorkers=1 --minWorkers=1`.

| Command/check | Result | Notes |
|---|---|---|
| AST impact search по `AiTurn*` и legacy profile | passed | Изменения изолируются от direct runtime |
| Focused P1Q tests | pending | После реализации |
| Frozen direct golden tests | pending | Обязательный regression gate |
| Full API/unit suite | pending | Только после focused green, один worker |
| Build/typecheck | pending | Последовательно, heap 512 МБ |

## Evidence Links

- `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
- `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md` — точный facts proposal; pending owner
  approval, не runtime snapshot.
- `docs/release/evidence/AI_DIALOG_APP_TURN_BOUNDARY_P1_RU.md`
- Планируемый evidence: `docs/release/evidence/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`

## Blockers

- Для runtime-approved facts snapshot нужна явная owner-проверка точной нормализованной таблицы
  с source path/line, content hash, allowed wording, forbidden extrapolation, source version,
  `valid from` и `review by`. До неё facts proposal не считается approved.

## Next Action

Извлечь минимальный facts proposal из закреплённого CMS source SHA, затем реализовать strict
contract/context/validator/apply и fixed synthetic fixtures без runtime wiring.
