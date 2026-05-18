# Evidence: S06-MANAGER-TAKEOVER - Operations Backend

Status: local_stabilization_passed
Date: 2026-05-15
Repo: `granit-operations`
Slice: S06

## Что Реализовано

- Protected manager endpoint can take over a website widget conversation by safe `public_session_id`.
- Manager takeover sets `agent_allowed_to_reply=false` for that conversation/session and writes a timeline event.
- Later visitor messages in the same public session return `automation.status: "fallback"`, `next_step: "manager_review"`, and `reason: "agent_reply_blocked"` without AI reply text.
- Outbound AI persistence performs a send-time gate against `agent_allowed_to_reply=true`; stale AI drafts after takeover are blocked before `conversation_messages` insert.
- Manager UI shows whether AI is enabled or disabled for each widget conversation and exposes the takeover action to non-viewer manager roles.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | API/packages and manager TS. |
| `npm run smoke:api` | Passed | 18 tests; includes manager takeover, blocked follow-up AI, and stale AI draft persistence gate. |
| `npm test` | Passed | 25 tests across public intake and manager auth. |
| `npm run build` | Passed | Root typecheck plus manager production build. |
| `git diff --check` | Passed | No whitespace errors. |

## Осталось

- Production was not deployed.
- Telegram was not changed.
- Mastra was not connected.

## Что Не Записывать

Не добавляйте secrets, OpenAI API keys, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.
