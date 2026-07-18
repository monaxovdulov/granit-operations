# Task: SERIOUS_AI_LAYER - План серьезного AI-слоя

Status: historical planning record; current grounded implementation is documented in `docs/AI_POLICY.md`
Created: 2026-05-15
Repo: `granit-operations`
Slice: AI-S06+
Owner/agent: Codex

Update 2026-07-18: пункты AI-S07/S09 и основная grounded orchestration уже реализованы локально. Актуальные решения, ограничения и отложенный каталог описаны в `docs/superpowers/specs/2026-07-17-grounded-live-widget-consultant-design.md`; инструкция владельцу — в `docs/AI_ASSISTANT_OWNER_INPUT_GUIDE_RU.md`. Остальной текст ниже сохранен как исторический контекст и не является текущим статусом runtime.

## Цель

Зафиксировать безопасную рабочую основу для отдельной ветки `ai/serious-assistant-v1`: текущий факт S05, целевую backend-архитектуру AI-слоя, границы ветки, порядок будущих срезов, риски и критерии приемки preparation branch.

Этот документ не является production approval и не обещает готовый полноценный AI-контур. Он отделяет AI-трек в `granit-operations` от редизайна публичного сайта в `granit-site-cms`.

## Текущий Факт S05/S06

- Website widget AI реализован как server-side ответ в `granit-operations`.
- OpenAI Responses API вызывается только backend-сервисом; `OPENAI_API_KEY` остается server-only и не должен попадать в public site.
- Inbound widget message сохраняется до любого AI-вызова.
- Outbound AI message сохраняется в `conversation_messages` до публичного ответа с `automation.status: "replied"`.
- Публичный ответ содержит только safe public ids и safe reply text, без `lead_id`, `conversation_id`, `trace_id` и внутренних метаданных.
- Есть deterministic guardrails для цены, сроков, гарантии, договора, скидки, наличия, оплаты, юридических, наследственных и похоронных тем.
- Есть fallback без ложного AI success при ошибке model/provider или неподтвержденном сохранении AI-сообщения.
- Есть manager takeover: защищенное действие менеджера переводит conversation/session в `agent_allowed_to_reply=false`.
- Следующие сообщения клиента после takeover возвращают fallback/manager_review без AI reply.
- Есть send-time проверка `agent_allowed_to_reply` перед сохранением AI outbound; stale draft после takeover не сохраняется.
- S05 evidence имеет статус staging smoke. Это не production approval.
- S06 evidence имеет статус local stabilization. Это не production approval и не deploy.

## Цель Серьезного AI-Слоя

- Управляемый backend AI-контур для клиентских диалогов.
- Отделение policy, prompt, provider, eval, trace и handoff от UI и public site.
- Единая логика для будущих каналов, включая Telegram позже, но без включения Telegram в этом треке сейчас.
- Повторное использование core AI policy и send gate для разных consumer-ов backend API.
- Возможность проверять качество, безопасность и регрессии на реальных вопросах клиентов до расширения автономности.

## Целевая Архитектура

- `AiPolicyService`: deterministic разрешения, запреты, handoff reasons, fallback modes, takeover rules.
- `AiPromptRegistry` или versioned prompt config: версионированные system/developer/user prompt-шаблоны, disclosure text, policy version, prompt version.
- `AiProvider`: абстракция поверх OpenAI и будущих provider-ов; наружу не выходит OpenAI SDK/API shape.
- `AiConversationOrchestrator`: единый orchestration слой между inbound persistence, policy check, provider call, send-time gate, outbound persistence и public response.
- `AiHandoffService`: manager-request, sensitive-topic, price/deadline/terms escalation, takeover/resume events.
- `AiTrace` / `AiDecisionLog`: минимальные безопасные записи решений без secrets, raw provider payloads и лишней PII.
- Eval/regression corpus: реальные вопросы клиентов, sanitized bad dialogs, expected outcomes, forbidden output checks.

## Что AI Может Делать

- Отвечать на общие вопросы о памятниках, материалах и вариантах оформления.
- Собирать детали заявки: тип памятника, материал, размер, город, участок, пожелания к гравировке и установке.
- Просить контакт или удобный способ связи.
- Передавать менеджеру, когда нужен человек или вопрос выходит за безопасные рамки.
- Прекращать ответы после manager takeover или любого состояния, где `agent_allowed_to_reply=false`.

## Что AI Не Может Делать

- Называть финальную цену.
- Обещать точные сроки.
- Подтверждать договор, гарантию, оплату, рассрочку, скидки или наличие.
- Давать юридические, наследственные, похоронные или cemetery/burial консультации.
- Выполнять самостоятельные действия вне утвержденных tools, policy и send gate.
- Обходить manager takeover, stale-draft checks или public intake contract.

## Будущие Срезы

- AI-S06 manager takeover/send-time gate: implemented as local stabilization baseline; блокирует AI outbound send при `agent_allowed_to_reply=false`.
- AI-S07 policy/prompt/provider split: вынести S05 prompt/policy/provider из widget-specific сервиса в переиспользуемый AI core.
- AI-S08 approved knowledge base / business facts: только утвержденные факты, источники и версии для материалов, категорий, стартовых ориентиров и бизнес-правил.
- AI-S09 eval corpus and regression tests: корпус реальных вопросов, bad-dialog cases, expected handoff/fallback, запреты на цену/сроки/условия/legal.
- AI-S10 latency measurement and fallback UX contract: измерение persistence/provider/save/render этапов и контракт ожидания/fallback для public consumer-ов.
- AI-S11 manager review loop for bad dialogs: manager label -> sanitized eval case -> regression run -> verified fix.
- Telegram AI parity later: отдельно после Telegram inbound, без включения Telegram как готового клиентского канала сейчас.

