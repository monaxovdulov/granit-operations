# Public Intake Contract

Status: initial placeholder

Provider: `granit-operations`
Consumer: `granit-site-cms`
Initial version: `site_form.v1`
Widget version: `site_widget.v1`

Operations publishes the versioned public intake contract. `granit-site-cms` pins the exact supported version and must not import operations implementation code.

S01 flow:

```text
public form
  -> operations intake API
  -> lead persisted
  -> manager-visible record created
  -> safe public receipt returned
```

Initial event type:

```text
site_form.submitted
```

Required request concepts:

- `schema_version`;
- idempotency key;
- source channel `site_form`;
- source page URL;
- form kind;
- submitted timestamp;
- contact fields;
- request text/details when present;
- referrer and UTM fields when available.

Safe public receipt:

- public success may be returned only after the lead or intake event is accepted and persisted;
- allowed public response fields include public submission id, accepted action, retry/fallback action, and public validation errors;
- forbidden public response fields include internal `lead_id`, `conversation_id`, `trace_id`, manager ids, eval labels, handoff internals, raw internal errors, database details, and private notification destinations.

Contract changes require provider checks. Before staging traffic reaches the affected path, run paired smoke with `granit-site-cms`.

Existing detail: `docs/contracts/public-intake-contract.md`.

S04 adds the website widget message contract:

```text
POST /public/intake/site-widget/messages
schema_version: site_widget.v1
event_type: site_widget.message_submitted
```

The endpoint must create or update a lead, widget session, conversation, and inbound message before returning public success. It returns only safe public references: `public_session_id` and `public_message_id`. AI is not enabled in S04; successful responses include `automation.status: "disabled"`.

Existing detail: `docs/contracts/widget-intake-contract.md`.
