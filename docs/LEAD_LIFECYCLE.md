# Lead Lifecycle

Status: S03-min implemented locally

S01 started with the minimum lifecycle needed to prove form persistence and manager visibility.
S03-min adds the smallest owner-approved status set needed before website widget persistence.

Minimal statuses:

| Internal code | UI label | Meaning |
|---|---|---|
| `new` | `Новая` | Новая заявка из формы сайта или будущего канала. |
| `in_progress` | `В работе` | Менеджер или AI активно ведет заявку. |
| `waiting_response` | `Ждет ответа` | Последний ожидаемый шаг сейчас на стороне клиента. |
| `closed` | `Закрыта` | Заявка завершена без отдельной детализации причины в S03-min. |
| `duplicate` | `Дубль` | Заявка признана дублем другой заявки. |
| `spam` | `Спам` | Заявка признана спамом. |

S01 records should preserve:

- lead id;
- public submission id mapping;
- source channel `site_form`;
- source page URL;
- form kind;
- contact fields;
- request text/details when present;
- created time;
- creation timeline/stage event;
- status-change timeline event.

S03-min status changes:

- are available through protected manager API only;
- allow `owner` and `manager` roles to change status;
- keep `viewer` role read-only;
- update `leads.status`;
- write `lead.status_changed` into `lead_timeline_events`;
- store `from_status`, `to_status`, and manager actor metadata in timeline event metadata.

Later lifecycle scope:

- assignment;
- follow-up tasks;
- reminders and overdue queue;
- close reasons;
- reopen;
- duplicate/spam merge/review beyond the minimal status itself;
- takeover/resume;
- audit events;
- bad-case review labels.

Every future lifecycle transition must write an audit event. UI filters or tabs must not be the only place where lifecycle state exists.
