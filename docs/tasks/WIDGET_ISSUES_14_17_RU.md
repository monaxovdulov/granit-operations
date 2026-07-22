# Task: WIDGET-ISSUES-14-17 — Диалог, ссылки, delivery states и время

Status: ready_for_staging_rollout
Created: 2026-07-22
Repo: `granit-operations` + `business-ai-web-widget` + `landing-granit-static`
Slice: website widget staging follow-up
Owner/agent: Codex

## Цель

Реализовать issues #14–#17 по приоритетам, провести аудит #13, развернуть результат только на staging и доказать функциональную/визуальную работоспособность скриншотами.

## Scope

- app-owned dialogue loop/frustration/unsupported-context guard;
- structured safe catalog references;
- `site_widget.v2` persistence acknowledgment, durable AI jobs и history polling;
- truthful sent/accepted/typing/terminal UI;
- message timestamps и date separators;
- regression/eval/browser coverage, #13 audit и staging evidence.

## Out Of Scope

- production deploy;
- Telegram AI outbound;
- arbitrary model-generated HTML;
- merge/ready transition без отдельного запроса владельца.

## Files Touched

- `granit-operations`: dialogue control, grounded prompt/policy/renderer/verifier, v2 contracts/routes, durable worker/repository/schema/migration, tests and docs.
- `business-ai-web-widget`: async v2/history client, delivery/typing/terminal UI, safe catalog actions, time/date accessibility, release/browser coverage.
- `landing-granit-static`: immutable widget v1.1.0 runtime, preview workflow checks, exact catalog entity mapping and click-through behavior.

## Checks Run

| Command/check | Result | Notes |
|---|---|---|
| Design self-review and `git diff --check` | passed | `2b2f902` |
| `npm test` (`granit-operations`) | passed | 20 files, 171 tests |
| `npm run build` (`granit-operations`) | passed | API typecheck + manager production build |
| `npm run eval:widget-ai:dry-run` | passed | corpus v5, 45 cases |
| Widget unit/component/browser/build/package/runtime gates | passed | 85 unit/component + 26 browser tests |
| Landing static + Chromium integration smoke | passed | v2 lifecycle and exact «Арфа» target |
| `git diff --check` | passed | all three repositories |

## Evidence Links

- `docs/superpowers/specs/2026-07-22-widget-issues-14-17-design.md`
- `docs/release/evidence/WIDGET_AI_AUDIT_13_20260722_RU.md`
- GitHub issues #13–#17

## Runtime candidates

- Widget: `d21589b4e8e103180d3fa5cbf9d808e5b2ad82ad`, package v1.1.0 ZIP SHA-256 `b96831048b47672025f833893a6463ccb91a029a2d6d7eeb5fab8212c8f9b5f0`.
- Landing: `d8d01b0` before remote push.
- Operations: runtime SHA будет записан после commit и до server handoff.

## Blockers

- Локальный SSH к `devuser@giorno.aeza.network` отклонён по public key. Staging backend rollout будет передан server agent через `context-handoff` после push immutable SHA.

## Next Action

- Commit/push три candidate branch, backend-first staging rollout с backup/migration, затем preview deploy, live smoke и screenshots.
