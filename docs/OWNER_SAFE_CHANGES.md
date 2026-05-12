# Owner Safe Changes

Status: initial scaffold

Potentially safe owner-led changes later:

- documentation;
- labels/help text that do not affect operational behavior;
- owner-readable evidence templates;
- small manager-panel copy changes after review of affected workflow.
- after S02 auth exists, requesting a specific manager email to be added/disabled through the reviewed admin path.

Review-required changes:

- public intake contract;
- form submission behavior;
- database schema or migrations;
- auth, roles, permissions;
- lead statuses, reminders, close reasons, notification logic;
- takeover/resume or `agent_allowed_to_reply`;
- AI policy, price policy, prompts, tools, evals, model config, urgent logic, or notification payload;
- deploy, secrets, backup, restore, or rollback configuration.

Owner-led changes must not add AI replies, Telegram, widget AI, urgent production notifications, full SEO migration, or production deploy before the corresponding accepted slice and review.
