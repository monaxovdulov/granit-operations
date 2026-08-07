# packages/contracts

Versioned public contract artifacts.

Operations publishes the public intake contract from this repo. The current
`landing-granit-static` and browser widget consume pinned versions and must not
import operations implementation code.

Initial S01 contract:

- version: `site_form.v1`;
- TypeScript/Zod artifact: `src/public-intake/v1.ts`;
- JSON Schema artifact: `schemas/public-intake.v1.json`.

Current widget contract:

- supported version: `site_widget.v2` (durable async acknowledgement + history polling);
- endpoint: `POST /public/intake/site-widget/messages`;
- TypeScript/Zod artifact: `src/site-widget/v2.ts`;
- JSON Schema artifact: `schemas/site-widget.v2.json`;
- public success is valid only after the widget message is persisted;
- accepted AI work is exposed as `automation.status: "processing"` and completed state is read from history;
- `site_widget.v1` is retired and rejected before persistence.
