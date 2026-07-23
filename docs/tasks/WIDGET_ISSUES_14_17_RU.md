# Task: WIDGET-ISSUES-14-17 — Диалог, ссылки, delivery states и время

Status: completed_on_staging
Created: 2026-07-22
Completed: 2026-07-22
Repo: `granit-operations` + `business-ai-web-widget` + `landing-granit-static`
Slice: website widget staging follow-up
Owner/agent: Codex

## Цель

Реализовать issues #14–#17 по приоритетам, провести аудит #13, развернуть результат только на staging и доказать функциональную/визуальную работоспособность скриншотами.

## Scope delivered

- app-owned dialogue loop/frustration/unsupported-context guard;
- structured safe catalog references и exact-card transition;
- `site_widget.v2` persistence acknowledgment, durable AI jobs и history polling;
- truthful sent/accepted/typing/terminal UI;
- message timestamps и date separators;
- restart/idempotency/retry/lease fencing;
- regression/eval/browser coverage, #13 audit, staging rollout и screenshot evidence.

## Out of scope preserved

- production deploy не выполнялся;
- Telegram AI outbound не менялся;
- произвольный model-generated HTML не допускается;
- три PR оставлены draft, merge/ready transition не выполнялись.

## Delivered revisions

| Component | Revision | Notes |
|---|---|---|
| `granit-operations` | runtime `b72d526a1ac166afd800b79f3315ac4d3e14657f` | API, policy, contracts, queue, migration; exact staging image recorded in audit |
| `business-ai-web-widget` | `47448eb06a009c53a31903108f73361c847ac55f` | v1.1.2; ZIP SHA-256 `b3d5a1936cc03dff55722c0fd44d35c8222b446c6abb31cce15c578635044aec` |
| `landing-granit-static` | `70d21eaee5bf496ade54fa654ffe007810776b0e` | successful preview workflow `29955271280`, immutable widget runtime |

## Checks run

| Command/check | Result | Notes |
|---|---|---|
| `npm test` (`granit-operations`) | PASS | 20 files, 171 tests |
| `npm run build` (`granit-operations`) | PASS | API typecheck + manager production build |
| `npm run eval:widget-ai:dry-run` | PASS | corpus v5, 45 cases, catalog hash recorded in audit |
| Widget unit/component/browser/build/package/runtime gates | PASS | 87 unit/component + 26 browser tests |
| Landing static/manifest/entity-map smoke | PASS | 10 sections, 56 blocks, 462 verified links, 860 assets |
| Landing Chromium integration smoke | PASS | v2 lifecycle and exact «Арфа» target |
| Staging migration, health, CORS, queue/log checks | PASS | no active/stuck jobs after smoke |
| Live #14 multi-turn, idempotency, manager gate, reload | PASS | measured ack/terminal timings recorded in audit |
| Desktop/mobile screenshot review | PASS | no overflow or stuck typing/spinner |

## Rollout findings resolved

1. Staging exposed an unsafe raw-SQL `Date` binding in the lease query; it was replaced with typed Drizzle operators and redeployed.
2. A deterministic policy verdict was outside the DB enum/check constraint; persistence now uses `pass`, with regression coverage and redeploy.

## Evidence

- `docs/superpowers/specs/2026-07-22-widget-issues-14-17-design.md`
- `docs/release/evidence/WIDGET_AI_AUDIT_13_20260722_RU.md`
- `docs/release/evidence/assets/widget-issues-14-17/`
- draft PRs: operations #18, widget #4, landing #3
- GitHub issues #13–#17

## Result

Staging deploy, live functional smoke, visual review and audit are complete. Production remains untouched. The single observed `grounding_validation_failed` followed the designed safe terminal path and is retained as non-blocking quality telemetry.
