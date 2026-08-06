# Evidence: AI-DIALOG-W0-WIDGET-UX-INTEGRATION

Status: technical checks passed; preview deployed; production not approved
Date: 2026-07-14
Repo: `granit-operations` (cross-repo evidence index)
Slice: W0 parallel consumer lane
Retired task provenance: `docs/tasks/ARCHIVE_RU.md`
Contract: unchanged `site_widget.v1`

## Что Проверяли

- visitor bubble и отдельный sending status появляются до network result;
- server IDs, acceptance status, public session и assistant reply не появляются до строгого
  `accepted/replayed` receipt;
- browser timeout 25,000 ms превышает server budget 20,000 ms;
- exact source artifact vendored по full commit SHA и не зависит от старого version-only cache;
- preview workflow и remote static bytes соответствуют exact landing/source commits;
- прежний `v1.0.0` artifact остаётся доступным для ручного rollback;
- verification не делает реальный intake POST и не вызывает OpenAI/Mastra/model runtime.

## Exact Provenance

| Поле | Exact value |
|---|---|
| Source repo/commit | `business-ai-web-widget@2982de06e6f767af549e9f59aa5bf2fc042da51e` |
| Source branch / draft PR | `codex/w0-site-widget-truth-timeout` / [PR #2](https://github.com/monaxovdulov/business-ai-web-widget/pull/2) |
| Source CI | [run 29358217137](https://github.com/monaxovdulov/business-ai-web-widget/actions/runs/29358217137), `success`, job `87171195518` |
| Source baseline/design | `47481d5e6077a8d3ae9aa0d5134a1f5c2b4a530a` / `4ff894f34226ddd7ac34851a04cb7bb3519fab9b` |
| Runtime ZIP SHA-256 | `5c60ced38cc528f76df610f19e5e7681a68e944124e5f61fc7ac7209095fdc7e` |
| Loader SHA-256 | `98b71bd917c1e51ff0fefe50c01fab43a6b64463dd3f2f357410b7a84675d617` |
| ESM SHA-256 | `e44d1fafcb9b54a7496897c4cae3afba45d7254a25560e36669ad0310b83e6b8` |
| Landing integration/deployed commit | `151062cb6d19c12a25edb6a8d226bea8d96c8d83` |
| Landing evidence commit / draft PR | `128da0292c7ed26f0103ff849f01a2ed1ffa3a4a` / [PR #1](https://github.com/monaxovdulov/landing-granit-static/pull/1) |
| Landing base/manual rollback | `7007b9828b456c88c8c7b244d6b0b27cf73a3ede` |
| Deploy workflow | [run 29358660849](https://github.com/monaxovdulov/landing-granit-static/actions/runs/29358660849), `success`, job `87172752890` |
| Owning landing evidence | `.github/evidence/W0_SITE_WIDGET_PREVIEW_INTEGRATION_RU.md` at `128da029...` |

ZIP был детерминированно собран из чистого source commit и игнорируется source repo; runtime
payloads byte-for-byte совпадают с committed `dist` blobs exact source SHA. Landing хранит новые
payloads в `vendor/granit/site-widget/by-commit/2982de06.../`, а старый `v1.0.0` не изменён.

## Команды И Проверки

Все локальные Node-проверки выполнялись с `NODE_OPTIONS=--max-old-space-size=512`; browser tests
использовали один worker/process.

| Check | Result | Notes |
|---|---|---|
| source check/unit/build/package | passed | 81/81 unit tests, build и package verification на exact source commit. |
| source browser suite | passed | 24/24 Playwright tests с одним worker, включая `<=300 ms`, receipt truth и retry. |
| source GitHub CI | passed | Run `29358217137` на exact `2982de06...`. |
| landing static workflow smoke | passed | Exact manifest/key sets, independently pinned hashes, one loader, attributes, HTTP/MIME. |
| hardened local landing browser smoke | passed, 15.0 ms | Один Chromium; deferred exact receipt; loopback-only; service workers blocked; all external network aborted. |
| unsafe-origin negative check | passed | `LANDING_ORIGIN=https://manager.botops.ru` rejected before browser launch. |
| preview deploy | passed | Run `29358660849`, exact head SHA `151062cb...`. |
| deployed byte comparison | passed | Remote `index.html`, manifest, loader, ESM and rollback ESM matched local commit through `cmp`. |

## Доказательство Поведения

Пока synthetic receipt удерживался in-memory harness:

- pending visitor bubble и `Отправляем` появились через 15.0 ms;
- server public ID/acceptance metadata и public session отсутствовали;
- assistant message count не изменился;
- существовал ровно один перехваченный `site_widget.v1` POST.

После exact `accepted` receipt та же bubble стала `saved`, получила exact public ID/status, public
session сохранилась и появился ровно один exact persisted assistant reply с disclosure. Реальный
host не получил POST: API route был fulfilled browser harness, service workers заблокированы,
любой другой external request aborted.

После deploy только static GET/HEAD доказали:

| Path | HTTP / MIME | SHA-256 |
|---|---|---|
| `/index.html` | `200`, `text/html; charset=utf-8` | `45ed3875eee207e926be426ecf9d6aa0c55cf0b922d401cd881ceeee3dc8f15f` |
| immutable `manifest.json` | `200`, `application/json` | `dd565dc0a561800e23a74f2125abdd1abb326b1b0c97bae685877bcdf6ec6905` |
| immutable `loader.js` | `200`, `text/javascript; charset=utf-8` | `98b71bd917c1e51ff0fefe50c01fab43a6b64463dd3f2f357410b7a84675d617` |
| immutable `site-widget.esm.js` | `200`, `text/javascript; charset=utf-8` | `e44d1fafcb9b54a7496897c4cae3afba45d7254a25560e36669ad0310b83e6b8` |
| rollback `v1.0.0/site-widget.esm.js` | `200`, `text/javascript; charset=utf-8` | `22c57df9a8d18c0ddb552fe0cc3c5336c078648ebcb989daf169567245a05ae6` |

## Evidence Limits

- 15.0 ms — local UI render with intercepted response, not staging network/backend/model latency.
- Static preview verification does not prove intake CORS or backend availability.
- Synthetic/browser/source tests do not prove real-model semantic quality or natural tone.
- W0 does not approve production AI, Mastra packages, runtime enablement or a real model call.

## Rollback / Manual Fallback

- Set landing loader back to `/vendor/granit/site-widget/v1.0.0/loader.js` or redeploy
  `landing-granit-static@7007b9828b456c88c8c7b244d6b0b27cf73a3ede`.
- Rollback ESM SHA-256 remains
  `22c57df9a8d18c0ddb552fe0cc3c5336c078648ebcb989daf169567245a05ae6`.
- Backend/runtime/direct OpenAI rollback is unrelated and unchanged by W0.

## Remaining Gates

- P1Q G1Q subsequently passed with exact owner acceptance, production `facts.v1.ts` and rechecks;
  P2 is now the next backend slice.
- P2 -> P3 -> M1 disabled -> M2 local/fake -> G6 -> M3 remains sequential.
- M1/M2 are not started. The first real `live_v2` call remains M3 after G6, only through Mastra
  with server-only `OPENAI_API_KEY`.

## Sign-Off

- W0 source technical checks: passed.
- W0 preview integration/deploy/static checks: passed.
- Operations production or live-model approval: not granted.
