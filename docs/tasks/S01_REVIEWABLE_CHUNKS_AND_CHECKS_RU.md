# Task: S01-REVIEWABLE-CHUNKS-AND-CHECKS - Split Operations Changes For Review

Status: accepted
Created: 2026-05-12
Repo: `granit-operations`
Slice: S01
Owner/agent: release agent

## Цель

Разобрать dirty working tree `granit-operations` на понятные reviewable chunks, чтобы S01 можно было ревьюить и принимать без смешивания docs, contracts, API, DB, manager и package изменений.

## Scope

- Составить список текущих changed/untracked файлов.
- Разделить изменения минимум на такие review groups:
  - docs/governance/evidence;
  - public intake contract/schema;
  - API public intake route/service;
  - Postgres migration/repository;
  - manager read endpoints/panel placeholder;
  - package/build/test tooling.
- Для каждого review group записать expected files, risk, required checks, and owner decision needed.
- Перед review прогнать applicable checks:
  - package tests for public intake;
  - API health/smoke if local runtime is available;
  - optional idempotency replay proof if required by S01 evidence review.
- Сверить paired-smoke evidence with `granit-site-cms`.

## Captured Dirty State

Captured with `git status --short --untracked-files=all` on 2026-05-12 after the S01 staging recheck. The worktree is intentionally not committed in this task.

## Reviewable Chunks

### 1. Docs / Governance / Evidence

Files:

- `README.md`
- `apps/api/README.md`
- `apps/manager/README.md`
- `docs/AGENT_WORKFLOW.md`
- `docs/PROJECT_STATUS_RU.md`
- `docs/ENVIRONMENT.md`
- `docs/MANAGER_PANEL_SCOPE.md`
- `docs/PUBLIC_INTAKE_CONTRACT.md`
- `docs/S01_FORM_INTAKE.md`
- `docs/SMOKE_TESTS.md`
- `docs/contracts/public-intake-contract.md`
- `docs/env/secrets-inventory.example.md`
- `docs/adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`
- `docs/adr/README.md`
- `docs/release/evidence/README.md`
- `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`
- `docs/release/evidence/TEMPLATE_RU.md`
- `docs/tasks/README.md`
- `docs/tasks/S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md`
- `docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md`
- `docs/tasks/TEMPLATE_RU.md`
- `packages/contracts/README.md`
- `packages/db/README.md`
- `packages/shared/README.md`

Why: durable S01 provider record, environment boundaries, manager scope, staging manager-domain ADR, and evidence acceptance.

Risk: low for runtime, medium for process accuracy if docs overstate production readiness or public manager exposure.

Required checks: link/source consistency review, evidence status review, no secrets/PII in docs, no production approval language, keep `manager.botops.ru` as reserved/deferred only.

Can review separately: yes. This is the best first review chunk.

### 2. Public Intake Contract / Schema

Files:

- `packages/contracts/schemas/public-intake.v1.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/public-intake/v1.ts`

Why: typed and JSON-schema definition of `site_form.v1` shared contract.

Risk: medium. Schema drift can break the site consumer or provider validation.

Required checks: `npm run build`, `npm run smoke:api`, `npm test`, compare with site consumed contract docs.

Can review separately: yes, but it should be paired with the site consumer contract review before acceptance.

### 3. API Public Intake Route / Service

Files:

- `apps/api/src/app.ts`
- `apps/api/src/config.ts`
- `apps/api/src/index.ts`
- `apps/api/src/routes/public-intake.ts`
- `apps/api/src/services/public-intake-service.ts`
- `apps/api/test/public-intake.test.ts`

Why: provider endpoint for `POST /public/intake/site-form`, validation, safe public responses, no false success, and test coverage.

Risk: high. Regressions can create lost leads, duplicate leads, false public success, or unsafe public responses.

Required checks: `npm run build`, `npm run smoke:api`, `npm test`, staging valid/invalid POST only when staging access is in scope.

Can review separately: yes, but it depends on contract/schema and repository behavior.

### 4. Persistence / Postgres Repository / Migration

Files:

- `apps/api/src/repositories/intake-repository.ts`
- `apps/api/src/repositories/postgres-intake-repository.ts`
- `packages/db/migrations/0001_s01_intake.sql`
- `packages/db/src/index.ts`
- `packages/db/src/schema.ts`

Why: operations-owned lead persistence, intake submission idempotency, and manager-visible state.

Risk: high. DB schema and idempotency behavior are core S01 provider state.

Required checks: SQL/repository review, `npm run build`, `npm run smoke:api`, live staging paired smoke if staging DB access is explicitly in scope. Production migration/rollback proof is deferred to production gates.

Can review separately: yes, but accept it together with API public intake behavior for S01.

### 5. Manager Visibility Surface

Files:

- `apps/api/src/routes/manager.ts`
- `apps/manager/src/placeholder.ts`

Why: manager-readable lead list/detail surface used for S01 visibility proof and future protected manager UI placeholder.

Risk: medium. Public exposure is not allowed; current evidence uses localhost-only `127.0.0.1:3101`.

Required checks: `npm run build`, `npm run smoke:api`, local `curl http://127.0.0.1:3101/manager/leads` only when staging server access is available, no public `manager.botops.ru` opening.

