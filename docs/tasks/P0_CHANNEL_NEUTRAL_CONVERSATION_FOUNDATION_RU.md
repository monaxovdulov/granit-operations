# Task: P0-CHANNEL-NEUTRAL-CONVERSATION - Канально-нейтральная основа диалогов

Status: merged into `main`; reviewed locally; accepted for staging acceleration as foundation; not production approval
Created: 2026-05-17
Repo: `granit-operations`
Slice: P0 before Telegram adapter and production
Owner/agent: completed implementation pass; Telegram follow-up slices already depend on this foundation

## Цель

Сделать `granit-operations` единым источником правды для обращений из website widget и будущего Telegram: один `lead`, один `conversation`, одна история `conversation_messages`, один manager takeover и один send-time gate `agent_allowed_to_reply` для всех каналов.

Продуктовая рамка GRANIT AI v1: AI разрешен только для первичного сбора информации и передачи менеджеру. Не проектировать AI как автономного продавца, самостоятельного менеджера, источник финальных цен/сроков/условий или канал, который сам ведет сделку до закрытия.

## Owner Direction Captured 2026-05-18

- Delivery/notification outbox is the app-owned bridge between operations state and Telegram Bot API. Flow: persist inbound/state in Postgres -> create outbox item -> sender/worker calls Telegram -> record delivery status.
- Telegram webhook must not call `sendMessage`, `forwardMessage`, or `copyMessage` directly for business actions. It should validate/normalize updates and call common backend use cases.
- Telegram bot should stay isolated as a transport/UX adapter. It can later grow commands, media handling, inline buttons, manager binding, retry UX and other Telegram-native features.
- Telegram bot must not become a separate CRM or source of truth. Canonical business state remains `lead`/`conversation`/`conversation_messages`/`channel_identity`/`takeover`/`ai_state`/next-step/outbox/audit in `granit-operations`.
- A future Telegram manager operations panel is allowed as a second manager UI adapter over the same backend use cases/API. It may show lead summaries, notify about new messages, allow inline manager actions and link to the web manager panel for complex work.
- Telegram manager operations must use manager identity binding, RBAC, idempotent commands/buttons, audit/timeline events and delivery/outbox for outbound/customer-visible or manager-notification sends.
- P0 should preserve this future path, but full Telegram manager panel and full bot rollout remain separate follow-up slices.

## Status Clarification 2026-05-21

- P0 implementation was merged to `main` on 2026-05-18: feature commit `93c5a8c`, merge commit `a7e2af7`.
- The stale `needs_review` status in this task has been replaced with `merged` / `reviewed locally` wording because Telegram inbound and manager-reply delivery follow-up slices now build on this foundation.
- This is accepted for staging acceleration only as the channel-neutral foundation. It is not production approval.
- Production remains blocked until production gates, backup/restore/rollback proof and explicit owner sign-off exist.
- Telegram AI outbound, manager notification sender, Mastra runtime/eval state and production worker/scheduler decisions remain separate blockers.

## Обязательные Продуктовые Правила

- Website widget и Telegram пишут в один `lead`/`conversation`/`message`/`takeover` контур.
- AI-state v1 должен быть явным состоянием, а не только UI label: `ai_collecting_info`, `needs_manager`, `manager_active`, `watching`, `closed`.
- Активный клиент должен иметь следующий шаг с датой или закрытый статус. Для v1 считать активными `lead.status IN ('in_progress', 'waiting_response')` или `ai_state IN ('manager_active', 'watching')`.
- Телефон и WhatsApp не мониторятся как чат. Они фиксируются как manual contact/timeline event и обновляют next step, но не создают `conversation_messages` с channel `phone`/`whatsapp`.
- Telegram AI outbound заблокирован до app-owned delivery/outbox. Нельзя отправлять Telegram `sendMessage` только потому, что AI reply persisted.
- Telegram media inbound v1: `voice`, `sticker`, `video_note`, `photo`, `document` сохраняются как inbound media message, переводят диалог в `needs_manager`, AI не пытается самостоятельно их интерпретировать.
- Если клиент пишет в Telegram bot, media/text handoff может уведомлять менеджера в Telegram ЛС/группу только после сохранения inbound в БД и только через app-owned manager notification outbox/delivery state.
- Бот может написать менеджеру в ЛС только если manager Telegram chat заранее привязан: менеджер сам начал диалог с ботом (`/start`) или бот добавлен в рабочую группу. Если destination не привязан или delivery failed, это должно быть видно в панели/таймлайне.
- Manager takeover выключает AI для любого канала через общий `takeoverConversation`, а не через channel-specific route.

