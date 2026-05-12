# granit-operations - Статус Репозитория

Обновлено: 2026-05-12T15:45:00Z

Этот репозиторий отвечает за рабочую систему бизнеса: intake API, Postgres operational state, manager backend/panel, Telegram later, AI workflows later, observability/evals.

## Текущий Статус

Активный срез: `S01 website form -> operations intake API -> stored lead -> manager visibility`.

Стадия repo: `review_ready`. S01 staging/review evidence accepted, live staging path rechecked, and dirty changes are split into reviewable chunks. Repo остается dirty и требует отдельных review/commit decisions перед любыми production decisions. Staging domain для будущей operations platform зафиксирован как `manager.botops.ru`, но публичный manager access пока не открыт. Следующий manager-access план: Яндекс ID login плюс operations DB allowlist/roles.

## Карта Репозиториев

| Репозиторий | За что отвечает | Текущая стадия | Что блокирует | Следующее действие |
|---|---|---|---|---|
| `granit-operations` | Public intake API, Postgres lead state, manager visibility, manager panel, AI/Telegram later, observability/evals | `review_ready` | Незакоммиченные API/db/package changes; production launch не одобрен | Review separated chunks from `docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md` |
| `granit-site-cms` | Astro public site, public forms, Payload CMS/admin later, SEO/content workflow | `review_ready` | Consumer/staging work тоже dirty; нужен paired review | Review separated chunks in the neighboring repo |
| `granit-plan-app` | Source of truth: ADRs, boundaries, release gates, S01-S15 order | `accepted` для архитектуры | Нельзя менять source-of-truth решения из этого repo | Читать planning wiki перед изменениями |

## S01 Подзадачи

| Срез | Цель | Статус | Доказательства |
|---|---|---|---|
| S01 operations provider contract/API | Опубликовать `site_form.v1`, принять форму, вернуть safe public receipt | `accepted (staging/review evidence)` | `PUBLIC_INTAKE_CONTRACT.md`, `S01_FORM_INTAKE.md`, `contracts/public-intake-contract.md`, `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` |
| S01 operations real DB smoke | Сохранить lead в real Postgres и показать его менеджеру | `accepted (staging/review evidence)` | `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`; source staging note in `../../granit-site-cms/docs/tasks/STAGING_DEPLOY_FOR_NEO.md` |
| S01 manager visibility | Менеджер видит source page/form metadata | `accepted (staging/review evidence)` | `S01_FORM_INTAKE.md`, `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`, manager endpoint docs in `README.md` |
| S01 paired smoke | Site-cms consumer работает against operations provider | `accepted (staging/review evidence)` | `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` and site staging task |
| S01 staging deploy readiness | Staging может проверять S01, но не является production approval | `accepted (staging/review evidence)` | `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` and site staging task |
| Future manager staging domain | Зафиксировать домен для защищенной operations platform | `accepted` | `adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`; домен `manager.botops.ru`, opening route deferred |
| S02 manager auth через Яндекс ID | Защитить `manager.botops.ru`, пускать только allowlist/roles, first manager onboarding через owner/Codex/admin command | `planned` | `MANAGER_AUTH_YANDEX_RU.md`, `tasks/S02_MANAGER_AUTH_YANDEX_RU.md`, `MANAGER_PANEL_SCOPE.md` |
| S02-S15 | Следующие slices после S01 evidence | `planned` | Planning wiki: `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md` |

## Блокеры

| Блокер | Статус | Что делать |
|---|---|---|
| Рабочее дерево dirty | `blocked` для release approval | Review separated chunks from `docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md` before commit/release |
| S01 real DB smoke оформлен как operations evidence | `accepted` для staging/review | Evidence accepted in `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` |
| Manager auth | `planned` | Create Yandex OAuth app, provide owner/manager email allowlist, then implement S02 before opening `manager.botops.ru` |
| Production deploy | `blocked` | Требует G01-G17, backup/restore/rollback proof и explicit owner/developer sign-off |
| GitHub Issues | `deferred` | Можно добавить позже как внешнюю task board; repo-local docs остаются durable record |

## Следующее Безопасное Действие

Review separated dirty chunks from `docs/tasks/S01_REVIEWABLE_CHUNKS_AND_CHECKS_RU.md`, then commit accepted chunks independently. For manager access, implement `docs/tasks/S02_MANAGER_AUTH_YANDEX_RU.md` before opening `manager.botops.ru`. Production launch remains blocked until production gates receive explicit sign-off.

## Links

- Source of truth: `source-of-truth.md`
- Repo workflow: `AGENT_WORKFLOW.md`
- Task docs: `tasks/README.md`
- ADR docs: `adr/README.md`
- Staging manager domain ADR: `adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`
- Manager auth plan: `MANAGER_AUTH_YANDEX_RU.md`
- Evidence docs: `release/evidence/README.md`
- S01 provider evidence: `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`
- Planning boundaries: `../../granit-plan-app/ai-agent-stack-wiki/wiki/19-system-boundaries.md`
- First release gates: `../../granit-plan-app/ai-agent-stack-wiki/wiki/23-production-ready-first-release.md`
- Slice order: `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md`
