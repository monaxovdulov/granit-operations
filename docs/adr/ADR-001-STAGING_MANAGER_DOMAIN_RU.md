# ADR-001: Staging Manager Domain

Status: accepted
Date: 2026-05-12
Repo scope: cross-repo
Related slice/task: S01 evidence / future manager staging exposure

## Context

S01 staging currently exposes the public website on `botops.ru` and the public intake endpoint on `https://botops.ru/public/intake/site-form`.

Manager visibility exists for S01, but the manager API is intentionally bound to localhost on the staging server. `https://botops.ru/manager/leads` must not expose manager data publicly.

The operations platform needs a stable staging domain decision before future work adds auth/session and a public manager UI.

Owner decision after S01: protected manager login should use Yandex ID, but access is controlled by operations allowlist/roles, not by possession of any Yandex account.

## Decision

Use `manager.botops.ru` as the staging domain for the operations platform / manager UI.

Current S01 behavior does not open this domain publicly. The manager API remains local-only until a later explicitly scoped task adds:

- DNS for `manager.botops.ru`;
- reverse proxy routing;
- manager auth/session protection through Yandex ID login plus operations DB allowlist/roles;
- safe noindex behavior;
- staging smoke and owner-readable evidence.

Initial manager onboarding should be admin-controlled: owner asks Codex/admin to add a Yandex email to the allowlist. A later owner-only manager UI can add `Настройки -> Команда` for adding/disabling users and changing roles.

`botops.ru` remains the public staging website domain. `granitkr.ru` remains out of scope for staging unless the owner gives a separate explicit command.

## Consequences

- Future agents should not choose a different staging manager domain without superseding this ADR.
- Public site routes and manager routes stay separated.
- The current S01 deploy kit and evidence remain valid because manager access is still localhost-only.
- Any future public exposure of manager data requires auth and evidence before the route is opened.
- Yandex login alone is not authorization; operations must check allowlist/role before showing leads.

## Alternatives Considered

| Alternative | Why Not Selected |
|---|---|
| `ops.botops.ru` | Clear, but less owner-friendly for a manager-facing platform than `manager.botops.ru`. |
| `/manager` under `botops.ru` | Mixes public site and private manager surface on the same host; higher risk of accidental exposure. |
| Production domain under `granitkr.ru` | Not staging, and production launch is still blocked by release gates. |

## Owner Impact

The owner gets one stable staging URL to remember for the future manager platform: `manager.botops.ru`. It should not be expected to work yet; it becomes active only after a protected staging manager release is explicitly implemented and reviewed.

First usable owner flow after S02 implementation:

1. Owner or admin seeds the first `owner` email.
2. Owner opens `manager.botops.ru`.
3. Owner clicks `Войти через Яндекс`.
4. Operations validates the Yandex identity against allowlist/roles.
5. Owner can view the manager platform.

Adding a manager in the first release is done by owner request to Codex/admin. Adding managers from the UI is deferred to the owner-only `Настройки -> Команда` slice.

## Links

- Task: `docs/tasks/S01_PROVIDER_EVIDENCE_REVIEW_SIGNOFF_RU.md`
- Evidence: `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`
- Manager auth plan: `docs/MANAGER_AUTH_YANDEX_RU.md`
- Manager auth task: `docs/tasks/S02_MANAGER_AUTH_YANDEX_RU.md`
- Site staging task: `../../../granit-site-cms/docs/tasks/STAGING_DEPLOY_FOR_NEO.md`
- Source-of-truth docs: `../../../granit-plan-app/ai-agent-stack-wiki/wiki/19-system-boundaries.md`
