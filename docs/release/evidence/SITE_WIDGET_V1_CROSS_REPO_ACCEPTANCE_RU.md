# Evidence: G0-SITE-WIDGET-V1-CROSS-REPO-ACCEPTANCE

Status: accepted
Date: 2026-07-14
Repo: `granit-operations`
Slice: G0 / P0 acceptance-record slice
Task link: `docs/tasks/AI_DIALOG_MASTRA_OBSERVABILITY_FIRST_SLICE_RU.md`
Contract/version: `site_widget.v1`

## Решение

G0 принят. Разрешен отдельный backend slice P1 в `granit-operations`; отдельный W0 может идти
параллельно в owning widget/site repos. Эта запись не является реализацией W0/P1 и не меняет
public contract, backend/AI behavior, packages, schema, runtime, deploy или environment.

Owner acceptance получен в текущей Codex-задаче `019f60fd-d96a-7e13-95e5-7c3d26d4ac79`
2026-07-14 после предъявления границ G0 и порядка
`P1 -> P1Q -> P2 -> P3 -> M1 disabled -> M2 local/fake -> G6 -> M3 staging`. Владелец явно
ответил `разрешаю` и отдельно подтвердил продолжение по плану. Это принятие относится к точным
артефактам ниже; оно не означает review или merge draft PR `granit-plan-app#5`.

## Принятые immutable артефакты

| Роль | Точный артефакт | Проверенная связь |
|---|---|---|
| Provider contract origin | `granit-operations@b1c206995580c2022a8f3a766209bfbe1470adfc` | Ввел `site_widget.v1`, route, persistence, TypeScript/Zod и request JSON Schema. |
| Current additive response contract | `granit-operations@620438bba7964bae01b92082430374736d1119be` | Последнее изменение response states `disabled/fallback/replied`; версия осталась `site_widget.v1`. |
| Reviewed provider baseline | `granit-operations@6666a0b06c46b29ec764c3403b60153125fe125c` | Planning baseline; contract bytes совпадают с текущим staging checkout. |
| Current staging provider checkout | `granit-operations@2528e43f18b99144e28aa026d9695b5b666a9222` | `/srv/botops/releases/operations/2528e43f18b99144e28aa026d9695b5b666a9222` и image `granit-staging-ops-api:cors-2528e43`; health отвечает `ok`. |
| Provider staging evidence | `granit-operations@3ab8070184ecce021bfbf516d96fa0e2d540fe59` | Immutable S04 paired POST -> persistence -> manager evidence record. |
| Widget source package | `business-ai-web-widget@47481d5e6077a8d3ae9aa0d5134a1f5c2b4a530a` | `@monaxovdulov/site-widget` 1.0.0 runtime source recorded by its manifest; Site Widget CI passed. |
| Staging site integration | `landing-granit-static@7007b9828b456c88c8c7b244d6b0b27cf73a3ede` | Exact widget source SHA and bundle hashes vendored under `vendor/granit/site-widget/v1.0.0/`; preview deploy passed. |
| Historical site-cms S04 consumer | `granit-site-cms@83f69f33535827319d5b8489090439326ce3a3de` | Original S04 consumer implementation; supporting history, not current preview ownership. |
| Historical site-cms S04 evidence | `granit-site-cms@9ae84c0d4277a4a1eef83c60397f19d871ade495` | Original paired staging evidence record; supporting history, not current preview deploy provenance. |

Provider contract content hashes at `620438b...`, `6666a0b...` and current staging
`2528e43...` are identical:

- `packages/contracts/src/site-widget/v1.ts`:
  `7b1490a4b527c1a45ba6ec9e733a76266e7f3143dc57ccacdaa25e6990196f91`;
- `packages/contracts/schemas/site-widget.v1.json`:
  `5e61d5f786a05b606a09e73b912049ec7d26b9a1d4edd9e3d971f15e6868eeda`.