Can review separately: partly. Route behavior can be reviewed separately, but acceptance is tied to persistence and API intake.

### 6. Package / Build / Test Tooling

Files:

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `apps/api/package.json`
- `apps/manager/package.json`
- `packages/contracts/package.json`
- `packages/db/package.json`
- `packages/shared/package.json`
- `packages/shared/src/index.ts`

Why: npm workspace, TypeScript config, package manifests, and shared package placeholder needed to build/test S01.

Risk: medium. Tooling changes affect reproducibility and can update install graph.

Required checks: no automatic lockfile rewrite, `npm run build`, `npm run smoke:api`, `npm test`.

Can review separately: yes, preferably before code chunks that rely on these commands.

### 7. Local Agent State

Files:

- `.agents/state/granit-dev-workflow.json`

Why: local workflow state.

Risk: medium. It can be noisy, stale, or contain unintended context.

Required checks: inspect before any commit; likely exclude unless the owner explicitly wants it versioned.

Can review separately: yes. Deferred from S01 acceptance.

## Suggested Review / Commit Order

Do not commit from this list automatically. Use it as the mechanical order once the owner explicitly asks to commit.

1. `docs: accept s01 operations staging evidence`
   - Include chunk 1 docs only.
   - Purpose: lock the S01 provider evidence/status record before contract/API/DB review.
   - Acceptance check: docs contain no secrets/PII and clearly say staging/review, not production.

2. `build: add operations workspace tooling`
   - Include chunk 6 package/build/test tooling.
   - Purpose: make TypeScript and Vitest checks reproducible.
   - Acceptance check: `npm run build`, `npm run smoke:api`, `npm test`.

3. `contracts: publish site_form v1 intake contract`
   - Include chunk 2 contract/schema files.
   - Purpose: review the public provider contract separately from implementation.
   - Acceptance check: compare with `granit-site-cms` consumed contract docs, then run build/API smoke.

4. `api: implement s01 public intake`
   - Include chunk 3 API route/service/test files.
   - Purpose: review validation, safe public receipts, no false success, and idempotency behavior.
   - Acceptance check: `npm run build`, `npm run smoke:api`, `npm test`.

5. `db: persist s01 intake leads`
   - Include chunk 4 repository/migration/db files.
   - Purpose: review lead persistence, intake submissions, idempotency storage, and timeline events.
   - Acceptance check: SQL/repository review plus paired staging smoke when staging DB access is explicitly in scope.
   - Production migration/rollback proof remains a later production gate.

6. `manager: expose s01 lead visibility surface`
   - Include chunk 5 manager route/placeholder files.
   - Purpose: review local/protected manager visibility for accepted leads.
   - Acceptance check: manager list/detail smoke stays localhost/protected; do not open `manager.botops.ru` publicly in this slice.

7. Deferred / probably not committed
   - `.agents/state/granit-dev-workflow.json`
   - Include only if the owner explicitly wants this artifact versioned after inspection.

## Ready / Not Ready

Ready:

- S01 provider evidence is accepted for staging/review.
- Current staging path was rechecked successfully.
- Local TypeScript and Vitest checks passed.
- Dirty changes are split into review groups.

Not ready:

- Production launch.
- Committing all dirty files as one change.
- Public manager domain/route.
- Production DB migration execution or rollback approval.
- Including local agent state without inspection.

## Out Of Scope

- Reverting unrelated user changes.
- API/DB behavior changes unless a review blocker is found and explicitly scoped.
- Package/lockfile edits unless required by the existing S01 implementation.
- Deploy, DNS, certificate, or server changes.
- Production launch.

## Files Touched

- Expected task/update docs only while planning.
- Later review work may touch files already present in the dirty tree, but must be scoped by review group.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| `git status --short --untracked-files=all` | Captured | Dirty files are grouped above into docs, contract/schema, API intake, persistence, manager visibility, package/tooling, and local/deferred artifacts. |
| `npm run build` | Passed | Re-run on 2026-05-12; `tsc -p tsconfig.json --noEmit` exited 0. |
| `npm run smoke:api` | Passed | Re-run on 2026-05-12; `apps/api/test/public-intake.test.ts` passed 6 tests. |
| `npm test` | Passed | Re-run on 2026-05-12; Vitest passed 1 file / 6 tests. |
| API health/live smoke | Passed | `127.0.0.1:3101` was available; health returned 200; valid public intake returned 202; manager visibility passed; invalid request returned 400 and did not increase lead count. |
| Idempotency replay proof | Passed by local tests | Focused Vitest suite covers replay of same idempotency key and conflict for reused key with changed payload. |

## Evidence Links

- `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`
- `docs/PUBLIC_INTAKE_CONTRACT.md`
- `docs/S01_FORM_INTAKE.md`
- `../../granit-site-cms/docs/tasks/STAGING_DEPLOY_FOR_NEO.md`

## Blockers

- Working tree remains dirty by design; chunks above need separate review/commit decisions.
- Local agent state is deferred and should not be included in S01 acceptance without explicit owner decision.
- Production migration/backup/restore/rollback proof is deferred to production gates.
- Production approval remains blocked by release gates outside S01 evidence.

## Next Action

- Review docs/evidence first, then package/tooling and contract/schema, then API/persistence/manager chunks together with the site consumer review. Keep production launch blocked until production gates receive explicit sign-off.
