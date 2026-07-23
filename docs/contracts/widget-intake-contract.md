# Widget Intake Contract

Status: Consult-first Stage B additive AI dialog
Provider: `granit-operations`
Consumer: `granit-site-cms`
Versions: `site_widget.v1` (legacy synchronous), `site_widget.v2` (durable async)

## Flow

```text
public site widget
  -> operations intake API
  -> widget session persisted
  -> lead/conversation/message persisted
  -> manager-visible dialog created
  -> v2 AI job persisted in the same transaction
  -> safe public receipt returned immediately
  -> optional safe AI reply persisted by the background worker
  -> slots, AI run and handoff/degradation evidence persisted
  -> v2 client polls public history until the job is terminal
```

## Endpoint

```text
POST /public/intake/site-widget/messages
```

The endpoint accepts:

- `schema_version: "site_widget.v1"` for backwards-compatible synchronous callers;
- `schema_version: "site_widget.v2"` for immediate durable acknowledgement and history polling;
- `event_type: "site_widget.message_submitted"`;
- source channel `site_widget`.

## Required Request Concepts

- idempotency key;
- submitted timestamp;
- source page URL;
- widget instance id;
- visitor message with `role: "visitor"`;
- optional public session id for continuing the same browser session;
- optional contact fields;
- referrer, UTM, locale/timezone when available.

## Persistence Rule

Public success may be returned only after all S04 state is accepted and persisted:

- `widget_sessions`;
- `leads`;
- `conversations`;
- `conversation_messages`;
- manager timeline event.

For `site_widget.v2`, an eligible `widget_ai_jobs` row and the complete bounded AI-turn input are inserted in that same transaction. The client-supplied `submitted_at` is replaced by an authoritative server timestamp before persistence and acknowledgement.

## V2 Async Response

`site_widget.v2` returns `202` without waiting for model generation. The response includes public session, conversation and message ids, authoritative `submitted_at`, plus one of:

- `processing` + `poll_history` while a durable job is pending, processing or retrying;
- `replied` when an idempotent replay finds a completed answer;
- `degraded` after a terminal safe failure;
- `manager_pending` or `disabled` when AI may not reply.

The worker claims jobs with `FOR UPDATE SKIP LOCKED`, a bounded lease and retry budget. Final AI persistence still uses the existing atomic send-time gate, so manager takeover wins over a stale generated draft.

## Safe Public Response

Allowed public response fields:

- `ok`;
- `schema_version`;
- `status: "accepted" | "replayed"`;
- `public_session_id`;
- `public_message_id`;
- `action: "show_widget_saved"`;
- `automation.status: "disabled" | "fallback" | "replied"`;
- for `automation.status: "replied"`, only public AI message id and safe reply text;
- for `automation.status: "replied"`, `conversation_state: "ai_active" | "manager_pending"`;
- for `automation.status: "fallback"`, a public fallback reason without raw provider/internal errors;
- safe localized `message_to_user`.

Forbidden public response fields:

- internal `lead_id`;
- internal `conversation_id`;
- internal `trace_id`;
- manager ids;
- eval labels;
- handoff internals;
- raw internal errors;
- database details;
- private notification destinations.

## S04 Historical Non-Goals

- AI replies;
- Telegram;
- manager takeover/send controls;
- final price/date/warranty promises;
- direct site access to operations database or manager APIs.

## S05 AI Addendum

AI remains server-side in `granit-operations`; `OPENAI_API_KEY` is never exposed to the public site.

When `AI_WIDGET_ENABLED=false`, S04 behavior is unchanged and successful responses include:

```json
{
  "automation": {
    "status": "disabled",
    "next_step": "manager_review"
  }
}
```

When AI is enabled and provider config is available:

- the inbound visitor message is persisted first;
- OpenAI Responses API is called only from operations backend;
- any outbound AI answer is inserted into `conversation_messages` with `direction=outbound` and `sender_role=ai_assistant` before the public response includes it;
- if model generation, semantic verification, grounding, or AI-message persistence fails, public success remains an intake success, `automation.status` is `degraded`, `conversation_state` stays `ai_active`, and no unverified AI reply text is returned;
- public response still must not include internal lead, conversation, or trace ids.

Allowed replied shape:

```json
{
  "automation": {
    "status": "replied",
    "next_step": "ai_reply_shown",
    "conversation_state": "ai_active",
    "reply": {
      "public_message_id": "uuid",
      "sender_role": "ai_assistant",
      "text": "safe Russian reply"
    }
  }
}
```

Safety policy:

- no final price, exact deadline, warranty, contract, discount, availability, payment, or legal/funeral/inheritance advice;
- no price amounts in S05 because no approved price-list source is implemented;
- important conditions require manager confirmation.

## Consult-first Stage B Addendum

- the provider receives a bounded app-owned history of up to 12 prior messages and 12,000 characters;
- the current inbound message remains separate from prior history;
- extracted request slots are validated and persisted with provenance;
- provider output uses a strict typed JSON decision; the model cannot write state or authorize sending;
- an ordinary first price/deadline question remains consultative and asks at most one useful unknown slot;
- an explicit manager request, final quote pressure, binding terms or an out-of-scope legal topic creates a persisted terminal handoff;
- terminal handoff sets `agent_allowed_to_reply=false`, moves the conversation to `needs_manager`, writes manager-visible timeline evidence and creates an outbox work item;
- provider, schema, source or persistence degradation creates manager-visible evidence and a safe public fallback.

## Safe History Read

```text
GET /public/intake/site-widget/sessions/:publicSessionId/history
```

The endpoint accepts only a UUID public session id and returns at most 100 public text messages:

```json
{
  "ok": true,
  "schema_version": "site_widget.history.v1",
  "public_session_id": "uuid",
  "public_conversation_id": "uuid",
  "conversation_state": "ai_active",
  "messages": [
    {
      "public_message_id": "uuid",
      "sender_role": "visitor",
      "text": "message",
      "submitted_at": "2026-07-16T00:00:00.000Z"
    }
  ]
}
```

Allowed states are `ai_active`, `manager_pending`, `manager_active`, and `closed`. Internal lead/conversation ids, slots, run metadata and manager destinations are never returned.

`site_widget.history.v2` is requested with `?schema_version=site_widget.history.v2`. It adds authoritative message timestamps, visitor-job status, an optional `poll_after_ms`, and verified `catalog_references`. Catalog references are relative allowlisted deep links derived only from a published selected catalog record and a supported `/frontend/url` verifier claim; raw URLs are removed from assistant text.