The current preview manifest pins widget source
`47481d5e6077a8d3ae9aa0d5134a1f5c2b4a530a` and these deployed files:

- `loader.js`:
  `98b71bd917c1e51ff0fefe50c01fab43a6b64463dd3f2f357410b7a84675d617`;
- `site-widget.esm.js`:
  `22c57df9a8d18c0ddb552fe0cc3c5336c078648ebcb989daf169567245a05ae6`.

Both hashes match byte-for-byte between `landing-granit-static@7007b982...` and
`https://preview.granitkr.ru/vendor/granit/site-widget/v1.0.0/` on 2026-07-14.

## Cross-repo checks

| Check | Result | Notes |
|---|---|---|
| Provider contract history and content hash | passed | Exact origin, last-change, planning and deployed SHAs inspected; contract bytes match. |
| Widget source CI | passed | GitHub Actions run `29281519476` at source SHA `47481d5...`. |
| Landing preview deploy | passed | GitHub Actions run `29281570968` deployed exact landing SHA `7007b982...`. |
| Published bundle integrity | passed | Remote loader/ESM hashes equal the pinned manifest and landing commit. |
| Current API health | passed | `https://manager.botops.ru/health` returned the operations health payload. |
| Current browser preflight | passed | `OPTIONS /public/intake/site-widget/messages` from origin `https://preview.granitkr.ru` returned `204` with exact-origin CORS, `POST, OPTIONS`, and `Content-Type, Accept`. |
| Historical paired behavior | passed as supporting evidence | S04/S05 evidence records accepted POST, persistence, manager visibility, fallback and safe public response behavior. |
| Live POST in this P0 | intentionally not run | Avoided staging DB writes and any provider/model call; P0 is an acceptance record only. |

Evidence URLs:

- provider contract baseline:
  <https://github.com/monaxovdulov/granit-operations/tree/6666a0b06c46b29ec764c3403b60153125fe125c/packages/contracts>;
- source widget commit:
  <https://github.com/monaxovdulov/business-ai-web-widget/commit/47481d5e6077a8d3ae9aa0d5134a1f5c2b4a530a>;
- source widget CI:
  <https://github.com/monaxovdulov/business-ai-web-widget/actions/runs/29281519476>;
- landing integration commit:
  <https://github.com/monaxovdulov/landing-granit-static/commit/7007b9828b456c88c8c7b244d6b0b27cf73a3ede>;
- exact preview deploy:
  <https://github.com/monaxovdulov/landing-granit-static/actions/runs/29281570968>;
- sequencing source, still an open unreviewed draft:
  <https://github.com/monaxovdulov/granit-plan-app/pull/5>.

## Evidence limits

- Old timestamp-only May `granit-site-cms` releases did not record a deploy commit manifest;
  they are supporting behavioral history, not the current immutable consumer linkage.
- The current preview linkage supersedes that gap: source-package SHA, landing SHA, CI/deploy run
  and deployed bundle hashes are all exact.
- PR `granit-plan-app#5` remains open draft with no comments/reviews. The owner acceptance source
  for G0 is the current Codex task, not PR metadata.
- `business-ai-web-widget#1` also remains an open draft without a merge/tag acceptance. Its exact
  source SHA is accepted here because that SHA built the byte-identical current preview bundle;
  this record does not claim a general package release.
- This is staging acceleration evidence, not production approval.
- G6 still requires the owner to approve the exact reviewed M2 SHA before any M3 staging config
  change or first authenticated `live_v2` call.

## Scope confirmation

P0 changes documentation only. It does not change runtime code, dependencies, lockfiles, database
schema/migrations, deploy/Caddy/DNS, staging/production config, model settings or secrets. No
OpenAI/Mastra call was made while closing G0.

## Sign-Off

- Owner: accepted in current Codex task on 2026-07-14.
- Developer/release owner: exact provider/consumer/deploy artifacts verified; G0 `GO` for P1 and
  a separate W0.
- Production: not approved.
