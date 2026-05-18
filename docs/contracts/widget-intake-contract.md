# Widget Intake Contract

Status: S05 additive AI response
Provider: `granit-operations`
Consumer: `granit-site-cms`
Version: `site_widget.v1`

## Flow

```text
public site widget
  -> operations intake API
  -> widget session persisted
  -> lead/conversation/message persisted
  -> manager-visible dialog created
  -> optional safe AI reply persisted
  -> safe public receipt returned
```

## Endpoint

```text
POST /public/intake/site-widget/messages
```

The endpoint accepts only:

- `schema_version: "site_widget.v1"`;
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
- if model generation or AI-message persistence fails, public success remains an intake success but `automation.status` is `fallback` and no AI reply text is returned;
- public response still must not include internal lead, conversation, or trace ids.

Allowed replied shape:

```json
{
  "automation": {
    "status": "replied",
    "next_step": "ai_reply_shown",
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
