# Evidence: AI-DIALOG-BOUNDARY-STAGE-A - Neutral AI turn boundary

Status: local_implementation_passed
Date: 2026-05-29
Repo: `granit-operations`
Slice: AI dialog risk reduction Stage A
Task link: `docs/tasks/AI_DIALOG_BOUNDARY_STAGE_A_RU.md`
Contract/version: `granit_ai_turn_input.stage_a.v1`

## Что Проверяли

- Website widget AI input is built after accepted inbound persistence and uses app-owned ids/state.
- AI core receives `AiTurnInput`, not `SiteWidgetMessageRequest`, Telegram update payloads or provider webhook DTOs.
- Stage A input carries version, turn fingerprint, gate snapshot, known slots, boundary config, approved-source state and audit-safe evidence.
- Invalid candidate decisions and price/business facts without app-approved source fail closed to existing public fallback.
- Telegram AI outbound remains blocked.
- Public widget response contract remains compatible; internal boundary fields do not leak to public response.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm test -- apps/api/test/public-intake.test.ts apps/api/test/modular-boundaries.test.ts` | passed, 56 tests | Focused widget baseline, boundary, fail-closed and module boundary coverage. |
| `npm run typecheck` | passed | API/packages and manager TypeScript. |
| `npm test` | passed, 84 tests | Full local Vitest suite. |
| `git diff --check` | passed | No whitespace errors in `granit-operations`. |

## Доказательство Поведения

- API/provider result: focused widget tests still return existing `automation.status` values (`replied`, `fallback`, `disabled`) without new public statuses.
- DB persistence: AI reply persistence still runs only after app-owned send-time gate; AI input fingerprint is stored separately in metadata.
- Manager visibility: existing manager takeover/send-time gate tests remain in the focused public intake suite.
- Validation/failure path: invalid candidate, missing approved source, Stage A price orientation and candidate self-approved source all return fallback without persisting AI reply.
- Idempotency: replay with existing persisted AI reply returns the stored reply and does not call the generator again.
- Public response privacy: public widget response still excludes internal lead/conversation ids.
- Paired smoke with site-cms: not run; no public contract change was made.

## Что Не Записывать

Do not add secrets, OpenAI API keys, DB URLs, tokens, raw provider payloads, customer PII, private chat ids, full private logs or raw model reasoning.

## Rollback / Manual Fallback

- Rollback path: revert this Stage A contract/code change and keep `AI_WIDGET_ENABLED` off if AI behavior is uncertain.
- Manual fallback: widget already returns saved-message fallback and manager review when AI is disabled, unavailable, invalid or blocked.

## Blockers / Watch Items

- No production approval.
- No Mastra runtime or Studio approval.
- No Telegram AI outbound approval.
- No approved app-owned price source; price amounts/ranges/orientation remain blocked.
- Future eval/review linkage still needs app-owned state before Mastra/eval runner work.

## Sign-Off

- Owner: not requested in this local implementation task.
- Developer/release owner: Codex local checks passed.
- Date: 2026-05-29
