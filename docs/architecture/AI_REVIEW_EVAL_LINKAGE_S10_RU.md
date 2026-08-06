# S10 AI review/eval linkage contract

Status: forward contract only; no S10 tables, mutation API or promotion UI in P3
Date: 2026-07-15
Repo: `granit-operations`
Authority: ADR-010, current schema/code and active AI Goal; retired plan is
indexed in `docs/tasks/ARCHIVE_RU.md`

## Назначение

Будущие review labels и eval cases должны ссылаться на durable app-owned evidence из P2/P3, не
копировать raw transcript/provider payload и не зависеть от short-lived spans.

В retired plan review loop мог называться S11. Здесь S10 означает тот же
будущий контур, а не разрешение реализовать два разных workflow.

## Обязательные ссылки

- `review_labels.ai_run_id` — `NOT NULL` FK на `ai_runs.id`.
- `review_labels.ai_quality_event_id` — nullable FK на `ai_quality_events.id`; если задан, event
  обязан принадлежать тому же `ai_run_id`.
- `eval_cases.source_review_label_id` — ссылка на прошедший отдельное review label.
- `eval_cases.source_ai_run_id` и nullable `source_ai_quality_event_id` повторяют immutable source
  linkage и проверяются на согласованность.

Span ID не является durable linkage: `ai_run_spans` удаляются после 30 дней. Retention cleanup не
должен ломать review/eval references.

## Минимальный provenance будущего eval case

- sanitizer contract/version;
- policy, prompt, tool, approved asset, tone, facts, disclosure и model-profile versions;
- decision profile/runtime mode;
- input fingerprint и controlled outcome/reason labels;
- source run/event/review IDs.

Запрещено переносить в S10 raw message bodies, full transcript, raw prompt/response, provider или
Mastra payload, exception/log objects, hidden reasoning, auth/secrets, contact data и generic tool
input/output. Подготовка model-safe eval input потребует отдельного transcript-specific sanitizer
и owner-reviewed workflow.

## P3 Boundary

P3 лишь сохраняет durable run/event IDs, central allowlist sanitizer и безопасную retention
границу. P3 не создаёт `review_labels`/`eval_cases`, не добавляет manager mutations/routes/UI,
не меняет resolution lifecycle и не продвигает production conversations в eval corpus.
