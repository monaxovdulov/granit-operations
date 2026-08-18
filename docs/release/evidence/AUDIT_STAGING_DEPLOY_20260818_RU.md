# Audit staging deploy — 2026-08-18

Status: `deployed_for_owner_manual_check; paid_and_mutation_smoke_skipped_by_owner`

Environment: staging only. Production untouched.

## Exact deployed stack

| Component | Exact revision |
|---|---|
| Backend and manager | `granit-operations@d3ce2908faeb2905c54e635cf5b00925296eed3a` |
| Container image | `sha256:f3c65292cace9b6bc273ebc13f9a6d1eee7894ff13e24320ce1b28b16f51fa44` |
| Landing/catalog | `landing-granit-static@b990f16bb9443979d83ac32df96b56a871e341b9` |
| Widget runtime | `business-ai-web-widget@c44f99637e097a47b3c53099c95d7e8e01701ad8`, package `1.1.4` |

The previous backend was
`b72d526a1ac166afd800b79f3315ac4d3e14657f`, image
`sha256:983beca0d30bba41c7a7a7e92230e60b04b1a5b5b78b8959a44c4e6128b50815`.

## Runtime and migration change

- immutable release checkout created for the exact backend SHA;
- image build completed, including the repository-required architecture guard,
  typecheck and manager production build;
- staging migrations `0017` through `0022` applied in order to `public`;
- historical staging drift left `ai_runtime_controls` only in `grounded`;
  the accepted `0014` table and enabled `site_widget` row were therefore applied
  to `public` before considering the worker usable;
- `DATABASE_SEARCH_PATH=public,grounded` selects canonical reconciled tables
  first and preserves fallback access to historical support tables;
- obsolete Mastra runtime env entries were removed from compose;
- current direct runtime uses the code-pinned `OPENAI_MODEL=gpt-5.6-luna`;
- `AI_WIDGET_ENABLED`, `AI_WIDGET_JOB_WORKER_ENABLED`, exact preview CORS and a
  non-empty server-side `OPENAI_API_KEY` are present; secret values were not read
  or recorded.

## Read-only checks

| Check | Result |
|---|---|
| Local and public `/health` | passed |
| Container revision label | exact audit SHA |
| Manager static assets | current audit build |
| Preview-origin CORS | `204`, exact origin and `GET, POST, OPTIONS` |
| Worker logs after schema repair | no new error/failure records in observation window |
| Live landing/catalog bytes | matched `b990f16...`; workflow run `31958994563` succeeded |

## First owner POST follow-up

The first real owner message reached the public POST route, but four browser
attempts returned `503` before persistence. PostgreSQL identified the exact
failure as missing unqualified `conversation_slots`: the new canonical AI/job
tables existed in `public`, while historical conversation support tables still
existed only in `grounded`.

The runtime search path was corrected from `public` to `public,grounded` and the
same exact-SHA container was recreated. Resolution now selects public
`widget_ai_jobs`/`ai_runs` and grounded `conversation_slots`/
`conversation_requirements`; health is green and no startup/worker error was
observed after the correction. The failed message was transactionally rolled
back and was not stored, so the owner must explicitly resend it from the widget.

No visitor POST, model call, manager mutation, takeover or paid eval was run.
Those checks are intentionally left to the owner's manual staging session.

## Known catalog boundary

The deployed audit code does not retrieve the new 2026-08-16 landing catalog at
runtime. It selects the approved static 15-fact asset whose provenance is the
historical `granit-site-cms@23f2ee8...` snapshot. Therefore this deployment
proves the latest audit code is live, but it does not prove RAG alignment with
the newly rebuilt catalog. Closing that gap requires a separate reviewed catalog
snapshot/`CatalogKnowledgePort` implementation and cannot be represented as a
deployment-only result.

## Rollback

- compose backup:
  `/srv/botops/compose.yml.pre-audit-d3ce2908-20260818T203000Z`;
- previous image tag:
  `granit-staging-ops-api:rollback-b72d526-pre-audit-20260818T203000Z`;
- pre-migration database backup:
  `/srv/botops/backups/pre-audit-d3ce2908-20260818T203000Z.dump`;
- backup SHA-256:
  `a1b40b9ac6cf509bcd90811f069203f16b0e9cbbe20339e312f2614b6322725b`.

The PostgreSQL custom archive passed `pg_restore --list`. Database restoration
is required for a full rollback because the accepted forward migrations changed
the canonical AI schema.
