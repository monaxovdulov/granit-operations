# Evidence: S04-WIDGET-PERSISTENCE - Widget Persistence

Status: staging_smoke_passed
Date: 2026-05-13
Repo: `granit-operations`
Slice: S04
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Contract/version: `site_widget.v1`

## Что Проверяли

- Public widget endpoint accepts a valid widget message.
- Public success is returned only after repository persistence.
- Public response does not include internal lead/conversation/trace ids.
- Manager API exposes the widget lead and dialog.
- Backend failure returns retry/fallback, not success.
- Idempotent retry replays the same public message receipt.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | Passed | API/packages and manager TS. |
| `npm run smoke:api` | Passed | 10 tests in `apps/api/test/public-intake.test.ts`. |
| `npm test` | Passed | 17 tests across public intake and manager auth. |
| `npm run build` | Passed | Root typecheck plus manager production build. |
| Temporary Postgres smoke | Passed | Applied migrations `0001..0004`, sent widget message, manager detail showed `site_widget`, 1 dialog, 1 message. |
| Staging DB migration | Passed | Applied `0004_s04_widget_persistence.sql` to staging Postgres on 2026-05-13T15:03Z. |
| Staging deploy | Passed | Rebuilt/restarted `ops-api` through the site deploy kit; Caddy was restarted after route config sync. |
| Live paired staging smoke | Passed | Public widget POST returned `202`; DB showed 1 widget session, 1 conversation, 1 message, 2 timeline events; manager API detail showed the widget dialog. |

## Доказательство Поведения

- API/provider result: `POST /public/intake/site-widget/messages` returns `202` with `schema_version: "site_widget.v1"`, `public_session_id`, `public_message_id`, and `automation.status: "disabled"`.
- DB persistence: repository contract writes session, lead, conversation, message, and timeline event before public success; migration `0004_s04_widget_persistence.sql` adds the required tables; temporary Postgres smoke verified this path.
- Manager visibility: manager lead detail includes `conversations[].messages[]` for widget messages; temporary Postgres smoke saw 1 dialog and 1 message for a widget lead.
- Validation/failure path: simulated persistence failure returns `503 retryable_backend_failure`.
- Idempotency: repeated same widget payload returns `status: "replayed"` with the same safe public ids.
- Public response privacy: tests assert no `lead_id`, `conversation_id`, or `trace_id`.
- Paired smoke with site-cms: live staging `POST https://botops.ru/public/intake/site-widget/messages` returned `202` with safe public ids and `automation.status: "disabled"`; DB and manager API visibility were verified with fake staging smoke data.

## Что Не Записывать

Не добавляйте secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.

## Rollback / Manual Fallback

- Rollback path: remove the site widget launch path or point it away from `/public/intake/site-widget/messages`; keep public phone/Telegram/Max contacts visible.
- Manual fallback: visitor can use phone, Telegram, Max, or existing forms.

## Blockers / Watch Items

- Owner browser check on staging is pending.
- AI remains intentionally disabled until S05.

## Sign-Off

- Owner: pending
- Developer/release owner: accepted for staging API/DB/manager smoke
- Date: 2026-05-13
