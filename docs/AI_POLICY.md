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
3. Authoritative conversation state is read after claim. The model receives the
   full model-safe visitor/AI transcript through the claimed message sequence,
   including the current inbound exactly once, plus known slots, requirements
   and approved static facts.
4. The main model returns a typed `granit_model_turn.v2` action. It either
   finishes the turn or requests the single read-only `search_catalog` tool.
   The backend does not infer a category from visitor keywords.
5. A catalog request is bounded to eight published candidates without URLs. The
   same model receives those candidates in one final call. A turn therefore has
   at most one catalog search and two model calls, with no autonomous tool loop.
6. App-owned validation checks strict shape, patch evidence, final-action
   consistency and recommendation membership. It may remove an exact duplicated
   or already answered question without another model call. Unknown, duplicate,
   unpublished or non-current candidate IDs cannot become public actions.
7. The server caps the final result at three recommendations and builds every
   catalog URL/button from the pinned snapshot; the model never receives or
   creates a URL.
8. After canonical text and SHA-256 are fixed, the repository rechecks the
   send gate, epoch, latest sequence and lease, then atomically commits the
   reply, state updates, handoff, winning attempt, run and job.
9. Only a committed outbound message can appear in `site_widget.history.v2`.

Malformed model actions, a repeated tool request, an unavailable catalog or a
tool timeout end the current bounded trajectory through a safe text-only answer.
They do not start another search or fabricate a catalog card.

The live validator does not use keyword or semantic regex to decide whether
free Russian prose is a price promise, deadline, legal statement, bad tone or
repetition. Those expressions produced false terminal turns and are not a
reliable semantic verifier. The prompt still forbids unsupported commercial
claims, but a prompt is not independent factual evidence.

AILR-02 by itself was not production approval. Structured published
catalog/evidence validation and final cross-repo acceptance were completed by
AILR-03 and are reflected in the current runtime. Any new staging publication
and any production rollout remain separate owner gates.

## Knowledge and recommendations

- The current production model receives the small approved static facts asset.
- The pinned catalog snapshot is searched by a typed, deterministic, read-only
  tool after the main model requests it.
- Search applies only explicit model-provided structured filters and one generic
  lexical ranking over catalog fields/search terms. There is no keyword router,
  forced single category, prefix stemmer or category-dominance threshold.
- Candidate data sent to the model is limited to verified selection fields and
  excludes URLs, paths, unpublished records and unrestricted metadata.
- The server validates current-result membership, stable IDs and published
  snapshot ownership before building URLs/actions itself.
- Missing or invalid retrieval must leave a safe text-only turn; it must not
  create a fabricated link or automatic manager handoff.

## Conversation state

- Fresh context is assembled from app-owned conversation messages, slots and
  requirements after a job is claimed.
- The model-safe transcript contains every non-empty text message with the
  `visitor` or `ai_assistant` role through the current causal cursor, ordered by
  message sequence. Manager/system/non-text messages are excluded.
- The model-safe view excludes separate internal/public IDs, timestamps, URLs,
  contact values and unrestricted metadata. Raw visitor/assistant text remains
  the actual conversation and may contain data that the visitor typed.
- One app-owned 256,000-character gate covers the exact serialized Responses
  request body, including model settings, response schema, metadata,
  instructions, transcript, tools, tone, facts and catalog results. Overflow is
  not silently truncated or summarized; the current turn receives the safe
  text-only fallback without manager handoff.
- Important saved business slots include model-safe provenance, while the
  current visitor message remains visible and has prompt-level priority over a
  conflicting saved value. The backend does not silently add saved values as
  hard search filters.
- Slot and requirement patches apply only when their value is supported by a
  unique exact quote from the current visitor message.
- Manager-authored values cannot be silently overwritten.
- A previous assistant statement is context, not evidence for a new visitor
  fact. The direct runtime does not use a rolling summary in place of the
  transcript.

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
- Model-call and catalog-tool spans record bounded latency and failure status.
  Safe message metadata records call count, selected action, search status,
  typed filter presence/categories/limit, a query hash, candidate IDs and final
  recommendation IDs. Raw search text and hidden reasoning are not persisted.
- Terminal validator evidence may retain only an allowlisted historical code;
  raw prompts, model output, customer traces, provider errors and PII are not
  added to manager/public observability.
- Request-budget overflow records only the phase and numeric request limit,
  size and transcript message count. It never records raw transcript text.
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
