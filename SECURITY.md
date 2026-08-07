# Security Policy

## Supported state

This repository has no production release or supported version line yet.
Security review targets the current `main` commit named in the report. Code in
the repository is not production approval, and AI and Telegram are disabled by
default.

## Report a vulnerability privately

Do not open a public Issue for a suspected vulnerability, secret, customer data
exposure or infrastructure detail.

1. Use GitHub private vulnerability reporting from the repository Security tab
   when the **Report a vulnerability** action is available.
2. If that action is unavailable, contact the repository owner through the
   [`monaxovdulov` GitHub profile](https://github.com/monaxovdulov) and request a
   private reporting channel. Do not include sensitive details in the public
   contact message.
3. Include the affected commit, component, reproduction steps, impact and a
   sanitized log. Replace tokens, personal data, database addresses and private
   host details with short fingerprints.

The report is ready for triage when maintainers can reproduce the issue without
receiving live credentials or real customer records.

## Coordinated scope

Use the same private report for a finding that crosses these boundaries:

- `granit-operations`: API, PostgreSQL persistence, AI runtime, manager controls,
  send gate and takeover;
- `business-ai-web-widget`: Web Component source, browser storage, rendering and
  public-contract parsing;
- customer landing: pinned runtime provenance and loader configuration.

State which repository and exact commit first exhibits the issue. The landing
does not own widget source, and browser code must never receive backend, model or
database credentials.

## Public reports

Use public Issues only for non-sensitive bugs that contain no exploit detail,
secret, personal/client data, private log or infrastructure information.
