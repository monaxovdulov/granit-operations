# Manager Panel Scope

Status: initial scaffold

S01 manager panel can be intentionally narrow, but it must prove visibility and no lost lead.

Inbox minimum:

- new website form leads;
- source channel badge `site_form`;
- source page URL and form kind when known;
- contact data summary;
- created time;
- current status, initially `new`;
- indicator for intake errors or fallback cases if any.

Lead detail minimum:

- lead id and public submission id mapping;
- contact fields received from the form;
- request text/details;
- source page URL, form kind, referrer/UTM when available;
- timeline entry for lead creation/form recording;
- current status;
- internal note placeholder is acceptable.

Later slices add lifecycle, assignment, reminders, overdue queue, takeover/resume, bad-case review, and simple analytics.

Existing placeholder: `apps/manager/README.md`.
