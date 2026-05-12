# packages/db

Drizzle/Postgres schema and migrations.

This package will own operational data models such as leads, customers, channel identities, conversations, messages, manager workflow, handoff, follow-up, review labels, and trace/eval references.

S01 includes:

- `leads`;
- `intake_submissions`;
- `lead_timeline_events`;
- migration `migrations/0001_s01_intake.sql`.

No database credentials belong in this repo.
