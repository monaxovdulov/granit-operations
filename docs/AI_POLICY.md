# AI Policy

Status: grounded website consultant implemented behind a disabled runtime flag

Website AI remains disabled unless `AI_WIDGET_ENABLED=true`. The grounded pipeline is selected with `AI_WIDGET_GROUNDED_MODE=enforce`; production enablement and the external machine-readable catalog require separate owner approval.

## Grounded send path

1. The visitor message is durably persisted before model generation.
2. A generator writes a natural Russian reply and typed slots/claims with evidence.
3. App-owned structural checks validate slot quotes, offsets, catalog references, requested slots and handoff shape.
4. An independent semantic verifier checks the full reply, including claims the generator did not annotate.
5. One bounded repair is allowed while the shared 18-second turn deadline has enough budget.
6. Only a verified reply reaches the atomic send-time `agent_allowed_to_reply=true` gate.

Semantic decisions are not made by keyword regex in the grounded path. Requests for a manager, legal advice and binding commercial promises are judged from the full dialog context. Words such as `документ` or `связаны` do not trigger handoff by themselves.

## Knowledge

- Business/catalog truth comes only through `CatalogKnowledgePort` snapshots and published records.
- The current provider is intentionally empty (`empty.v1`) until the owner supplies the external JSON catalog and its adapter.
- Missing knowledge is answered honestly and does not by itself force a handoff.
- A fact about the visitor must be backed by an exact quote and UTF-16 offsets from a visitor message.
- Manager-authored slot values cannot be silently overwritten; conflicting AI candidates are retained as append-only events.

## Handoff and degradation

- Explicit manager requests, legal advice and binding/final commercial terms may require handoff.
- A successful handoff stops AI, persists a snapshot, adds timeline/outbox events and notifies managers with the structured intake.
- Model/verifier/grounding failure degrades only the current turn. The inbound message remains saved, the manager sees the event, and AI stays available for the next turn.
- A manager takeover still disables AI and the send-time gate blocks stale drafts.

## Rollout and evaluation

- `off`: legacy compatibility path.
- `shadow`: legacy reply is sent while grounded output is recorded in metadata for comparison.
- `enforce`: only generator + verifier output can be sent.
- Offline regression contains 36 realistic dialogs. Paid live evaluation additionally requires `AI_WIDGET_EVAL_LIVE=true` and owner-provided OpenAI credentials.

Telegram AI remains out of scope. Do not enable production AI or deploy these changes without separate production approval.
