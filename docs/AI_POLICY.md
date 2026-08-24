# AI Policy

Status: single direct model-turn runtime implemented; customer traffic and
deployment remain separately gated.

Website AI stays disabled unless `AI_WIDGET_ENABLED=true`. When enabled, the
application has one app-owned `direct_openai` model-turn pipeline. There is no
second production runtime, hidden fallback contour or live semantic verifier.
Production enablement still requires separate manual owner approval.

## Current send path

1. The visitor message is durably persisted before model generation.
2. A PostgreSQL job is claimed only while the conversation gate, generation
   epoch, latest visitor sequence and lease are current.
3. Authoritative conversation state is read after claim. The model receives a
   bounded view with the current inbound, recent safe messages, known slots and
   approved static facts.
4. One structured model call returns `granit_model_turn.v1`: answer text, an
   optional separate question, evidence-backed state patches, recommendation
   IDs and an optional bounded handoff intent.
5. App-owned validation checks strict shape, patch evidence and action
   consistency. It may remove an exact duplicated or already answered question
   without another model call. A current turn is rejected only when the output
   shape is invalid, no text remains after allowed repair, or handoff and a
   question conflict.
6. After canonical text and SHA-256 are fixed, the repository rechecks the
   send gate, epoch, latest sequence and lease, then atomically commits the
   reply, state updates, handoff, winning attempt, run and job.
7. Only a committed outbound message can appear in `site_widget.history.v2`.

The live validator does not use keyword or semantic regex to decide whether
free Russian prose is a price promise, deadline, legal statement, bad tone or
repetition. Those expressions produced false terminal turns and are not a
reliable semantic verifier. The prompt still forbids unsupported commercial
claims, but a prompt is not independent factual evidence.

Therefore the current unpublished AILR-02 state is not production approval:
structured published catalog/evidence validation in AILR-03/04 and final
cross-slice acceptance are required before any deployment of this Goal.

## Knowledge and recommendations

- The current production model receives the small approved static facts asset.
- Production catalog retrieval is not connected yet.
- Any non-empty `recommendationIds` list is currently dropped; no model-supplied
  identifier becomes a public catalog action.
- The next catalog slices add server-side published retrieval before the same
  single model call. The server will validate candidate membership, stable IDs,
  revisions and published status, then build URLs/actions itself.
- Missing or invalid retrieval must leave a safe text-only turn; it must not
  create a fabricated link or automatic manager handoff.

## Conversation state

- Fresh context is assembled from app-owned conversation messages, slots,
  requirements and memory after a job is claimed.
- The model-safe view is bounded and excludes internal IDs, timestamps, URLs,
  contact values and unrestricted metadata.
- Slot and requirement patches apply only when their value is supported by a
  unique exact quote from the current visitor message.
- Manager-authored values cannot be silently overwritten.
- A summary or previous assistant statement is context, not evidence for a new
  visitor fact.

## Handoff and degradation

- A model handoff intent is limited to an explicit manager request, final quote
  pressure or readiness to order and may not coexist with a question.
- A successful handoff reply and ownership transition are committed atomically;
  subsequent AI replies are disabled.
- A validator, provider, context or persistence failure degrades only the
  current turn. It does not itself transfer the conversation to a manager.
- A new visitor message makes an older generation stale. Its result is not
  committed, and the new message receives a fresh job and context.
- A manager takeover disables AI. The atomic send gate blocks any in-flight
  stale draft, so AI sends nothing after takeover.

## Observability and privacy

- App-owned logical runs, physical attempts, spans and quality events are the
  operational source of truth.
- Terminal validator evidence may retain only an allowlisted historical code;
  raw prompts, model output, customer traces, provider errors and PII are not
  added to manager/public observability.
- Historical `unsafe_claim`, `tone_violation` and `repeated_reply` codes remain
  readable for old durable evidence. Their presence in the enum does not make
  them current live terminal gates.
- Tone, helpfulness and repetition are evaluated with offline fixtures/rubrics
  and manual review, separately from structural constraints.

## Rollout and evaluation

- The operational switch remains `AI_WIDGET_ENABLED=false` by default.
- Offline regression is evidence, not a production runtime and not deployment
  approval. Paid live evaluation still requires explicit owner permission,
  credentials and its separate runtime gate.
- Green tests do not replace the owner's manual acceptance. Commit, push,
  deploy, production configuration and real traffic require separate commands.
- Code rollback is the whole accepted slice revert; there is no runtime selector
  for returning to a second AI contour.

Telegram AI remains out of scope.
