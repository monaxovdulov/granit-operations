# Lead Lifecycle

Status: initial scaffold

S01 starts with the minimum lifecycle needed to prove form persistence and manager visibility.

Initial status:

```text
new
```

S01 records should preserve:

- lead id;
- public submission id mapping;
- source channel `site_form`;
- source page URL;
- form kind;
- contact fields;
- request text/details when present;
- created time;
- creation timeline/stage event.

Later lifecycle scope:

- assignment;
- follow-up tasks;
- reminders and overdue queue;
- close reasons;
- reopen;
- duplicate/spam review;
- takeover/resume;
- audit events;
- bad-case review labels.

Every future lifecycle transition must write an audit event. UI filters or tabs must not be the only place where lifecycle state exists.
