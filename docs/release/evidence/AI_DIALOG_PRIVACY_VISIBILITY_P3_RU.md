# P3 Evidence: manager visibility, approved assets, sanitizer и span retention

Status: `passed`
Date: 2026-07-15 UTC
Implementation SHA: `56a81eb9a7e6e5540198367ee112a16fb2c1281b`
Parent: `368b96744fbb6534eda554a0af42f9d3d53b4b9c` (P2 evidence)
Branch: `codex/mastra-observability-first-slice`

## Что Закрывает P3

- Protected manager detail показывает только latest unresolved `manager_visible` quality event:
  controlled `eventType`, `reasonCode`, `severity`, terminal `runStatus` и `createdAt`.
- Manager UI локализует эти пять полей; run/event IDs, spans, prompt/response, provider payload,
  hidden reasoning и raw customer text в новый DTO не входят.
- Strict repo-owned manifest связывает точные legacy S05 и `live_v2` policy/prompt/tool/asset/
  tone/facts/disclosure/model-profile/candidate/turn-view versions. Direct startup не импортирует
  dated facts; оба production-shaped `live_v2` входа перепроверяют facts по текущей дате и не
  принимают caller-controlled backdate.
- Один centralized fail-closed sanitizer заново строит allowlisted run start/completion,
  spans/events и future export projection до storage. Run idempotency строго app-owned
  `ai-turn:<UUID>`; secret/email/phone-shaped span identifiers отклоняются.
- One-shot Postgres cleanup по умолчанию dry-run, имеет batch `1..1000`, максимум 100 batches,
  stable non-future cutoff и удаляет только истёкшие `ai_run_spans`. Runs, quality events и
  business state остаются durable.
- S10 review/eval linkage оставлен forward-only контрактом; mutations/promotion UI не добавлены.

P3 закрывает manager visibility, asset/privacy boundary и bounded span retention. Он не включает
Mastra, runtime enablement, scheduler/deploy cleanup, staging smoke или model/provider call.

## Проверки Exact Implementation Tree

Все Node/Vitest команды выполнялись последовательно с
`NODE_OPTIONS=--max-old-space-size=512`; Vitest/PostgreSQL использовали один worker.

| Check | Result | Evidence |
|---|---|---|
| `pnpm exec vitest run --maxWorkers=1 --minWorkers=1` | passed: 262; skipped: 7 | Все non-PostgreSQL tests; conditional DB cases запущены отдельно ниже. |
| `pnpm typecheck` | passed | Root/API/packages и manager TypeScript. |
| `pnpm build` | passed | Повторный typecheck и manager Vite production build. |
| focused assets/sanitizer/retention/manager API+UI | passed | Strict manifest, expiry/backdate, raw/secret/PII canaries, protected API and UI, bounded cleanup. |
| disposable PostgreSQL P2+P3 suite | passed: 13/13 | P2 atomic regression 5/5, manager selection 2/2, retention 6/6. |
| cleanup CLI dry-run/apply | passed | Canonical UTC cutoff accepted; dry-run and explicit apply returned controlled count-only JSON. |
| `git diff --check` and staged check | passed | No whitespace errors. |
| two independent cross-reviews + narrow re-reviews | passed | Memory mutation DTO, identifiers, future cutoff and both facts-backdate seams were fixed; final verdict: no P0/P1 blockers. |

## Disposable PostgreSQL Proof

Container: `postgres:16-alpine`, memory limit 192 MB, 1 CPU, no published port. Fresh migrations
`0001..0010` applied with `ON_ERROR_STOP=1`; three observability tables were present. Final suite:

```text
Test Files  3 passed (3)
Tests       13 passed (13)
```

The retention PostgreSQL case proves an expired bounded span is deleted while a non-expired span,
its run, quality event, message, conversation and lead remain. The P2 cases repeat atomic outbound
rollback, manager takeover, outbound idempotency collision and runtime/profile constraints on the
same final tree.

CLI final-tree results after the test suite had cleaned its fixture:

```json
{"ok":true,"dry_run":true,"cutoff":"2026-07-15T00:00:00.000Z","batch_size":10,"max_batches":2,"batches":1,"matched":0,"deleted":0,"has_more":false}
{"ok":true,"dry_run":false,"cutoff":"2026-07-15T00:00:00.000Z","batch_size":10,"max_batches":2,"batches":1,"matched":0,"deleted":0,"has_more":false}
```

Unit and PostgreSQL retention tests, not the empty final CLI invocation, supply the positive
deletion proof. Future cutoff is rejected before storage access. The container was stopped and
auto-removed; no P3 container remained running.

## Privacy И Manager Boundary

- The production query filters `managerVisible=true` and `resolutionStatus=open`, checks
  run/lead/conversation linkage, and deterministically selects newest `createdAt`, then ID.
- A newer resolved or manager-hidden event cannot replace the latest relevant open event.
- Unauthorized manager API access remains `401`; authorized GET and mutation responses expose the
  same exact five-field summary without generic metadata or observability IDs.
- Unknown fields are dropped before both Memory and PostgreSQL persistence; allowlisted invalid,
  secret- or PII-shaped controlled fields fail closed.
- Configured and observed provider/model truth remain separate through sanitize/store/replay.

## Zero-live-call И Rollback Proof

- `OPENAI_API_KEY` was absent for every P3 check.
- Dependency/source/route inventory found no Mastra package, Studio/workflow/trace/Codex route or
  new network/provider caller. No runtime or deployment configuration changed.
- The legacy S05 decision/golden/orchestrator and provider-boundary mocked tests passed in the full
  suite. Direct OpenAI remains the frozen manual `legacy_s05` emergency rollback, without
  `live_v2` and without automatic cross-provider retries.
- Code rollback before any deployment is revert of
  `56a81eb9a7e6e5540198367ee112a16fb2c1281b`. Retention remains dry-run unless `--apply` is
  explicit; P3 performed no production data cleanup.

## Sign-Off И Следующий Gate

G3/P3 is passed at the exact implementation SHA above. The owner explicitly authorized autonomous
continuation through G4, M1 disabled and M2 local/fake in the current task. G4 must now re-check
current official Mastra/OpenAI primary docs before exact dependency pinning. No staging config,
deploy or real `live_v2`/model call is permitted until a later explicit G6 approval of the exact
reviewed SHA.
