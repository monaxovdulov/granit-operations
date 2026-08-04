BEGIN;

ALTER TABLE widget_ai_jobs
  DROP CONSTRAINT IF EXISTS widget_ai_jobs_status_check,
  ADD COLUMN runtime_mode text NOT NULL DEFAULT 'direct_openai';

ALTER TABLE widget_ai_jobs
  ADD CONSTRAINT widget_ai_jobs_status_check CHECK (
    status IN (
      'pending',
      'processing',
      'retrying',
      'replied',
      'degraded',
      'blocked',
      'failed',
      'superseded'
    )
  ),
  ADD CONSTRAINT widget_ai_jobs_runtime_mode_check CHECK (
    runtime_mode IN ('direct_openai', 'mastra_openai_api')
  );

CREATE UNIQUE INDEX widget_ai_jobs_response_window_idx
  ON widget_ai_jobs (
    conversation_id,
    expected_generation_epoch,
    responds_through_sequence,
    runtime_mode
  );

ALTER TABLE widget_ai_jobs
  DROP COLUMN input_payload;

COMMIT;
