# Evidence: P0-CHANNEL-NEUTRAL-CONVERSATION - Канально-нейтральная основа диалогов

Status: needs_review
Date: 2026-05-18
Repo: `granit-operations`
Slice: P0
Task link: `docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
Contract/version: public `site_widget.v1` preserved

## Что Проверяли

- Additive DB foundation for `channel_identities`, `public_conversation_id`, `ai_state`, Telegram provider ids, media metadata, next-step fields, `message_deliveries`, and `manager_notification_outbox`.
- Common backend use cases: `acceptInboundMessage`, `persistAiReplyWithSendGate`, `takeoverConversation`, `setNextStep`, `recordManualContact`.
- Website widget compatibility: public endpoint/response still uses `public_session_id` and `public_message_id`, not manager/internal conversation ids.
- Telegram-ready inbound: identity reuse by provider account/chat, provider message replay, no fake `widget_sessions`, media handoff policy, manager notification outbox block when no destination is bound.
- Manager API/UI: conversation actions target `publicConversationId`; widget session is shown only as channel identity metadata.
- Telegram AI outbound remains explicitly blocked until a delivery sender/worker is implemented and proven.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| `npm run typecheck` | passed | API/packages TypeScript and manager TypeScript. |
| `npm run smoke:api` | passed | 27 tests in `apps/api/test/public-intake.test.ts`. |
| `npm test` | passed | 34 tests across public intake and manager auth. |
| `npm run build` | passed | Root typecheck plus manager production build. |
| `git diff --check` | passed | No whitespace errors in final diff. |

## Доказательство Поведения

- API/provider result: public widget responses keep `site_widget.v1` shape and do not expose `lead_id`, internal `conversation_id`, `publicConversationId`, `public_conversation_id`, or trace ids.
- DB persistence: migration `0006_p0_channel_neutral_conversation.sql` backfills widget identities and adds channel-neutral conversation/message/delivery state.
- Manager visibility: manager detail returns `publicConversationId`, `channel`, `channelIdentity`, `aiState`, optional widget metadata, and messages in one conversation shape.
- Validation/failure path: Telegram inbound without provider account/chat is rejected by repository use case; Telegram AI outbound throws `TelegramOutboundBlockedError`.
- Idempotency: tests cover existing widget idempotency and Telegram provider message replay without duplicate inbound messages.
- Public response privacy: `publicConversationId` is manager/internal targeting only; it is not returned by the public widget API.
- Paired smoke with site-cms: not run in this P0 backend pass; public contract tests stayed local to `granit-operations`.

## Rollback / Manual Fallback

- Rollback path: do not enable Telegram adapter or Telegram AI outbound; revert this backend diff before production if review rejects the foundation.
- Manual fallback: website widget still saves messages for manager review; Telegram AI outbound remains blocked rather than sending untracked provider messages.

## Blockers / Watch Items

- Full Telegram webhook/adapter and delivery sender are follow-up work.
- Telegram manager notification delivery needs bound manager destinations and provider delivery recording before it can send.
- Production remains blocked until production gates, backup/restore/rollback proof, and explicit owner sign-off.

## Sign-Off

- Owner: pending review
- Developer/release owner: Codex
- Date: 2026-05-18
