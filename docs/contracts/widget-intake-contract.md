# Widget Intake Contract

Status: S04 published scaffold
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
- `automation.status: "disabled"`;
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

## S04 Non-Goals

- AI replies;
- Telegram;
- manager takeover/send controls;
- final price/date/warranty promises;
- direct site access to operations database or manager APIs.
