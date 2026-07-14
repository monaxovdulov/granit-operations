# Evidence: AI-DIALOG-P1Q-FACTS-SOURCE-AUDIT

Status: source_audit_passed; owner approval pending; no production snapshot
Date: 2026-07-14
Repo: `granit-operations`
Slice: P1Q source audit before G1Q/P2
Review table: `docs/tasks/AI_DIALOG_LIVE_V2_FACTS_P1Q_REVIEW_RU.md`

## Результат

Все 15 candidate facts повторно проверены по exact Git objects в `granit-site-cms`. Проверка
подтвердила source paths, line ranges и blob SHA, а также сузила формулировки до того, что прямо
следует из cited HTML. Это evidence качества proposal до принятия владельцем, а не owner
approval.

Proposal теперь закреплён за remote-resolvable commit
`23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a` (`origin/redesign/full-site-v1`). Локальный current
checkout `5c336109fc20549d0e618cb6834d24e0cc6b4ba0` на один commit впереди этого локально
зафиксированного remote-tracking ref и содержит consumer/deploy changes вне пяти cited imported
HTML; ни один локальный remote-tracking ref не содержит `5c336109...`. Все пять cited HTML blobs
в этих commits byte-for-byte одинаковы.

| Source path | Blob at `23f2ee8` and `5c336109` |
|---|---|
| `apps/site/src/imported-pages/index.html` | `fcae3a14c48fdb9900404ef60e9aa6d465f8071f` |
| `apps/site/src/imported-pages/vertikalnye-pamyatniki/index.html` | `995466a086ca5930d2cabbbd98865d50b884ebd9` |
| `apps/site/src/imported-pages/dvoinye-pamyatniki/index.html` | `d8a26e54cf8caaa2480c3837946fd241906302a3` |
| `apps/site/src/imported-pages/ustanovka-pamyatnikov/index.html` | `fb118d99ffcea108668783f07fbde1fab19846d5` |
| `apps/site/src/imported-pages/dostavka-i-montazh/index.html` | `332f0a285bab8e37d37407f1d14aa1eba71b6bf8` |

## Row-By-Row Audit

| Rows | Result |
|---|---|
| `P1Q-TYPE-001...004` | Source/semantics passed; `TYPE-004` tightened to the literal term «Гранитный комплекс». |
| `P1Q-TYPE-005` | Corrected: removed the unsupported category label «благоустройство» while retaining the exact item list. |
| `P1Q-TYPE-006` | Corrected: no longer transfers «гранитные» from foundations to plinths or invents a frame purpose; unified-kit inference is explicitly forbidden. |
| `P1Q-MAT-001...003` | Source/semantics passed without changes. |
| `P1Q-DECOR-001...003` | Source/semantics passed; `DECOR-003` received a literal terminology clarification. |
| `P1Q-PROC-001...003` | Source/semantics passed; `PROC-003` citation excludes the adjacent price/deadline line. |

The table contains exactly 15 unique IDs: 6 type, 3 material, 3 decor and 3 process. Every row
remains `no — pending`, starts only `after approval` and has review date `2026-10-14`. Allowed
wording contains no price, deadline, availability, payment, refund, warranty, contract, legal or
other owner-only promise.

## Проверки

Все Node-проверки выполнялись последовательно с `NODE_OPTIONS=--max-old-space-size=512`; Vitest
использовал один worker.

| Check | Result |
|---|---|
| Exact commit/ref and five blob objects | passed |
| 15 unique rows; pending/valid/review metadata | passed |
| Independent row/source review | passed after proposal corrections; no blockers |
| Focused P1Q suite | passed, 5 files / 108 tests |
| Frozen `legacy_s05` suite | passed, 3 files / 9 tests |
| Full Vitest suite | passed, 17 files / 207 tests |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `git diff --check` | passed |

## Runtime Boundary

- `TEST_LIVE_V2_FACTS` and its `ownerApproved: true` metadata remain test-only synthetic assets;
  their source commit was updated only to the remote-resolvable equivalent source.
- Production `apps/api/src/modules/ai/profiles/live-v2/facts.v1.ts` does not exist.
- No runtime/config/package/provider wiring changed.
- No OpenAI, Mastra or other model call was made.

## Remaining G1Q Gate

The owner must explicitly accept the current audited table before a production snapshot can be
created. Exact all-row acceptance phrase:

> Принимаю все 15 фактов P1Q из таблицы на source commit 23f2ee8c39ee2af30ca79cf9f2e5c4dd0229bf2a без изменений.

Until that decision, G1Q remains pending and P2 must not start.
