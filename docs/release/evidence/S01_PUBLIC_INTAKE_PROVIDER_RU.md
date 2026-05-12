# Evidence: S01 Public Intake Provider And Manager Visibility

Status: accepted
Date: 2026-05-12
Repo: `granit-operations`
Slice: S01
Task links:

- [Provider evidence review sign-off](../../tasks/S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md)
- [Reviewable chunks and checks](../../tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md)
- [Public intake contract](../../PUBLIC_INTAKE_CONTRACT.md)
- [S01 form intake](../../S01_FORM_INTAKE.md)
- [Provider contract detail](../../contracts/public-intake-contract.md)
- Site staging task: `../../../../granit-site-cms/docs/tasks/STAGING_DEPLOY_FOR_NEO.md`

Contract/version: `site_form.v1`

## Что Проверяли

- Operations publishes and owns the `site_form.v1` public intake contract.
- `POST /public/intake/site-form` accepts normalized public site form requests from `granit-site-cms`.
- Lead state is operations-owned and persisted before any public success response.
- Manager endpoints can show the accepted lead with source page and form metadata.
- Public responses stay safe for the website and do not expose internal IDs, traces, manager IDs, raw DB errors, or private notification destinations.
- Paired smoke confirms the provider works with the current `granit-site-cms` consumer on staging.

## Команды И Проверки

| Check | Result | Notes |
|---|---|---|
| Public contract version | Documented | `site_form.v1`, event type `site_form.submitted`. |
| Public endpoint | Implemented/documented | `POST /public/intake/site-form`. |
| API health after portable staging switch | Passed | `GET http://127.0.0.1:3101/health` returned `ok: true` for `granit-operations-api`. |
| Public form submit smoke | Passed | Representative site form POST through `https://botops.ru/public/intake/site-form` returned 202 with accepted public receipt. |
| DB persistence / manager list | Passed | Manager list showed the submitted smoke lead after public acceptance. |
| Manager detail metadata | Passed | Detail showed status `new`, source page `https://botops.ru/kontakty/`, form kind `contact`, and timeline event `lead.created_from_site_form`. |
| Validation/failure path | Passed | Invalid public intake returned 400 with validation response and did not create another manager-visible lead. |
| Safe public response privacy | Passed by contract/smoke scope | Public response uses a public submission id and safe action; internal lead IDs and private operational details are not part of the public response contract. |
| Idempotency | Passed by local tests | Focused Vitest coverage passed replay for the same idempotency key and conflict for a reused key with changed payload. |
| Paired smoke with site-cms | Passed | Site consumer, operations API, persistence, manager visibility, and failure path were checked together on `botops.ru`. |
| Live staging recheck `2026-05-12T15:15Z` | Passed | `GET http://127.0.0.1:3101/health` returned 200; valid public intake through `https://botops.ru/public/intake/site-form` returned 202; manager list/detail showed status `new`, source page `https://botops.ru/kontakty/`, form kind `contact`, and timeline event `lead.created_from_site_form`; invalid intake returned 400 and did not increase manager lead count. |
| Safe local checks `2026-05-12T15:16Z` | Passed | `npm run build`, `npm run smoke:api`, and `npm test` passed without install, deploy, DB migration execution, server config, or package/lockfile changes. |

## Доказательство Поведения

- API/provider result: staging public intake accepted a representative `site_form.v1` request from the site and returned a safe accepted receipt.
- DB persistence: the accepted request produced an operations-owned lead before public success was considered valid.
- Manager visibility: manager list/detail showed the smoke lead with source page/form metadata.
- Validation/failure path: invalid input returned a typed validation response and did not create a lead.
- Idempotency: contract and S01 provider docs require safe retry behavior and no duplicate accepted leads for the same idempotency key; the focused local Vitest suite passed replay and idempotency-conflict checks.
- Public response privacy: contract forbids internal `lead_id`, `conversation_id`, `trace_id`, manager IDs, eval labels, handoff internals, raw DB errors, and private notification destinations in public responses.
- Paired smoke with site-cms: the site staging task records the end-to-end proof against the operations provider.

## Что Не Записывать

Не добавляйте secrets, DB URLs, tokens, customer PII, raw lead data, private notification destinations, deployment credentials или полные приватные логи.

## Rollback / Manual Fallback

- Rollback path: use the staging stack rollback/stop procedure recorded in `granit-site-cms/docs/tasks/STAGING_DEPLOY_FOR_NEO.md`.
- Manual fallback: if public intake cannot confirm persistence, the site must show retry/fallback contact channels instead of success.

## Blockers / Watch Items

- This evidence is accepted only as S01 staging/review evidence, not production approval.
- Dirty API/db/package/governance changes are split in `docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md` and still need separate review/commit decisions.
- Backup/restore/rollback proof belongs to a later production release gate unless explicitly scoped.

## Sign-Off

- Owner/requester: accepted for S01 staging/review evidence by current task request.
- Developer/release owner: accepted for staging/review evidence; production approval remains blocked.
- Date: 2026-05-12
