# packages/contracts

Versioned public contract artifacts.

Operations publishes the public intake contract from this repo. `granit-site-cms` consumes a pinned version and must not import operations implementation code.

Initial S01 contract:

- version: `site_form.v1`;
- TypeScript/Zod artifact: `src/public-intake/v1.ts`;
- JSON Schema artifact: `schemas/public-intake.v1.json`.

S04 widget contract:

- version: `site_widget.v1`;
- endpoint: `POST /public/intake/site-widget/messages`;
- TypeScript/Zod artifact: `src/site-widget/v1.ts`;
- JSON Schema artifact: `schemas/site-widget.v1.json`;
- public success is valid only after the widget message is persisted;
- automation is explicitly disabled in S04 through `automation.status: "disabled"`.
