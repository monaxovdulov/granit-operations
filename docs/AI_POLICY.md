# AI Policy

Status: S05 website widget safe AI and S06 manager takeover gate implemented behind disabled default

S05 adds website widget AI replies only after durable inbound persistence and only when `AI_WIDGET_ENABLED=true` with server-side OpenAI config. The default remains disabled.

S06 adds manager takeover for website widget conversations. A protected manager action sets `agent_allowed_to_reply=false` for the conversation/session. Any later visitor message in that session returns `manager_review` fallback without an AI reply, and outbound AI persistence checks `agent_allowed_to_reply=true` again at send time so stale drafts cannot be saved after takeover.

Deferred AI surfaces:

- Telegram AI;
- Mastra/OpenAI workflows;
- broader tool schemas;
- eval/regression gates beyond S05 tests;
- urgent AI routing.

S05 website widget AI policy enforces:

- approved AI disclosure before normal AI conversation;
- `from X` starting-price orientation only from approved sources; S05 has no approved price source, so price questions hand off/fallback without amounts;
- no final price, final deadline, warranty, contract, discount, availability, legal, payment, or similar promises;
- refusal/handoff for inheritance, burial, legal funeral questions, and other non-monument topics;
- deterministic policy guardrails for business truth until approved tools exist;
- safe fallback on missing config, model error, empty model output, unsafe model output, or AI persistence failure;
- send-time `agent_allowed_to_reply` gate before AI message persistence.

Do not enable AI replies in staging until S05 migration, tests, and paired staging smoke are complete. Do not enable production AI without separate production approval.
