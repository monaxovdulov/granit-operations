# Evidence: S05-WEBSITE-SAFE-AI - Operations Backend

Status: staging_smoke_passed
Date: 2026-05-13
Updated: 2026-05-15 local stabilization
Repo: `granit-operations`
Slice: S05
Contract/version: `site_widget.v1` with additive AI automation states

## Что Реализовано

- Inbound widget message is persisted before AI generation.
- `AI_WIDGET_ENABLED=false` keeps S04 behavior with `automation.status: "disabled"`.
- When enabled with OpenAI config, operations backend calls OpenAI Responses API server-side only.
- Outbound AI reply is persisted as `conversation_messages.direction=outbound`, `sender_role=ai_assistant` before public response includes the reply.
- Public response includes only safe public ids: inbound `public_message_id` and AI `automation.reply.public_message_id`.
- Manager lead detail shows visitor and AI message bubbles.
- Manager conversation history shows the full dialog by default and can be collapsed/expanded when the thread is long.
- AI fallback returns no false AI success when config is missing, provider/model fails, model output is empty, model output is unsafe, or AI persistence is unconfirmed.
- Safety guardrails block final price, exact deadline, warranty, contract, discount, availability, payment, and legal/funeral/inheritance advice.

## OpenAI Docs Used

- Official latest model guide: `https://developers.openai.com/api/docs/guides/latest-model.md`
- Text generation / Responses API guide: `https://developers.openai.com/api/docs/guides/text`
- Structured outputs guide reviewed; S05 uses plain text plus deterministic guardrails because no tool schema is needed yet: `https://developers.openai.com/api/docs/guides/structured-outputs`

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | API/packages and manager TS. |
| `npm run smoke:api` | Passed | 18 tests in `apps/api/test/public-intake.test.ts`, including S05 persistence/fallback and S06 takeover/stale-draft checks. |
| `npm test` | Passed | 25 tests across public intake and manager auth. |
| `npm run build` | Passed | Root typecheck plus manager production build. |
| `git diff --check` | Passed | No whitespace errors. |
| Staging DB migration | Passed | Applied `0005_s05_website_safe_ai.sql` to staging Postgres on 2026-05-13. |
| Staging deploy | Passed | Deployed site release `20260513T160740Z`; rebuilt/recreated `ops-api`; restarted Caddy. |
| Staging AI enable | Passed | `AI_WIDGET_ENABLED=true` set only in server-local `/srv/botops/.env.runtime`; `OPENAI_API_KEY` presence verified without printing value. |
| Live paired staging smoke | Passed | Public widget POST returned `202` with `automation.status: "replied"`; DB and manager API showed inbound visitor + outbound `ai_assistant` messages. |
| Live safety smoke | Passed | Price/payment prompt returned a persisted AI reply with no price amount and manager-confirmation wording. |
| Follow-up staging fix | Passed | Deployed release `20260513T162320Z`; manager list auto-refresh added; explicit manager request now blocks later AI replies for that widget session. |
| Manager history staging fix | Passed | Deployed release `20260513T162906Z`; manager lead detail now contains full-history collapse/expand UI. |

## Staging Evidence Summary

- Public response included only public ids and no `lead_id`, `conversation_id`, or `trace_id`.
- DB `conversation_messages` contains the visitor message as `direction=inbound`, `sender_role=visitor`.
- DB `conversation_messages` contains the AI answer as `direction=outbound`, `sender_role=ai_assistant`, with OpenAI model metadata and disclosure metadata.
- Manager API lead detail returned the widget conversation with both visitor and AI messages.
- Deployed public JS contains the approved AI disclosure.
- Follow-up handoff smoke: first message `я хочу менеджера` produced a short AI handoff reply; next phone message in the same public session returned `automation.status: "fallback"`, `reason: "agent_reply_blocked"` and no AI reply.
- Latest manager bundle contains `Свернуть историю` / `Показать всю историю` controls and a message-count badge for long dialogs.

## Осталось

- Production remains blocked and was not deployed.
- Telegram remains disabled and was not changed.

## Что Не Записывать

Не добавляйте secrets, OpenAI API keys, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.
