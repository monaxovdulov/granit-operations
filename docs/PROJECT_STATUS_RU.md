# granit-operations - Статус Репозитория

Обновлено: 2026-05-13T14:50:00Z

Этот репозиторий отвечает за рабочую систему бизнеса: intake API, Postgres operational state, manager backend/panel, Telegram later, AI workflows later, observability/evals.

## Текущий Статус

Активный срез: `S04 widget persistence needs_review`.

Стадия repo: `s02_s03_staging_accepted`. S01 staging/review evidence accepted. S02 manager auth через Яндекс ID, S02b React/Mantine manager UI и S03-min статусы/history прошли staging migration/rebuild/API smoke; owner browser check после Яндекс-входа принят в chat 2026-05-13. Следующий срез: S04 widget persistence без AI. Repo остается dirty и требует отдельных review/commit decisions перед любыми production decisions.

## Карта Репозиториев

| Репозиторий | За что отвечает | Текущая стадия | Что блокирует | Следующее действие |
|---|---|---|---|---|
| `granit-operations` | Public intake API, Postgres lead state, manager visibility, manager panel, AI/Telegram later, observability/evals | `s02_s03_staging_accepted` | Незакоммиченные auth/UI/API/db/package changes; production launch не одобрен | Draft and implement S04 widget persistence contract before any AI |
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
| S02 manager auth через Яндекс ID | Защитить manager JSON APIs, пускать только allowlist/roles, keep `/manager` as data-free login shell | `accepted_staging_owner_checked` | `MANAGER_AUTH_YANDEX_RU.md`, `tasks/S02_MANAGER_AUTH_YANDEX_RU.md`, `release/evidence/S02_MANAGER_AUTH_YANDEX_RU.md` |
| S02b manager UI Mantine | React/Vite/Mantine manager panel with Russian user-facing labels/errors | `accepted_staging_owner_checked` | `MANAGER_PANEL_SCOPE.md`, `tasks/S03_MANAGER_UI_MANTINE_RU.md`, `tasks/S02_S03_STAGING_SMOKE_PREP_RU.md`, `release/evidence/S03_MANAGER_UI_MANTINE_RU.md` |
| S03-min lifecycle | Минимальные статусы и history mutation перед S04 | `accepted_staging_owner_checked` | `LEAD_LIFECYCLE.md`, `tasks/S03_MIN_LIFECYCLE_RU.md`, `release/evidence/S03_MIN_LIFECYCLE_RU.md` |
| S04 widget persistence | Виджет сайта сохраняет сообщение/диалог в Postgres до любого AI | `implemented_needs_review` | `site_widget.v1`, `POST /public/intake/site-widget/messages`, manager visibility, AI disabled |
| S04-S15 | Следующие slices после manager auth/UI evidence | `planned` | Planning wiki: `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md` |

## Блокеры

| Блокер | Статус | Что делать |
|---|---|---|
| Рабочее дерево dirty | `blocked` для release approval | Review S01/S02/S03 chunks before commit/release |
| S01 real DB smoke оформлен как operations evidence | `accepted` для staging/review | Evidence accepted in `docs/release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md` |
| S02/S03 staging smoke | `accepted` | Auth/UI/status/history passed staging API smoke and owner browser check; keep evidence as staging-only |
| S04 widget persistence | `needs_review` | Review local implementation and run staging migration/smoke before live traffic |
| Production deploy | `blocked` | Требует G01-G17, backup/restore/rollback proof и explicit owner/developer sign-off |
| GitHub Issues | `deferred` | Можно добавить позже как внешнюю task board; repo-local docs остаются durable record |

## Следующее Безопасное Действие

Review S04 local implementation, apply migration `0004_s04_widget_persistence.sql` only in an approved staging deploy, then run paired smoke: widget message -> persistence -> manager visibility. Production launch remains blocked until production gates receive explicit sign-off.

## Links

- Source of truth: `source-of-truth.md`
- Repo workflow: `AGENT_WORKFLOW.md`
- Task docs: `tasks/README.md`
- ADR docs: `adr/README.md`
- Staging manager domain ADR: `adr/ADR-001-STAGING_MANAGER_DOMAIN_RU.md`
- Manager auth plan: `MANAGER_AUTH_YANDEX_RU.md`
- Manager UI evidence: `release/evidence/S03_MANAGER_UI_MANTINE_RU.md`
- S03-min lifecycle evidence: `release/evidence/S03_MIN_LIFECYCLE_RU.md`
- Evidence docs: `release/evidence/README.md`
- S01 provider evidence: `release/evidence/S01_PUBLIC_INTAKE_PROVIDER_RU.md`
- Planning boundaries: `../../granit-plan-app/ai-agent-stack-wiki/wiki/19-system-boundaries.md`
- First release gates: `../../granit-plan-app/ai-agent-stack-wiki/wiki/23-production-ready-first-release.md`
- Slice order: `../../granit-plan-app/ai-agent-stack-wiki/wiki/25-first-implementation-slices.md`
