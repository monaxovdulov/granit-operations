# Evidence: PR12-MERGE-READINESS — Catalog knowledge provider

Status: needs_review
Date: 2026-07-21
Repo: `granit-operations`
Slice: PR #12 / website widget AI catalog RAG
Task link: https://github.com/monaxovdulov/granit-operations/pull/12
Behavioral candidate: `3073b9abe9873705e263d30514f94d0fbb758c06`
Contract/version: catalog schema `granit_catalog_knowledge.internal.v1`; catalog `granit-cha.catalog.2026-07-20.v1`; grounded prompt `granit_widget_ai_prompt.grounded.v6`; verifier `granit_widget_ai_verifier.v2`; grounded policy `granit_widget_ai_policy.semantic_verifier.v2`; legacy deterministic policy `granit_widget_ai_policy.consult_first.v2`

## Что Проверяли

- Versioned file catalog загружается из checked-in snapshot, возвращает только подходящие published-записи и сохраняет canonical frontend links.
- Catalog claim с `path=/frontend/url` принимается только при строгом совпадении claim text с top-level `record.frontend.url` выбранной published/active записи.
- Реальная reference на «Арфу» не подтверждает fabricated URL; pass verdict verifier не превращается в reply candidate.
- Дублированный `data.frontend.url` не заменяет отсутствующий top-level `frontend.url`.
- Смешанный legacy-запрос «расчёт + гарантия/договор» передаётся менеджеру до вызова provider.
- Manager takeover и atomic send-time gate продолжают блокировать stale AI draft.
- Telegram AI outbound остаётся заблокированным.
- Plan-render runtime и `docs/AI_POLICY.md` описывают один и тот же порядок generator/verifier/app validation/app-owned rendering/send gate.

## Команды И Проверки

Команды ниже выполнены на точном дереве файлов behavioral candidate `3073b9abe9873705e263d30514f94d0fbb758c06`.

| Check | Result | Notes |
|---|---|---|
| `npm test -- --maxWorkers=1 apps/api/test/grounded-widget-ai.test.ts apps/api/test/public-intake.test.ts` | pass | 2 files, 74/74 tests |
| `npm test -- --maxWorkers=1` | pass | 18 files, 159/159 tests |
| `npm run typecheck` | pass | API/root and manager TypeScript |
| `npm run build` | pass | typecheck plus manager Vite build; 2476 modules transformed |
| `npm run eval:widget-ai:offline` | pass | 4/4 offline eval tests |
| `npm run eval:widget-ai:dry-run` | pass | 40 cases; catalog version/hash and 465 published / 16 draft records reported |
| `git diff --check origin/main...HEAD` | pass | clean after whitespace cleanup |
| `sha256sum apps/api/src/modules/ai/catalog/snapshots/catalog-knowledge.v1.json` | pass | `de5cfe0197790e73262d14b3cf5046ec04c5128430eb98e5c1ca3e894e82d98a` |

## Доказательство Поведения

- API/provider result: exact canonical URL «Арфы» проходит validation; altered entity URL с той же real record reference создаёт `catalog_claim_value_mismatch`.
- Validation/failure path: verifier `pass` с fabricated URL заканчивается `decision=no_reply`, `reason=grounding_validation_failed`; repair state machine не расширялся.
- Canonical-source invariant: при `frontend=null` reference `/frontend/url` получает `invalid_catalog_reference`, даже если URL остался в `data.frontend.url`.
- Legacy binding terms: запрос «Нужен расчет памятника с гарантией и договором» создаёт deterministic manager handoff, `providerCalls=0`, `agentAllowedToReplyAfterSend=false`.
- DB persistence/send gate: full public-intake suite подтверждает, что inbound сохраняется первым, manager takeover блокирует последующие ответы и stale draft не проходит persistence gate.
- Telegram boundary: full suite подтверждает блокировку Telegram AI outbound до app-owned delivery path.
- Public response privacy: новые validation metadata используют controlled issue/reason codes и не добавляют raw customer data.

## Catalog Snapshot

- File: `apps/api/src/modules/ai/catalog/snapshots/catalog-knowledge.v1.json`.
- `schemaVersion`: `granit_catalog_knowledge.internal.v1`.
- `catalogVersion`: `granit-cha.catalog.2026-07-20.v1`.
- `contentHash`: `c383a4f954bb784d38df3f25819f1e659c45d52d703cf95321c33fb1ea0fa699`.
- Records: 481 total; 465 published; 16 draft; 0 retired.
- Source directory `../pdf-analiz` отсутствует в этом checkout, поэтому новый production snapshot не собирался. Проверялся committed deterministic snapshot PR #12.

## Historical Staging Proof

Исторический staging smoke уже записан в `docs/release/evidence/CATALOG_RAG_STAGING_20260720_RU.md` для operations SHA `38a3e9c4d35c7837650456169ee9ebac9846ac46`. Он подтверждает deployed runtime/catalog wiring и live-вопрос по «Арфе» на том SHA.

Behavioral candidate `3073b9abe9873705e263d30514f94d0fbb758c06` после этого historical SHA не деплоился. В рамках текущей проверки staging или production deploy не выполнялся, поэтому historical proof не считается smoke текущего head.

## Rollback / Manual Fallback

- Code rollback: revert `3073b9abe9873705e263d30514f94d0fbb758c06`.
- Runtime rollback: `AI_WIDGET_GROUNDED_MODE=off` возвращает legacy path; `AI_WIDGET_ENABLED=false` отключает website AI.
- Manager takeover и ручная обработка диалога остаются operational fallback.

## Blockers / Watch Items

- Новый staging smoke текущего head отсутствует и требует отдельного owner authority; для локальной merge-readiness он не заявлен как выполненный.
- Persistent catalog navigation, price/action resolver и issue #13 остаются отдельным scope.
- GitHub PR checks должны быть перепроверены после push финального evidence commit.

## Sign-Off

- Owner: не запрашивался; deploy/merge authority не предоставлялся.
- Developer/release owner: local verification completed by Codex; PR review pending.
- Date: 2026-07-21.
