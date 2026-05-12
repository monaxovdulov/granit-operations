# Public Intake Contract

Status: S01 published scaffold
Provider: `granit-operations`
Consumer: `granit-site-cms`
Initial version: `site_form.v1`

Operations publishes the versioned public intake contract. `granit-site-cms` pins the exact supported version and must not import operations implementation code.

## S01 Flow

```text
public form
  -> operations intake API
  -> lead persisted
  -> manager-visible record created
  -> safe public receipt returned
```

## S01 Event

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

## S01 Artifact Paths

- TypeScript/Zod: `packages/contracts/src/public-intake/v1.ts`
- JSON Schema: `packages/contracts/schemas/public-intake.v1.json`

## S01 Endpoint

```text
POST /public/intake/site-form
```

The endpoint accepts only `schema_version: "site_form.v1"` and `event_type: "site_form.submitted"`.

## Idempotency

The API must treat repeated submissions with the same idempotency key as safe retries.

The expected behavior is:

- do not create duplicate leads for the same accepted request;
- return a safe public receipt for the accepted submission when possible;
- keep implementation details private.

Exact storage and expiry rules are implementation work for S01.

## Safe Public Receipt

Public success may be returned only after the lead or intake event is accepted and persisted.

Allowed public response fields:

- public submission id;
- accepted action such as `show_thank_you` or `show_inline_success`;
- retry/fallback action when the backend cannot confirm persistence;
- public validation errors safe for a website user.

Forbidden public response fields:

- internal `lead_id`;
- internal `conversation_id`;
- internal `trace_id`;
- manager ids;
- eval labels or eval case ids;
- handoff internals;
- raw internal error messages;
- database details;
- private notification destinations.

## Error Classes

The contract must cover:

- validation error;
- unsupported schema version;
- duplicate or idempotent replay result;
- retryable backend failure;
- degraded/fallback response;
- rate-limit or abuse response if added.

Backend failure must never produce public success.

## Provider Checks

Operations-side changes to this contract require provider checks. Before staging traffic reaches the affected path, run paired smoke with `granit-site-cms`:

```text
site-cms submits representative form
operations accepts and persists lead
manager panel shows lead
site shows success only after acceptance
failure path shows retry/fallback
```
