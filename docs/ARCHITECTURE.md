# Architecture

Status: current executable map and cross-repository audit snapshot, 2026-08-07

Current behavior is established by code, contracts, migrations and tests at the
checked-out `granit-operations` SHA. Target AI decisions live in
[`source-of-truth.md`](source-of-truth.md); they are not evidence of deployment.

## Browser-to-backend path

```text
monaxovdulov/business-ai-web-widget
  Web Component source at c44f99637e097a47b3c53099c95d7e8e01701ad8
  @monaxovdulov/site-widget 1.1.4
  ↓ deterministic runtime release process

monaxovdulov/landing-granit-static
  origin/main at 65ab471f3fe106cbb78f70d7091fb6cbbdb5f9a3
  vendor/granit/site-widget/by-commit/c44f996.../
  ↓ loader.js imports sibling site-widget.esm.js
  ↓ POST acknowledgement + GET history, strict site_widget.v2

granit-operations
  main at 5098408452732e7ee7e131ded463e2cb8603f6c3
  Fastify public intake and manager API
  ↓
  PostgreSQL operational state and durable AI queue
  ↓
  direct server-side model boundary
  ↓
  app-owned validation, commit fence and send gate
  ↓
  persisted public history / manager review or takeover
```

## Provenance of the pinned widget

The public source repository is
[`monaxovdulov/business-ai-web-widget`](https://github.com/monaxovdulov/business-ai-web-widget).
Its `site-widget-v1.1.4` tag resolves to source commit
`c44f99637e097a47b3c53099c95d7e8e01701ad8`. At that commit,
`packages/site-widget/package.json` declares package
`@monaxovdulov/site-widget` version `1.1.4` and a restricted GitHub Packages
publish channel.

The source release script creates a deterministic ZIP containing exactly
`v1.1.4/{loader.js,site-widget.esm.js,manifest.json}`. The GitHub Release exists,
but had no attached assets at audit time; public GitHub delivery of the ZIP is
therefore not proven.

The current landing `origin/main` pins this path in `index.html` and
`catalog.html`:

```text
/vendor/granit/site-widget/by-commit/c44f99637e097a47b3c53099c95d7e8e01701ad8/loader.js
```

The immutable directory contains these audited bytes:

| File | SHA-256 |
|---|---|
| `loader.js` | `11e6f318f0209698cd27438a627c0238a071cab86f1e86354215eaf5db321e4e` |
| `site-widget.esm.js` | `71d0684489f5fbd85c9c219d67a8b6cb2d7ea8c89d2d6e42ca4413466c0254d9` |
| `manifest.json` | `693c09c85bcc5af60e4440a3dd02921f959b0dc3fff96adaabcbe241229555fd` |

The first two hashes equal both the manifest values and the corresponding
`dist` files at the widget source commit. The vendored directory intentionally
contains only the two runtime files and manifest. The JavaScript files retain
`sourceMappingURL` comments, while map files are not present in that directory.

The landing config points the browser to
`POST https://manager.botops.ru/public/intake/site-widget/messages`. The ESM
bundle sends `site_widget.v2`, validates the acknowledgement strictly and reads
completed state from versioned public history. This proves repository wiring;
it does not prove which backend commit is deployed at that hostname.

## Ownership

| Layer | Owner | Responsibility |
|---|---|---|
| Widget source | `business-ai-web-widget` | Web Component, browser state, rendering, accessibility and strict public-contract parsing |
| Customer landing | `landing-granit-static` | Pinned immutable runtime files and page-specific loader configuration |
| Backend | `granit-operations` | Public API, persistence, durable queue, AI runtime, validation, send gate, manager UI and takeover |
| Operational truth | PostgreSQL owned by `granit-operations` | Leads, conversations, messages, jobs, manager state and audit events |

The browser never owns backend workflow truth and receives no PostgreSQL or
model credentials. The landing is a consumer of the widget artifact, not its
source repository.

## Backend shape

```text
apps/api/          Fastify intake API, auth, runtime assembly and manager host
apps/manager/      React/Vite/Mantine manager panel
packages/contracts public intake contract artifacts
packages/db        PostgreSQL schema and ordered migrations
packages/shared    operations-local utilities
```

Route handlers are protocol adapters. Application services and repositories own
business behavior. The direct model boundary cannot bypass app-owned
persistence, validation, manager controls or the fresh send gate.

## Evidence boundary

Implemented code is not production approval. AI and Telegram remain disabled by
default. A complete current-path acceptance still needs all of the following:

1. deploy evidence that identifies the exact `granit-operations` commit;
2. a fresh paired browser smoke with the pinned landing and widget runtime;
3. persistence, manager visibility, fallback, takeover and stale-send checks;
4. owner release approval after security, privacy and rollback review.

The boundary is satisfied only when one evidence record names all three exact
repository commits and the deployed backend identity. The 2026-08-03 feature
baseline predates the current backend SHA and explicitly left the smoke pending.