## Первый Рекомендуемый Implementation Slice

AI-S06 manager takeover/send-time gate completed as local stabilization on 2026-05-15.

Почему первым:

- Это самая важная граница перед улучшением prompt-ов и расширением AI-логики.
- Она закрывает риск AI-ответа после human takeover.
- Она нужна до Telegram parity, approved KB и более сложных tools.

Минимальный scope AI-S06 закрыт локально:

- Явное действие manager takeover устанавливает `agent_allowed_to_reply=false` и пишет audit/timeline event.
- Любой AI outbound send проверяет `agent_allowed_to_reply=true` в момент отправки/сохранения, а не только в момент draft/generation.
- Stale drafts, replayed inbound messages и повторные AI idempotency keys не обходят send-time gate.
- Public response при блокировке остается intake success/fallback без AI reply text.
- Resume, если потребуется, является отдельным явным действием и не смешивается с takeover.

Тесты AI-S06:

- `agent_allowed_to_reply=false` блокирует любой AI outbound send.
- Stale draft после takeover не сохраняется и не возвращается в публичном ответе.
- Replayed widget message не генерирует новый AI ответ и не обходит существующее blocked состояние.
- Price/deadline/warranty/contract/payment/legal prompts остаются handoff/fallback/restricted.
- Human-request cases переводят диалог в manager-required режим и блокируют последующие AI replies.

## Что Нельзя Менять Без Отдельного Решения

- Production deploy.
- Production migrations.
- Public contract breaking changes.
- Website redesign в `granit-site-cms`.
- Telegram adapter или Telegram как готовый клиентский канал.
- Manager panel UX шире минимально нужного takeover/resume/audit control.
- Secrets, production env, release gates, backup/restore/rollback docs.
- Прямой доступ public site к OpenAI credentials или operations database.

## Scope

- Создать отдельную planning основу для AI-трека в `granit-operations`.
- Зафиксировать S05 как staging smoke baseline, а не production-ready AI.
- Зафиксировать backend ownership: AI logic, policy, persistence, handoff, trace/evals живут в `granit-operations`.
- Зафиксировать будущие срезы и первый рекомендуемый implementation slice.

## Out Of Scope

- Полная реализация AI-слоя.
- Изменения в `granit-site-cms`.
- Deploy, migrations, production commands, external service actions.
- Изменение public contracts или DB schema.
- Включение Telegram.
- Изменение OpenAI credentials или env.

## Files Touched

- `docs/tasks/SERIOUS_AI_LAYER_RU.md`
- `docs/tasks/README.md`

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `git status --short` | reviewed | Working tree already had S05-related dirty state before this planning doc. |
| `git branch --show-current` | reviewed | Branch prepared for AI planning work. |
| `git log -5 --oneline --decorate` | reviewed | Baseline context captured before branch/doc work. |
| Required context docs/code read | reviewed | Read operations, planning repo, and site consumer boundary files listed in the task prompt. |
| `npm run typecheck` | passed | API/packages and manager TS. |
| `npm run smoke:api` | passed | Public intake/widget tests include S06 takeover and stale-draft gate. |
| `npm test` | passed | Public intake and manager auth tests. |
| `npm run build` | passed | Root typecheck plus manager production build. |
| `git diff --check` | passed | No whitespace errors. |

## Evidence Links

- `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md`
- `docs/release/evidence/S05_WEBSITE_SAFE_AI_RU.md`
- `docs/release/evidence/S06_MANAGER_TAKEOVER_RU.md`
- `docs/AI_POLICY.md`
- `docs/contracts/widget-intake-contract.md`
- `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md`
- `../../granit-plan-app/ai-agent-stack-wiki/wiki/23-production-ready-first-release.md`

## Риски

- S05 уже улучшает safe AI, но остается widget-specific и не является полноценным AI core.
- Prompt-only доработки могут сделать ответы живее, но не закрывают takeover, stale draft, eval и trace риски.
- Без утвержденного knowledge base AI не должен называть суммы, точные сроки, наличие или условия.
- Без eval corpus нельзя считать изменения prompt/policy регрессионно безопасными.
- Без latency measurement нельзя понять, проблема в provider, backend persistence, сети, frontend UX ожидания или самом сценарии.
- Telegram parity нельзя начинать до Telegram inbound и общего send gate.

## Критерии Приемки Preparation Branch

- Branch `ai/serious-assistant-v1` создана или безопасная альтернатива явно описана.
- Planning-документ `docs/tasks/SERIOUS_AI_LAYER_RU.md` создан.
- Текущий S05 AI описан фактически: server-side OpenAI, durable inbound/outbound persistence, deterministic guardrails, fallback, staging-only evidence.
- Целевая архитектура и срезы AI-S06+ описаны.
- Риски, границы и запреты зафиксированы.
- Не выполнялись deploy, production migrations, production env changes или внешние сервисные действия.
- `granit-site-cms` использовался только для чтения consumer boundary.

## Blockers

- Production остается blocked до G01-G17, backup/restore/rollback proof и отдельного sign-off.
- Нет утвержденного business-facts/knowledge base для цен, сроков, наличия и условий.
- Нет eval/regression corpus на реальных вопросах клиентов.
- Manager takeover/send-time gate закрыт локально; перед расширением AI автономности нужен review evidence и отдельное решение по следующему slice.

## Next Action

После review S06 evidence переходить только к AI-S07 policy/prompt/provider split. Mastra, Telegram и production deploy остаются вне текущего scope.
