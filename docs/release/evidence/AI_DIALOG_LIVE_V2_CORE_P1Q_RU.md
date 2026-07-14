# Evidence: AI-DIALOG-LIVE-V2-CORE-P1Q

Status: core_local_checks_passed; G1Q pending owner facts approval; not deployed
Date: 2026-07-14
Repo: `granit-operations`
Slice: P1Q core before G1Q/P2
Task link: `docs/tasks/AI_DIALOG_LIVE_V2_CORE_P1Q_RU.md`
Facts review: `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md`
Implementation commit: `78c9947`
Profile: `live_v2`; `runtimeEnabled: false`; `provider: null`
Contracts: `granit_live_v2_candidate.v1`, `granit_live_v2_turn_view.v1`,
`granit_live_v2_prompt.v1`, `granit_live_v2_tone.v1`, `granit_live_v2_facts.v1`

## Что Проверяли

- model-safe turn содержит не больше 8 сообщений и 6000 символов, сохраняет порядок, включает
  принятый current inbound ровно один раз и не передаёт IDs, timestamps, URLs или contact values
  как metadata;
- controlled city slot нормализуется и отбрасывается при наличии цифр, email/URL или
  неподдерживаемых символов;
- generator получает только customer-safe facts projection: `id`, category, allowed wording и
  forbidden extrapolations; source paths/SHA, approval и review metadata остаются app-side;
- candidate принимает ровно один из action
  `answer | ask_clarifying_question | handoff_to_manager | no_reply`, точные вложенные ключи и
  согласованные reason/missing slots/signals/evidence;
- validator отклоняет неизвестные fact IDs, больше одного вопроса, уже известный slot, точный
  повтор сообщения и повтор последнего AI-вопроса внутри нового ответа;
- adversarial corpus блокирует естественные варианты неподтверждённых цен, сроков, наличия,
  скидок, оплаты, возвратов, гарантий, договоров, правовых правил, характеристик/размеров,
  собственного производства и покрытия; безопасные формулировки «уточнит менеджер» проходят;
- initial gate проверяется до context/generator, а fresh gate читается после успешной генерации и
  валидации перед persist plan; takeover во время генерации даёт `gate_closed` без отправки;
- invalid context/assets/candidate, generator failure и gate-reader failure дают явный
  fail-closed outcome без неуправляемого исключения или отправки;
- handoff закрывает AI gate после сохранения, обычный answer/question не меняет gate;
- фиксированный набор `LV2-SYN-001...018` проверяет только детерминированную обработку заранее
  заданных candidates.

## Команды И Проверки

Все Node-проверки выполнялись последовательно с
`NODE_OPTIONS=--max-old-space-size=512`; Vitest — с одним worker.

| Check | Result | Notes |
|---|---|---|
| focused P1Q suite | passed, 5 files / 108 tests | Assets, context, validator, orchestration/apply и ровно 18 synthetic cases. |
| frozen `legacy_s05` suite | passed, 3 files / 9 tests | Decision, orchestration и golden baseline не изменились. |
| `npx vitest run --maxWorkers=1 --minWorkers=1` | passed, 17 files / 207 tests | Полный локальный suite. |
| `npm run typecheck` | passed | API/packages и manager types. |
| `npm run build` | passed | Повторный typecheck и manager Vite build. |
| `git diff --check` | passed | До code commit и после review-fixes. |
| independent adversarial review | passed after fixes | Закрыты обходы hard-safety и PII в city; повторный review новых blockers не нашёл. |

## No-Live-Call Proof

- `LIVE_V2_PROFILE.runtimeEnabled === false`, provider равен `null`.
- `ast-index refs executeLiveV2Turn` показывает только focused P1Q tests; active runtime по-прежнему
  использует frozen `executeLegacyS05Turn`.
- Commit `78c9947` не меняет runtime wiring, package/lockfile, environment/config, direct adapter,
  OpenAI request или Mastra dependency.
- Все candidates возвращали fake generators; ни OpenAI, ни Mastra, ни другой model endpoint не
  вызывался.

## Facts Gate

`TEST_LIVE_V2_FACTS` имеет `ownerApproved: true` и
`ownerReviewId: test-only-p1q-fixture` исключительно для проверки схемы, approval-window,
projection и validator. Это **не** решение владельца, не production `facts.v1.ts` и не runtime
snapshot.

Все 15 строк owner review table остаются `no — pending`, поэтому G1Q не пройден и P2 пока не
разблокирован.

## Evidence Limits

- Structural `signals` не доказывают, что модель правильно поняла negation, explicit manager
  request или mixed intent.
- Объявленный fact ID и hard-safety checks не доказывают полное semantic entailment свободного
  текста.
- Synthetic candidates не доказывают naturalness или качество реальной модели. Это проверяется
  authenticated fixed corpus только в M3 после G6.
- P1Q не развернут и не является staging/production approval.

## Rollback

Revert `78c9947`. Migration, package, environment, deploy и active direct-runtime rollback не
требуются.

## Sign-Off

- Developer P1Q core: passed locally.
- Owner facts approval: pending.
- G1Q/P2: pending.
- Staging/production: not approved.
