# Public Intake Contract

Status: current provider summary; S01/S04/S05 sections retain historical context

Provider: `granit-operations`
Current browser integration / paired-smoke target: `landing-granit-static`.
`granit-site-cms` is a historical/future CMS consumer, not the current landing
source.
Initial version: `site_form.v1`
Current widget version: `site_widget.v2`; `site_widget.v1` is retired and
rejected before persistence with `unsupported_schema_version`

Operations publishes the versioned public intake contract. Every browser
consumer pins the exact supported version and must not import operations
implementation code.

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

Contract changes require provider checks. Before staging traffic reaches the
affected path, run paired smoke with the current browser integration target,
`landing-granit-static`.

Existing detail: `docs/contracts/public-intake-contract.md`.

S04 historically added the first website widget message contract:

```text
POST /public/intake/site-widget/messages
schema_version: site_widget.v1
event_type: site_widget.message_submitted
```

The endpoint must create or update a lead, widget session, conversation, and inbound message before returning public success. It returns only safe public references: `public_session_id` and `public_message_id`. AI is not enabled in S04; successful responses include `automation.status: "disabled"`.

Existing detail: `docs/contracts/widget-intake-contract.md`.

S05 historically kept `site_widget.v1` and added response-only automation
states. These shapes are provenance, not the current supported contract:

- `automation.status: "disabled"` remains the safe default while AI is off;
- `automation.status: "fallback"` means the visitor message was persisted but AI did not return a confirmed persisted reply;
- `automation.status: "replied"` includes only safe public AI reply text and the AI reply public message id after the outbound message is persisted.

The public response still must not include internal `lead_id`, `conversation_id`, or `trace_id`.

The current provider contract accepts only `site_widget.v2`. It returns a
durable acknowledgement without waiting for model generation; `processing` +
`poll_history` is the authoritative thinking signal and completed state is read
from public history. Exact current artifacts are
`packages/contracts/src/site-widget/v1.ts`,
`packages/contracts/schemas/site-widget.v2.json` and
`docs/contracts/widget-intake-contract.md`.