AI-state v1 labels:

| Technical value | Manager-facing meaning |
|---|---|
| `ai_collecting_info` | AI собирает информацию |
| `needs_manager` | Нужно вмешаться |
| `manager_active` | Менеджер ведет |
| `watching` | На контроле |
| `closed` | Закрыто |

## Scope

- Добавить совместимый DB foundation: `channel_identities`, `conversations.public_conversation_id`, nullable widget-only поля, Telegram-ready provider/idempotency indexes.
- Переключить widget persistence на общие use cases, сохранив public contract `site_widget.v1`.
- Вынести текущий send-time gate из widget-specific метода в общий `persistAiReplyWithSendGate`.
- Перевести manager API/UI с `publicSessionId` на `publicConversationId` для управления conversation.
- Добавить минимальные поля/типы для будущего AI-диспетчера: `ai_state`, current next step, manual contact event, delivery/outbox block.
- Добавить Telegram media inbound policy и manager notification outbox для handoff/media событий без прямого forward из webhook.
- Добавить tests, доказывающие widget compatibility, Telegram-ready identity, common takeover, stale draft block и Telegram outbound block.

## Files Touched

This implementation pass touched:

- `docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
- `docs/tasks/README.md`
- `packages/db/src/schema.ts`
- `packages/db/migrations/0006_p0_channel_neutral_conversation.sql`
- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `apps/api/src/routes/manager.ts`
- `apps/api/test/public-intake.test.ts`
- `apps/api/test/manager-auth.test.ts`
- `apps/manager/src/types.ts`
- `apps/manager/src/api.ts`
- `apps/manager/src/App.tsx`
- `docs/release/evidence/*`

## Out Of Scope

- Production deploy или production approval.
- Полноценный Telegram bot rollout.
- Telegram AI outbound без delivery/outbox.
- Прямой Telegram forward/copy менеджеру из webhook без persistence и notification outbox.
- Отдельная Telegram CRM, `telegram_messages` как canonical store или fake `widget_sessions`.
- Автономные продажи AI, финальная квалификация сделки, цены, сроки, договоры, скидки, гарантия, оплата.
- Полный redesign manager panel, assignment/reminders/analytics/eval UI.
- Переписывание Fastify/Drizzle/Mastra, DI container, CQRS/event bus.

## Current Coupling Evidence

Проверено по текущему коду branch `ai/serious-assistant-v1`; рабочее дерево уже было dirty в API/UI файлах до этого handoff. Не перетирать чужие изменения.

| Area | Coupling point | Evidence |
|---|---|---|
| DB leads/intake | `leads.source_page_url`, `source_form_kind`, `intake_submissions.source_page_url`, `source_form_kind` обязательны | `packages/db/src/schema.ts:18-20`, `packages/db/src/schema.ts:53-55` |
| DB widget sessions | `widget_sessions` хранит `public_session_id`, `source_page_url`, `widget_instance_id` как widget-only support | `packages/db/src/schema.ts:85-104` |
| DB conversations | `conversations.widget_session_id`, `source_page_url`, `widget_instance_id` обязательны; нет `public_conversation_id` | `packages/db/src/schema.ts:107-130` |
| DB messages | `conversation_messages.source_page_url` обязательный; provider ids для Telegram отсутствуют | `packages/db/src/schema.ts:133-166` |
| Migration 0004 | `conversations.channel CHECK (channel IN ('site_widget'))`, `widget_session_id NOT NULL` | `packages/db/migrations/0004_s04_widget_persistence.sql:25-33` |
| Repository interface | Public API typed as `saveAcceptedSiteWidgetMessage`, `saveSiteWidgetAiMessage`, `takeoverSiteWidgetConversation` | `apps/api/src/repositories/intake-repository.ts:31-68`, `apps/api/src/repositories/intake-repository.ts:149-172` |
| Manager read model | `ManagerConversation.channel: "site_widget"`, `publicSessionId`, required widget fields | `apps/api/src/repositories/intake-repository.ts:111-121` |
| Widget inbound | Conversation lookup is `conversations.widgetSessionId = session.id`; new conversation is `channel: "site_widget"` | `apps/api/src/repositories/postgres-intake-repository.ts:148-184` |
| Send-time gate | Correct gate exists, but inside `saveSiteWidgetAiMessage` | `apps/api/src/repositories/postgres-intake-repository.ts:308-404` |
| Takeover | Takeover joins `conversations -> widget_sessions` and targets `publicSessionId` | `apps/api/src/repositories/postgres-intake-repository.ts:529-598` |
| Manager list/detail | Conversations are read through inner join with `widget_sessions`; output hardcodes `channel: "site_widget"` | `apps/api/src/repositories/postgres-intake-repository.ts:677-706` |
| Manager route | `PATCH /manager/leads/:leadId/conversations/:publicSessionId/takeover` | `apps/api/src/routes/manager.ts:72-99` |
| Manager UI types/API | UI types allow only `site_widget`; API client takes `publicSessionId` | `apps/manager/src/types.ts:12-19`, `apps/manager/src/types.ts:60-70`, `apps/manager/src/api.ts:39-47` |
| Manager UI rendering | Conversation key, badge, session text and takeover button use `publicSessionId`; source block always shows widget | `apps/manager/src/App.tsx:327-357`, `apps/manager/src/App.tsx:728-758`, `apps/manager/src/App.tsx:811-870` |
| Tests | In-memory repository maps `publicSessionId -> lead/conversation` and takeover by `publicSessionId` | `apps/api/test/public-intake.test.ts:1317-1437`, `apps/api/test/public-intake.test.ts:1440-1508`, `apps/api/test/public-intake.test.ts:1582-1636` |
| Telegram outbound | No app-owned `outbox`/`message_deliveries`; no Telegram send implementation found, only deferred env docs | `rg "outbox|delivery|sendMessage|TELEGRAM"` shows no runtime delivery model |

## Target Model

`channel-neutral` does not mean channel-less. Store channel as data and keep one business rule path:

- `CustomerChannel = "site_widget" | "telegram"`.
- `channel_identities` stores external identity/evidence for widget session or Telegram chat/user.
- `widget_sessions` remains website adapter support, not a required dependency of `conversations`.
- `conversations` stores `public_conversation_id`, `channel_identity_id`, `channel`, `ai_state`, `agent_allowed_to_reply`, status, metadata and timestamps.
- `conversation_messages` stores inbound/outbound history with optional `channel_identity_id`, provider ids and optional source page.
- `intake_submissions` remains the site form submission store. Telegram inbound should go through `conversation_messages`, not fake form submission rows.
- `message_deliveries` or `conversation_outbox` is required before any Telegram outbound send. Until then Telegram AI outbound is explicitly blocked.
- `manager_notification_outbox` or a typed delivery table is required before forwarding/copying Telegram customer messages to a manager Telegram destination. Manager notification is allowed only as a tracked operational notification, not as an AI/customer outbound shortcut.

## Minimum DB Plan

Implement as additive migration first. Do not start with a destructive cleanup.

1. Create `channel_identities`:
   - `id uuid primary key default gen_random_uuid()`
   - `lead_id uuid references leads(id) on delete set null`
   - `channel text not null check (channel in ('site_widget', 'telegram'))`
   - `provider text not null`
   - `provider_account_id text`
   - `external_chat_id text`
   - `external_user_id text`
   - `widget_session_id uuid references widget_sessions(id) on delete set null`
   - `display_name text`, `username text`, `normalized_phone text`
   - `metadata jsonb not null default '{}'::jsonb`
   - `created_at`, `updated_at`, `last_seen_at`
2. Add to `conversations`:
   - `public_conversation_id uuid default gen_random_uuid()`
   - `channel_identity_id uuid references channel_identities(id)`
   - `ai_state text not null default 'ai_collecting_info' check (...)`
3. Backfill existing widget conversations:
   - one `channel_identities` row per existing `widget_sessions.id`
   - `channel='site_widget'`, `provider='site_widget'`, `widget_session_id=<existing>`
   - set `conversations.channel_identity_id` and `public_conversation_id`
4. Relax widget-only fields:
   - `leads.source_page_url` nullable
   - `leads.source_form_kind` nullable
   - `conversations.widget_session_id` nullable
   - `conversations.source_page_url` nullable
   - `conversations.widget_instance_id` nullable
   - `conversations.channel` check includes `telegram`
   - `conversation_messages.channel_identity_id uuid references channel_identities(id) null`
   - `conversation_messages.provider_message_id text null`
   - `conversation_messages.provider_update_id text null`
   - `conversation_messages.provider_sent_at timestamptz null`
   - `conversation_messages.source_page_url` nullable
   - `leads.source_channel` check includes `telegram`
   - manager read model treats source page/form as optional
5. Add provider/idempotency indexes:
   - unique site widget identity on `widget_session_id WHERE channel='site_widget'`
   - unique Telegram identity on `(provider, provider_account_id, external_chat_id) WHERE channel='telegram' AND provider_account_id IS NOT NULL AND external_chat_id IS NOT NULL`
   - require Telegram adapter input to include configured `provider_account_id`; do not rely on nullable unique semantics
   - unique inbound provider message/update indexes on `conversation_messages(channel_identity_id, provider_message_id)` and `conversation_messages(channel_identity_id, provider_update_id)` where ids are not null
6. Add minimal next-step/manual-contact state:
   - `leads.next_step_at timestamptz null`
   - `leads.next_step_summary text null`
   - `leads.next_step_channel text null check (next_step_channel in ('manager_call','phone','whatsapp','telegram','site_widget','email'))`
   - optional `leads.next_step_owner_manager_id uuid null` if manager ownership exists in this slice
   - manual phone/WhatsApp contact is recorded as `lead_timeline_events.event_type='lead.manual_contact_recorded'` with structured metadata, not as chat message
7. Add delivery/outbox guard:
   - Preferred: create `message_deliveries` with `conversation_message_id`, `channel`, `provider`, `status`, `attempt_count`, `last_error`, `provider_message_id`, timestamps.
   - Minimum acceptable for this P0: add no Telegram provider send code and add an explicit test/proof that Telegram AI outbound is blocked until this table/use case exists.
8. Add manager notification outbox foundation:
   - `manager_notification_outbox.id uuid primary key`
   - `lead_id`, `conversation_id`, `conversation_message_id`
   - `notification_type text` such as `telegram_media_needs_manager`, `telegram_text_needs_manager`
   - `destination_kind text` such as `manager_telegram_private` or `manager_telegram_group`
   - `destination_identity_id` or configured destination key
   - `status text` such as `pending`, `sent`, `failed`, `retrying`, `blocked_no_destination`
   - `provider`, `provider_message_id`, `attempt_count`, `last_error`, timestamps
   - manager Telegram chat binding must be stored as app-owned state; do not hardcode personal chat ids in code or docs

After code writes all new fields, add a second migration to set `conversations.public_conversation_id NOT NULL` and unique.

## Use-Case Plan

Add small local use cases, not a framework:

```ts
type AiState =
  | "ai_collecting_info"
  | "needs_manager"
  | "manager_active"
  | "watching"
  | "closed";

type CustomerChannel = "site_widget" | "telegram";

type AcceptInboundMessageInput = {
  channel: CustomerChannel;
  provider: "site_widget" | "telegram_bot";
  providerAccountId?: string;
  externalChatId?: string;
  externalUserId?: string;
  providerMessageId?: string;
  providerUpdateId?: string;
  widgetPublicSessionId?: string;
  widgetInstanceId?: string;
  sourcePageUrl?: string;
  contact?: {
    name?: string;
    phone?: string;
    email?: string;
    preferredContact?: "phone" | "whatsapp" | "telegram" | "email";
    city?: string;
    username?: string;
  };
  message: {
    role: "visitor";
    text: string;
    submittedAt: string;
  };
  idempotencyKey: string;
  requestFingerprint: string;
  automationRequested: boolean;
  metadata: Record<string, unknown>;
};

type AcceptInboundMessageResult = {
  leadId: string;
  conversationId: string;
  publicConversationId: string;
  channelIdentityId: string;
  publicMessageId: string;
  agentAllowedToReply: boolean;
  aiState: AiState;
  replayed: boolean;
  existingAiReply?: StoredAiReply;
};
```

Required use cases:

- `acceptInboundMessage(input)` persists lead, identity, conversation and inbound message before any AI call.
- `persistAiReplyWithSendGate(input)` performs the existing atomic `agent_allowed_to_reply=true` check at persistence time for any channel.
- `takeoverConversation(input)` targets `lead_id + public_conversation_id`, sets `agent_allowed_to_reply=false`, sets `ai_state='manager_active'`, writes timeline metadata with channel and actor, and is idempotent.
- `recordManualContact(input)` writes a timeline/manual-contact record for phone/WhatsApp and updates the current next step. It must not create `conversation_messages` for phone/WhatsApp.
- `setNextStep(input)` updates `next_step_at/summary/channel` and writes timeline. Manager-owned active states require a next step.
- `recordDeliveryAttempt(input)` or equivalent outbox writer is required before Telegram outbound can be enabled.
- `enqueueManagerNotification(input)` creates a tracked manager notification after inbound persistence. It can target Telegram private chat/group only if destination identity is bound.
- `deliverManagerNotification(input)` may call Telegram `forwardMessage`/`copyMessage` only from outbox processing and must update delivery status. Webhook handlers must not call Telegram forward/copy directly.

## API/UI Plan

Manager API:

- Replace route target with:
  - `PATCH /manager/leads/:leadId/conversations/:publicConversationId/takeover`
- Return manager conversation shape:

```ts
type ManagerConversation = {
  publicConversationId: string;
  channel: "site_widget" | "telegram";
  channelIdentity: {
    provider: string;
    displayName?: string;
    username?: string;
    externalChatId?: string;
    externalUserId?: string;
    widgetPublicSessionId?: string;
    widgetInstanceId?: string;
  };
  status: "open";
  aiState: AiState;
  agentAllowedToReply: boolean;
  sourcePageUrl?: string;
  createdAt: string;
  updatedAt: string;
  messages: ManagerConversationMessage[];
};
```

Manager UI minimal update:

- Use `publicConversationId` for keys, state and takeover.
- Badge label from `channel`: `Виджет сайта` or `Telegram`.
- Show widget fields only for `site_widget`.
- Show Telegram provider identity safely for `telegram`.
- Keep Russian UI labels; do not show technical terms like lead/conversation/takeover/handoff/eval in user-facing text.
- Add only compact next-step/manual-contact controls if needed for acceptance; no full CRM redesign.

Public widget API:

- Preserve endpoint `POST /public/intake/site-widget/messages`.
- Preserve request contract `site_widget.v1`.
- Preserve response fields: `public_session_id`, `public_message_id`, `automation.status`, optional safe AI reply.
- Do not expose `lead_id`, internal `conversation_id`, `publicConversationId`, trace ids, manager ids or provider internals to the public widget.
- Existing `public_session_id` remains website widget browser-session contract, not manager conversation target.

Telegram adapter readiness:

- If added in this P0, keep behind disabled-by-default env flag.
- Webhook validates secret, normalizes update and calls `acceptInboundMessage`.
- Inbound Telegram can be persisted and shown to manager.
- AI outbound must return/block as `telegram_outbound_blocked_until_outbox` unless `message_deliveries`/outbox exists and is covered by tests.
- Text inbound can request AI only under AI v1 rules; media inbound never runs AI interpretation in P0.
- `voice`, `sticker`, `video_note`, `photo`, `document` are normalized to `contentType`, provider file ids and metadata, saved as inbound messages, set `ai_state='needs_manager'`, and enqueue manager notification if a manager Telegram destination is configured.
- Manager Telegram notification can use Telegram `forwardMessage` where allowed, with fallback to `copyMessage` or a text notification containing the lead/conversation reference if forwarding is blocked/protected. All attempts are recorded in outbox/delivery state.

## AI V1 Dispatcher Minimum

Do not redesign the panel. Add only the state the future dispatcher needs to avoid guessing:

- `ai_state`: one of `ai_collecting_info`, `needs_manager`, `manager_active`, `watching`, `closed`.
- `agent_allowed_to_reply`: hard send-time gate, still the final authority for AI outbound.
- `next_step_at`, `next_step_summary`, `next_step_channel`: current manager-visible next action.
- media/message metadata: `content_type`, `provider_file_id`, `provider_file_unique_id`, `mime_type`, `file_size`, `duration_seconds`, `caption`.
- Timeline events:
  - `conversation.message_received`
  - `conversation.ai_message_sent`
  - `conversation.manager_takeover`
  - `conversation.ai_needs_manager`
  - `lead.manual_contact_recorded`
  - `lead.next_step_updated`
  - `manager.notification_enqueued`
  - `manager.notification_delivery_failed`
  - `lead.status_changed`
- Optional metadata for dispatcher: `handoff_reason`, `missing_fields`, `last_ai_policy_version`, `last_prompt_version`, `last_provider_error`, `delivery_status`.

Dispatcher rules for v1:

- AI may ask clarifying questions and collect monument/request/contact details.
- AI must hand off when price, exact deadline, contract, warranty, payment, discount, availability, legal/inheritance/funeral or human-request topics appear.
- Manager takeover, manual phone/WhatsApp contact, or `ai_state IN ('manager_active', 'watching', 'closed')` blocks autonomous AI replies.
- Re-enabling AI is out of scope unless implemented as a separate explicit manager action with audit event.

## Acceptance Criteria

- Existing website widget tests remain green and public `site_widget.v1` request/response stays backward-compatible.
- Existing widget rows are backfilled to `channel_identities` and get `public_conversation_id`.
- A Telegram-ready inbound use-case can create/reuse identity, lead, conversation and message without `widget_session_id`, `source_page_url` or `widget_instance_id`.
- Manager API/UI targets conversations by `publicConversationId`; `publicSessionId` is widget metadata only.
- One `takeoverConversation` disables AI for widget and Telegram.
- One `persistAiReplyWithSendGate` blocks stale AI drafts for widget and Telegram at persistence time.
- Active manager-owned lead states require a next step with date or a closed terminal status.
- Phone/WhatsApp manual contacts are visible as manual contact/timeline/next-step state, not chat messages.
- Telegram AI outbound is not enabled unless app-owned delivery/outbox exists and is tested.
- Telegram media inbound is persisted, visible to manager, sets `needs_manager`, and does not trigger AI interpretation or AI reply.
- Telegram manager notification for media/handoff is queued only after inbound persistence and delivered only through tracked outbox/delivery state.
- If manager Telegram destination is not bound, notification status is `blocked_no_destination`/equivalent and the manager panel still shows the lead/message.
- No fake `widget_sessions` for Telegram, no separate Telegram CRM/status/takeover policy.

## Required Tests

Widget compatibility:

- `POST /public/intake/site-widget/messages` accepts existing `site_widget.v1` payloads and returns the same public shape.
- Repeated widget `public_session_id` continues the same conversation through `channel_identity`.
- Public widget response does not include `publicConversationId` or internal ids.
- Existing idempotency conflict behavior remains.

Telegram-ready identity:

- `acceptInboundMessage(telegram)` creates identity/lead/conversation/message without widget session or source page.
- Same `(provider, provider_account_id, external_chat_id)` reuses identity/conversation.
- Same `provider_message_id` or `provider_update_id` does not create duplicate inbound message.
- Telegram input without required `provider_account_id` is rejected if the uniqueness strategy depends on it.
- Telegram `voice`, `sticker`, `video_note`, `photo`, `document` persist as inbound media messages with `content_type`, provider file ids and metadata.
- Media inbound sets `ai_state='needs_manager'`, `agent_allowed_to_reply=false` or no AI-run for that turn, and does not call AI provider.

Manager notification outbox:

- Media/handoff inbound creates `manager_notification_outbox` row only after message persistence.
- If manager Telegram destination is bound, outbox worker calls Telegram forward/copy from the persisted row, not from the webhook.
- Delivery success stores provider delivery id/status.
- Delivery failure stores `last_error` and remains manager-visible.
- If manager destination is not bound, status is `blocked_no_destination` and no provider call is attempted.
- Protected/non-forwardable message fallback uses `copyMessage` or a text notification with lead/conversation reference, and records which strategy was used.

Common takeover:

- Manager takeover route accepts `publicConversationId`.
- Owner/manager can takeover; viewer cannot.
- Takeover sets `agent_allowed_to_reply=false`, `ai_state='manager_active'`, writes timeline, and is idempotent.
- Same test passes for widget and Telegram seeded conversations.

Stale draft block:

- AI starts generating while `agent_allowed_to_reply=true`.
- Manager calls `takeoverConversation(publicConversationId)`.
- `persistAiReplyWithSendGate` returns/throws blocked result.
- No outbound `conversation_messages` row is inserted.
- No `message_deliveries`/outbox item is created.
- Public/widget or Telegram adapter response does not send AI text.

Next step/manual contact:

- Manager-owned active states cannot be saved without `next_step_at`.
- Closed/duplicate/spam states do not require a next step.
- Phone/WhatsApp manual contact writes timeline and updates next step, but does not create chat message rows.

Telegram outbound block proof:

- Test or grep-based smoke proves there is no Telegram provider send path without `message_deliveries`/outbox.
- If Telegram adapter exists, AI reply persistence for Telegram either creates delivery/outbox state or returns `telegram_outbound_blocked_until_outbox`.
- No runtime code calls Telegram `sendMessage` before persisted delivery/outbox state.
- No runtime webhook handler calls Telegram `forwardMessage` or `copyMessage` directly before inbound persistence and manager notification outbox creation.

## Checks For Implementation Agent

Before coding:

- `git status --short` and identify existing dirty files.
- This record is historical; retired AI-plan provenance is in
  `docs/tasks/ARCHIVE_RU.md`. Current work starts from `docs/source-of-truth.md`.
- Read planning docs in `../../granit-plan-app/docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`, `../../granit-plan-app/docs/PROJECT_STATUS_RU.md`, `../../granit-plan-app/docs/TASK_BOARD_RU.md`, and Telegram audit/review docs.

After coding:

- `npm run typecheck`
- `npm run smoke:api`
- `npm test`
- `npm run build`
- `git diff --check`
- Add/update release evidence under `docs/release/evidence/` only for checks actually run. Staging evidence is not production approval.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| Read planning P0/status/task board/audit docs | reviewed | `granit-plan-app` source docs were used as handoff source of truth. |
| `rg` coupling scan in `packages`, `apps`, `docs` | reviewed | Captured widget-specific `publicSessionId`, `widget_sessions`, `site_widget` and delivery/outbox absence. |
| `git diff --check -- docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md docs/tasks/README.md` | passed | No whitespace errors in tracked diff; new file is also checked separately below. |
| `grep -n '[[:blank:]]$' docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md docs/tasks/README.md` | no matches | No trailing whitespace in the handoff files; grep exit 1 is expected here. |
| `npm run typecheck` | passed | API/packages TS plus manager TS. |
| `npm run smoke:api` | passed | 27 public intake tests, including widget compatibility, Telegram-ready identity, common takeover, media policy, outbound block, and manual contact/next-step state. |
| `npm test` | passed | 34 tests across public intake and manager auth. |
| `npm run build` | passed | Root typecheck plus manager production build. |
| `git diff --check` | passed | No whitespace errors in final working diff. |

## Evidence Links

- Planning P0: `../../granit-plan-app/docs/tasks/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
- Project status: `../../granit-plan-app/docs/PROJECT_STATUS_RU.md`
- Task board: `../../granit-plan-app/docs/TASK_BOARD_RU.md`
- Telegram audit: `../../granit-plan-app/docs/refactor-audits/2026-05-17-telegram-channel-state-audit-ru.md`
- Telegram audit review: `../../granit-plan-app/docs/refactor-audits/2026-05-17-telegram-channel-state-audit-review-ru.md`
- Current widget contract: `docs/contracts/widget-intake-contract.md`
- AI policy: `docs/AI_POLICY.md`
- Lifecycle: `docs/LEAD_LIFECYCLE.md`
- P0 release evidence: `docs/release/evidence/P0_CHANNEL_NEUTRAL_CONVERSATION_FOUNDATION_RU.md`
- S04/S05/S06 evidence: `docs/release/evidence/S04_WIDGET_PERSISTENCE_RU.md`, `docs/release/evidence/S05_WEBSITE_SAFE_AI_RU.md`, `docs/release/evidence/S06_MANAGER_TAKEOVER_RU.md`

## Blockers

- Telegram inbound + manager mini-panel and manual manager-reply delivery sender are follow-up slices on top of this merged foundation; the manager reply worker/scheduler remains separate.
- Telegram AI outbound remains blocked even though manager-authored delivery has a sender path and staging smoke evidence.
- Telegram manager notification delivery remains queued/blocked with app-owned state until manager Telegram destinations are bound and a sender records delivery attempts.
- Human must separately decide later when, if ever, AI responsibility expands beyond v1.
- Production remains blocked until production gates, backup/restore/rollback proof and explicit owner sign-off.

## Next Action

Use this merged foundation for the already-started Telegram slices. The next separate implementation goal is `TELEGRAM-MANAGER-REPLY-WORKER`: manager-authored replies only, disabled by default, with no Telegram AI outbound or manager notification sender in scope.
