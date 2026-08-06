BEGIN;

DO $$
DECLARE
  ambiguous_count bigint;
BEGIN
  SELECT count(*) INTO ambiguous_count
  FROM (
    SELECT regexp_replace(idempotency_key, ':attempt:[0-9]+$', '') AS identity
    FROM ai_runs
    WHERE recording_contract = 'native_recorded'
    GROUP BY regexp_replace(idempotency_key, ':attempt:[0-9]+$', '')
    HAVING count(*) > 1
    UNION ALL
    SELECT concat_ws(':', conversation_id, inbound_message_id, runtime_mode) AS identity
    FROM ai_runs
    WHERE recording_contract = 'native_recorded'
    GROUP BY conversation_id, inbound_message_id, runtime_mode
    HAVING count(*) > 1
  ) ambiguous;

  IF ambiguous_count <> 0 THEN
    RAISE EXCEPTION
      '0022 attempt-ledger reconciliation requires an explicit duplicate-run plan: % ambiguous logical runs',
      ambiguous_count;
  END IF;
END
$$;

ALTER TABLE ai_runs
  ADD COLUMN winning_attempt_id uuid;

CREATE TABLE ai_run_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  job_id uuid REFERENCES widget_ai_jobs (id) ON DELETE SET NULL,
  job_attempt_count integer NOT NULL,
  max_attempts integer,
  idempotency_key text NOT NULL,
  trace_id uuid NOT NULL,
  input_fingerprint text NOT NULL,
  runtime_run_id text,
  policy_version text NOT NULL,
  prompt_version text NOT NULL,
  tool_version text NOT NULL,
  asset_version text,
  tone_version text,
  facts_version text,
  disclosure_version text NOT NULL,
  configured_model_provider text NOT NULL,
  configured_model_name text NOT NULL,
  observed_model_provider text,
  observed_model_name text,
  reasoning_effort text NOT NULL,
  model_profile_version text NOT NULL,
  runtime_version text,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  cost_estimate_microunits integer,
  cost_rate_version text,
  send_gate_result text NOT NULL DEFAULT 'not_checked',
  send_gate_checked_at timestamptz,
  outcome_reason text,
  failure_code text,
  profile_validator_result text NOT NULL DEFAULT 'not_run',
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_run_attempts_attempt_number_check CHECK (
    attempt_number > 0
    AND job_attempt_count > 0
    AND (max_attempts IS NULL OR max_attempts >= job_attempt_count)
  ),
  CONSTRAINT ai_run_attempts_idempotency_key_check CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 240
    AND idempotency_key ~ '^[A-Za-z0-9._:/@+-]+$'
  ),
  CONSTRAINT ai_run_attempts_input_fingerprint_check CHECK (
    char_length(input_fingerprint) = 64
    AND input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT ai_run_attempts_runtime_run_id_check CHECK (
    runtime_run_id IS NULL
    OR (
      char_length(runtime_run_id) BETWEEN 1 AND 200
      AND runtime_run_id ~ '^[A-Za-z0-9._:/@+-]+$'
    )
  ),
  CONSTRAINT ai_run_attempts_configured_model_provider_check CHECK (
    configured_model_provider IN ('none', 'openai', 'fake')
  ),
  CONSTRAINT ai_run_attempts_observed_model_provider_check CHECK (
    observed_model_provider IS NULL
    OR observed_model_provider IN ('none', 'openai', 'policy', 'fake')
  ),
  CONSTRAINT ai_run_attempts_reasoning_effort_check CHECK (
    reasoning_effort IN ('none', 'low', 'medium', 'high')
  ),
  CONSTRAINT ai_run_attempts_token_counts_check CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
  ),
  CONSTRAINT ai_run_attempts_send_gate_result_check CHECK (
    send_gate_result IN ('not_checked', 'allowed', 'blocked')
  ),
  CONSTRAINT ai_run_attempts_profile_validator_result_check CHECK (
    profile_validator_result IN ('not_run', 'passed', 'rejected', 'failed')
  ),
  CONSTRAINT ai_run_attempts_status_check CHECK (
    status IN ('running', 'succeeded', 'failed', 'fenced')
  ),
  CONSTRAINT ai_run_attempts_model_observation_check CHECK (
    (status = 'running'
      AND observed_model_provider IS NULL
      AND observed_model_name IS NULL)
    OR (status <> 'running'
      AND observed_model_provider IS NOT NULL
      AND ((observed_model_provider = 'none' AND observed_model_name IS NULL)
        OR (observed_model_provider <> 'none' AND observed_model_name IS NOT NULL)))
  ),
  CONSTRAINT ai_run_attempts_timing_check CHECK (
    (status = 'running' AND completed_at IS NULL AND latency_ms IS NULL)
    OR (status <> 'running'
      AND completed_at IS NOT NULL
      AND completed_at >= started_at
      AND latency_ms IS NOT NULL
      AND latency_ms >= 0)
  ),
  CONSTRAINT ai_run_attempts_cost_check CHECK (
    (cost_estimate_microunits IS NULL AND cost_rate_version IS NULL)
    OR (cost_estimate_microunits IS NOT NULL
      AND cost_rate_version IS NOT NULL
      AND cost_estimate_microunits >= 0
      AND char_length(cost_rate_version) BETWEEN 1 AND 160
      AND cost_rate_version ~ '^[A-Za-z0-9._:/@+-]+$')
  ),
  CONSTRAINT ai_run_attempts_send_gate_timestamp_check CHECK (
    (send_gate_result = 'not_checked' AND send_gate_checked_at IS NULL)
    OR (send_gate_result <> 'not_checked' AND send_gate_checked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX ai_run_attempts_run_number_idx
  ON ai_run_attempts (ai_run_id, attempt_number);
CREATE UNIQUE INDEX ai_run_attempts_id_run_idx
  ON ai_run_attempts (id, ai_run_id);
CREATE UNIQUE INDEX ai_run_attempts_idempotency_key_idx
  ON ai_run_attempts (idempotency_key);
CREATE UNIQUE INDEX ai_run_attempts_trace_id_idx
  ON ai_run_attempts (trace_id);
CREATE UNIQUE INDEX ai_run_attempts_single_success_idx
  ON ai_run_attempts (ai_run_id) WHERE status = 'succeeded';
CREATE INDEX ai_run_attempts_run_started_idx
  ON ai_run_attempts (ai_run_id, started_at DESC);
CREATE INDEX ai_run_attempts_job_attempt_idx
  ON ai_run_attempts (job_id, job_attempt_count);

ALTER TABLE ai_run_spans
  ADD COLUMN ai_run_attempt_id uuid,
  ADD CONSTRAINT ai_run_spans_attempt_run_fkey
    FOREIGN KEY (ai_run_attempt_id, ai_run_id)
    REFERENCES ai_run_attempts (id, ai_run_id)
    ON DELETE RESTRICT;
ALTER TABLE ai_quality_events
  ADD COLUMN ai_run_attempt_id uuid,
  ADD CONSTRAINT ai_quality_events_attempt_run_fkey
    FOREIGN KEY (ai_run_attempt_id, ai_run_id)
    REFERENCES ai_run_attempts (id, ai_run_id)
    ON DELETE RESTRICT;

CREATE INDEX ai_run_spans_attempt_created_idx
  ON ai_run_spans (ai_run_attempt_id, created_at)
  WHERE ai_run_attempt_id IS NOT NULL;
CREATE INDEX ai_quality_events_attempt_created_idx
  ON ai_quality_events (ai_run_attempt_id, created_at)
  WHERE ai_run_attempt_id IS NOT NULL;

INSERT INTO ai_run_attempts (
  ai_run_id,
  attempt_number,
  job_attempt_count,
  idempotency_key,
  trace_id,
  input_fingerprint,
  runtime_run_id,
  policy_version,
  prompt_version,
  tool_version,
  asset_version,
  tone_version,
  facts_version,
  disclosure_version,
  configured_model_provider,
  configured_model_name,
  observed_model_provider,
  observed_model_name,
  reasoning_effort,
  model_profile_version,
  runtime_version,
  input_tokens,
  output_tokens,
  total_tokens,
  cost_estimate_microunits,
  cost_rate_version,
  send_gate_result,
  send_gate_checked_at,
  outcome_reason,
  failure_code,
  profile_validator_result,
  status,
  started_at,
  completed_at,
  latency_ms,
  created_at,
  updated_at
)
SELECT
  id,
  CASE
    WHEN idempotency_key ~ ':attempt:[0-9]+$'
      THEN substring(idempotency_key FROM ':attempt:([0-9]+)$')::integer
    ELSE 1
  END,
  CASE
    WHEN idempotency_key ~ ':attempt:[0-9]+$'
      THEN substring(idempotency_key FROM ':attempt:([0-9]+)$')::integer
    ELSE 1
  END,
  idempotency_key,
  trace_id,
  input_fingerprint,
  runtime_run_id,
  policy_version,
  prompt_version,
  tool_version,
  asset_version,
  tone_version,
  facts_version,
  disclosure_version,
  configured_model_provider,
  configured_model_name,
  observed_model_provider,
  observed_model_name,
  reasoning_effort,
  model_profile_version,
  runtime_version,
  input_tokens,
  output_tokens,
  total_tokens,
  cost_estimate_microunits,
  cost_rate_version,
  send_gate_result,
  send_gate_checked_at,
  outcome_reason,
  failure_code,
  profile_validator_result,
  CASE
    WHEN status = 'running' THEN 'running'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'succeeded'
  END,
  started_at,
  completed_at,
  latency_ms,
  created_at,
  updated_at
FROM ai_runs
WHERE recording_contract = 'native_recorded';

UPDATE ai_run_spans span
SET ai_run_attempt_id = attempt.id
FROM ai_run_attempts attempt
WHERE attempt.ai_run_id = span.ai_run_id;

UPDATE ai_quality_events event
SET ai_run_attempt_id = attempt.id
FROM ai_run_attempts attempt
WHERE attempt.ai_run_id = event.ai_run_id;

ALTER TABLE ai_runs
  DROP CONSTRAINT ai_runs_recording_contract_check,
  DROP CONSTRAINT ai_runs_runtime_profile_check,
  DROP CONSTRAINT ai_runs_model_observation_state_check,
  DROP CONSTRAINT ai_runs_timing_check,
  DROP CONSTRAINT ai_runs_contract_evidence_check;

UPDATE ai_runs run
SET winning_attempt_id = CASE
      WHEN run.status NOT IN ('running', 'failed') THEN attempt.id
      ELSE NULL
    END,
    idempotency_key = regexp_replace(run.idempotency_key, ':attempt:[0-9]+$', ''),
    recording_contract = 'logical_recorded_v2'
FROM ai_run_attempts attempt
WHERE attempt.ai_run_id = run.id
  AND run.recording_contract = 'native_recorded';

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_winning_attempt_id_fkey
    FOREIGN KEY (winning_attempt_id)
    REFERENCES ai_run_attempts (id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION enforce_ai_run_winner_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.winning_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM ai_run_attempts attempt
    WHERE attempt.id = NEW.winning_attempt_id
      AND attempt.ai_run_id = NEW.id
      AND attempt.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'ai_runs.winning_attempt_id must reference a succeeded attempt of the same run';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER ai_runs_winner_ownership_trigger
AFTER INSERT OR UPDATE OF winning_attempt_id ON ai_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_ai_run_winner_ownership();

CREATE FUNCTION enforce_ai_run_attempt_winner_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.status = 'succeeded') <> EXISTS (
    SELECT 1
    FROM ai_runs run
    WHERE run.id = NEW.ai_run_id
      AND run.winning_attempt_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a succeeded ai_run_attempt must be the winner of its logical run';
  END IF;
  RETURN NEW;
END
$$;

CREATE CONSTRAINT TRIGGER ai_run_attempts_winner_state_trigger
AFTER INSERT OR UPDATE OF status, ai_run_id ON ai_run_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_ai_run_attempt_winner_state();

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_recording_contract_check CHECK (
    recording_contract IN (
      'native_grounded', 'native_recorded', 'logical_recorded_v2', 'legacy_narrow'
    )
  ),
  ADD CONSTRAINT ai_runs_runtime_profile_check CHECK (
    (recording_contract = 'native_recorded'
      AND ((runtime_mode = 'direct_openai'
          AND decision_profile IN ('legacy_s05', 'live_v2'))
        OR (runtime_mode = 'mastra_openai_api'
          AND decision_profile = 'live_v2')))
    OR (recording_contract = 'logical_recorded_v2'
      AND ((runtime_mode = 'direct_openai'
          AND decision_profile IN ('legacy_s05', 'live_v2'))
        OR (runtime_mode = 'mastra_openai_api'
          AND decision_profile = 'live_v2')))
    OR (recording_contract IN ('native_grounded', 'legacy_narrow')
      AND runtime_mode = 'direct_openai'
      AND decision_profile = 'grounded_v1')
  ),
  ADD CONSTRAINT ai_runs_model_observation_state_check CHECK (
    recording_contract NOT IN ('native_recorded', 'logical_recorded_v2')
    OR (status = 'running'
      AND observed_model_provider IS NULL
      AND observed_model_name IS NULL)
    OR (status <> 'running'
      AND observed_model_provider IS NOT NULL
      AND ((observed_model_provider = 'none' AND observed_model_name IS NULL)
        OR (observed_model_provider <> 'none' AND observed_model_name IS NOT NULL)))
  ),
  ADD CONSTRAINT ai_runs_timing_check CHECK (
    (recording_contract IN ('native_recorded', 'logical_recorded_v2')
      AND ((status = 'running' AND completed_at IS NULL AND latency_ms IS NULL)
        OR (status <> 'running'
          AND completed_at IS NOT NULL
          AND completed_at >= started_at
          AND latency_ms IS NOT NULL
          AND latency_ms >= 0)))
    OR (recording_contract IN ('native_grounded', 'legacy_narrow')
      AND status <> 'running'
      AND completed_at IS NOT NULL
      AND latency_ms IS NULL)
  ),
  ADD CONSTRAINT ai_runs_contract_evidence_check CHECK (
    (recording_contract IN ('native_recorded', 'logical_recorded_v2')
      AND trace_id IS NOT NULL
      AND idempotency_key IS NOT NULL
      AND policy_version IS NOT NULL
      AND prompt_version IS NOT NULL
      AND tool_version IS NOT NULL
      AND disclosure_version IS NOT NULL
      AND configured_model_provider IS NOT NULL
      AND configured_model_name IS NOT NULL
      AND reasoning_effort IS NOT NULL
      AND model_profile_version IS NOT NULL
      AND started_at IS NOT NULL)
    OR (recording_contract = 'native_grounded'
      AND runtime_mode = 'direct_openai'
      AND decision_profile = 'grounded_v1'
      AND idempotency_key IS NOT NULL
      AND status <> 'running'
      AND decision_action IS NOT NULL
      AND completed_at IS NOT NULL)
    OR (recording_contract = 'legacy_narrow'
      AND runtime_mode = 'direct_openai'
      AND decision_profile = 'grounded_v1'
      AND status <> 'running'
      AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT ai_runs_winning_attempt_state_check CHECK (
    (recording_contract <> 'logical_recorded_v2' AND winning_attempt_id IS NULL)
    OR (recording_contract = 'logical_recorded_v2'
      AND status = 'running'
      AND winning_attempt_id IS NULL)
    OR (recording_contract = 'logical_recorded_v2'
      AND status = 'failed'
      AND winning_attempt_id IS NULL)
    OR (recording_contract = 'logical_recorded_v2'
      AND status NOT IN ('running', 'failed')
      AND winning_attempt_id IS NOT NULL)
  );

COMMIT;
