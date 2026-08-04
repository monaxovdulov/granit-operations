# AI Policy

Status: grounded website consultant and reviewed catalog provider implemented; customer traffic remains controlled by runtime flags

Website AI remains disabled unless `AI_WIDGET_ENABLED=true`. Enabling that flag alone does not select the grounded pipeline: `AI_WIDGET_GROUNDED_MODE` must explicitly be `shadow` or `enforce`; missing, empty, or unknown values fail closed to `off`. Production enablement still requires separate owner approval.

## Grounded send path

1. The visitor message is durably persisted before model generation.
2. A generator writes a natural Russian reply plus typed slots and flexible requirements with exact message evidence.
3. App-owned structural checks validate values, quotes, offsets, requested slots and handoff shape.
4. An independent semantic verifier extracts every factual span from the finished reply, grounds it, and returns exact one-to-one verdicts for every proposed slot and requirement.
5. App-owned contract validation checks claim spans, coverage and references. A catalog URL must exactly equal the selected published record's canonical top-level `frontend.url`; a valid record reference cannot support altered URL text.
6. `handoff` is applied immediately with an app-owned response. Exactly one bounded repair is allowed only for `repair` while the shared 18-second turn deadline has enough budget; a handoff returned after repair is also terminal.
7. After a verified plan, the application may retain the model text or render deterministic customer-facing text for a safe commercial flow. Only the resulting app-approved reply reaches the atomic send-time `agent_allowed_to_reply=true` gate.

Semantic decisions are not made by keyword regex in the grounded path. Requests for a manager, legal advice and binding commercial promises are judged from the full dialog context. Words such as `документ` or `связаны` do not trigger handoff by themselves.

## Knowledge

- Business/catalog truth comes only through `CatalogKnowledgePort` snapshots and published records.
- Server assembly uses the deterministic `granit-cha.catalog.2026-07-20.v1` file snapshot (465 published records; 16 review-required records stay draft and are never retrieved).
- `empty.v1` is not used in the normal assembled runtime; it remains an explicit fallback/test implementation.
- Missing knowledge is answered honestly and does not by itself force a handoff.
- A fact about the visitor must be backed by an exact quote and UTF-16 offsets from a visitor message.
- A slot or flexible requirement value must also be semantically supported by that quote; matching offsets alone are insufficient.
- Manager-authored slot values cannot be silently overwritten; conflicting AI candidates are retained as append-only events.

## Conversation memory

- The latest 12 messages remain verbatim in model context.
- Older dialog is folded into an app-owned rolling summary so discussed options and objections are not silently lost.
- The rolling summary helps continuity but is never accepted as evidence for a new visitor fact.
- Thirteen typed slots cover core intake. Evidence-backed flexible preferences, requirements and avoidances cover style, color, shape, accessories, decoration and site constraints.

## Handoff and degradation

- Explicit manager requests, legal advice and binding/final commercial terms may require handoff.
- A successful handoff stops AI, persists a snapshot, adds timeline/outbox events and notifies managers with the structured intake.
- Model/verifier/grounding failure degrades only the current turn. The inbound message remains saved, the manager sees the event, and AI stays available for the next turn.
- A manager takeover still disables AI and the send-time gate blocks stale drafts.

## Rollout and evaluation

- `off`: legacy compatibility path.
- `shadow`: the legacy reply is returned without waiting for grounded work; the full grounded/legacy comparison, evidence, verdicts and latency are recorded asynchronously.
- `enforce`: unverified model text cannot be sent. Customer-facing text is either a model reply accepted by generator, verifier and app-side contract checks, or deterministic app-owned plan/fallback text allowed by policy; both still pass through the send-time gate.
- Offline regression contains 40 realistic dialogs and checks extracted values/evidence, flexible requirements, claim coverage, semantic quality and latency in addition to action. Stateful persistence tests cover long dialogs and flexible requirements. Paid live evaluation additionally requires `AI_WIDGET_EVAL_LIVE=true` and owner-provided OpenAI credentials.

Future owner updates, especially commercial terms, are documented in `docs/AI_ASSISTANT_OWNER_INPUT_GUIDE_RU.md`. A plain-Russian explanation of layers, message flow, controls and limitations is in `docs/AI_ASSISTANT_OWNER_ARCHITECTURE_GUIDE_RU.md`.

Telegram AI remains out of scope. Do not enable production AI or deploy these changes without separate production approval.
