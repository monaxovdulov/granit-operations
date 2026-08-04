BEGIN;

-- A2 supports exactly the two repository-known histories. The lineage decision is made before
-- persistent DDL so an unknown or partially merged shape fails closed.
DO $$
DECLARE
  is_narrow boolean;
  is_broad boolean;
BEGIN
  IF to_regclass('public.ai_runs') IS NULL
     OR to_regclass('public.ai_quality_events') IS NULL THEN
    RAISE EXCEPTION '0017 unsupported AI schema: required tables are missing';
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_runs'
        AND column_name = 'inbound_public_message_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_runs'
        AND column_name IN ('trace_id', 'inbound_message_id')
    )
    AND to_regclass('public.ai_run_spans') IS NULL
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.ai_runs'::regclass
        AND conname = 'ai_runs_status_check'
        AND pg_get_constraintdef(oid) LIKE '%replied%handoff%degraded%'
    )
  INTO is_narrow;

  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_runs'
        AND column_name = 'trace_id'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_runs'
        AND column_name = 'inbound_message_id'
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_runs'
        AND column_name = 'inbound_public_message_id'
    )
    AND to_regclass('public.ai_run_spans') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.ai_runs'::regclass
        AND conname = 'ai_runs_outcome_reason_check'
        AND pg_get_constraintdef(oid) LIKE '%no_safe_answer%'
    )
  INTO is_broad;

  IF is_narrow = is_broad THEN
    RAISE EXCEPTION '0017 unsupported AI schema: unknown or hybrid lineage';
  END IF;

  PERFORM set_config(
    'granit.ai_schema_reconciliation_lineage',
    CASE WHEN is_narrow THEN 'narrow' ELSE 'broad' END,
    true
  );
END
$$;

ALTER TABLE ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_status_check;

ALTER TABLE ai_runs
  ADD COLUMN IF NOT EXISTS recording_contract text,
  ADD COLUMN IF NOT EXISTS trace_id uuid,
  ADD COLUMN IF NOT EXISTS inbound_message_id uuid,
  ADD COLUMN IF NOT EXISTS inbound_public_message_id uuid,
  ADD COLUMN IF NOT EXISTS outbound_message_id uuid,
  ADD COLUMN IF NOT EXISTS outbound_public_message_id uuid,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS runtime_mode text,
  ADD COLUMN IF NOT EXISTS runtime_run_id text,
  ADD COLUMN IF NOT EXISTS decision_profile text,
  ADD COLUMN IF NOT EXISTS decision_action text,
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS tool_version text,
  ADD COLUMN IF NOT EXISTS knowledge_version text,
  ADD COLUMN IF NOT EXISTS asset_version text,
  ADD COLUMN IF NOT EXISTS tone_version text,
  ADD COLUMN IF NOT EXISTS facts_version text,
  ADD COLUMN IF NOT EXISTS disclosure_version text,
  ADD COLUMN IF NOT EXISTS configured_model_provider text,
  ADD COLUMN IF NOT EXISTS configured_model_name text,
  ADD COLUMN IF NOT EXISTS model_name text,
  ADD COLUMN IF NOT EXISTS generator_model_name text,
  ADD COLUMN IF NOT EXISTS verifier_model_name text,
  ADD COLUMN IF NOT EXISTS verifier_version text,
  ADD COLUMN IF NOT EXISTS verifier_verdict text,
  ADD COLUMN IF NOT EXISTS catalog_version text,
  ADD COLUMN IF NOT EXISTS catalog_content_hash text,
  ADD COLUMN IF NOT EXISTS observed_model_provider text,
  ADD COLUMN IF NOT EXISTS observed_model_name text,
  ADD COLUMN IF NOT EXISTS reasoning_effort text,
  ADD COLUMN IF NOT EXISTS model_profile_version text,
  ADD COLUMN IF NOT EXISTS runtime_version text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS total_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_estimate_microunits integer,
  ADD COLUMN IF NOT EXISTS cost_rate_version text,
  ADD COLUMN IF NOT EXISTS send_gate_result text,
  ADD COLUMN IF NOT EXISTS send_gate_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_reason text,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS profile_validator_result text,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE TABLE IF NOT EXISTS ai_run_spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  span_id text NOT NULL,
  parent_span_id text,
  kind text NOT NULL,
  name text NOT NULL,
  tool_version text,
  status text NOT NULL,
  latency_ms integer,
  error_code text,
  used_in_final_answer boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT ai_run_spans_span_id_check CHECK (
    char_length(span_id) BETWEEN 1 AND 160
    AND span_id ~ '^[A-Za-z0-9._:/@+-]+$'
    AND (
      parent_span_id IS NULL
      OR (
        char_length(parent_span_id) BETWEEN 1 AND 160
        AND parent_span_id ~ '^[A-Za-z0-9._:/@+-]+$'
      )
    )
  ),
  CONSTRAINT ai_run_spans_kind_check
    CHECK (kind IN ('runtime', 'model', 'tool', 'validation', 'send_gate')),
  CONSTRAINT ai_run_spans_name_check CHECK (
    name IN (
      'turn_execution', 'decision_generation', 'candidate_validation',
      'reply_persistence', 'send_gate_check', 'runtime_execution',
      'model_generation', 'tool_execution'
    )
  ),
  CONSTRAINT ai_run_spans_tool_version_check
    CHECK (tool_version IS NULL OR char_length(tool_version) BETWEEN 1 AND 160),
  CONSTRAINT ai_run_spans_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'blocked', 'skipped')),
  CONSTRAINT ai_run_spans_latency_check CHECK (
    (status = 'running' AND latency_ms IS NULL)
    OR (status <> 'running' AND latency_ms IS NOT NULL AND latency_ms >= 0)
  ),
  CONSTRAINT ai_run_spans_error_code_check CHECK (
    error_code IS NULL OR error_code IN (
      'provider_unavailable', 'model_error', 'empty_model_response',
      'unsafe_model_response', 'validation_failed', 'send_gate_blocked',
      'persistence_failed', 'tool_failed', 'runtime_failed', 'recorder_failed'
    )
  ),
  CONSTRAINT ai_run_spans_expiry_check CHECK (expires_at > created_at)
);

DO $$
DECLARE
  invalid_count bigint;
BEGIN
  IF current_setting('granit.ai_schema_reconciliation_lineage') = 'narrow' THEN
    SELECT count(*)
    INTO invalid_count
    FROM ai_runs r
    WHERE (
      SELECT count(*)
      FROM conversation_messages m
      WHERE m.public_message_id = r.inbound_public_message_id
        AND m.lead_id = r.lead_id
        AND m.conversation_id = r.conversation_id
        AND m.direction = 'inbound'
    ) <> 1
    OR (
      r.outbound_public_message_id IS NOT NULL
      AND (
        SELECT count(*)
        FROM conversation_messages m
        WHERE m.public_message_id = r.outbound_public_message_id
          AND m.lead_id = r.lead_id
          AND m.conversation_id = r.conversation_id
          AND m.direction = 'outbound'
      ) <> 1
    );
  ELSE
    SELECT count(*)
    INTO invalid_count
    FROM ai_runs r
    WHERE NOT EXISTS (
      SELECT 1
      FROM conversation_messages m
      WHERE m.id = r.inbound_message_id
        AND m.lead_id = r.lead_id
        AND m.conversation_id = r.conversation_id
        AND m.direction = 'inbound'
    )
    OR (
      r.outbound_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM conversation_messages m
        WHERE m.id = r.outbound_message_id
          AND m.lead_id = r.lead_id
          AND m.conversation_id = r.conversation_id
          AND m.direction = 'outbound'
      )
    );
  END IF;

  IF invalid_count <> 0 THEN
    RAISE EXCEPTION '0017 cannot establish unambiguous message linkage for % ai_runs rows', invalid_count;
  END IF;
END
$$;

UPDATE ai_runs r
SET inbound_message_id = m.id
FROM conversation_messages m
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'narrow'
  AND m.public_message_id = r.inbound_public_message_id
  AND m.lead_id = r.lead_id
  AND m.conversation_id = r.conversation_id
  AND m.direction = 'inbound';

UPDATE ai_runs r
SET outbound_message_id = m.id
FROM conversation_messages m
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'narrow'
  AND r.outbound_public_message_id IS NOT NULL
  AND m.public_message_id = r.outbound_public_message_id
  AND m.lead_id = r.lead_id
  AND m.conversation_id = r.conversation_id
  AND m.direction = 'outbound';

UPDATE ai_runs r
SET inbound_public_message_id = m.public_message_id
FROM conversation_messages m
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'broad'
  AND m.id = r.inbound_message_id;

UPDATE ai_runs r
SET outbound_public_message_id = m.public_message_id
FROM conversation_messages m
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'broad'
  AND r.outbound_message_id IS NOT NULL
  AND m.id = r.outbound_message_id;

UPDATE ai_runs
SET recording_contract = 'legacy_narrow',
    channel = 'site_widget',
    runtime_mode = 'direct_openai',
    decision_profile = 'grounded_v1',
    decision_action = CASE action
      WHEN 'answer' THEN 'answer'
      WHEN 'clarify' THEN 'ask_clarifying_question'
      WHEN 'handoff' THEN 'handoff_to_manager'
      ELSE 'no_reply'
    END,
    status = CASE status
      WHEN 'replied' THEN 'persisted'
      WHEN 'handoff' THEN 'handed_off'
      ELSE 'fallback_unavailable'
    END,
    send_gate_result = CASE status
      WHEN 'replied' THEN 'allowed'
      WHEN 'handoff' THEN 'allowed'
      ELSE 'not_checked'
    END,
    send_gate_checked_at = CASE status
      WHEN 'replied' THEN created_at
      WHEN 'handoff' THEN created_at
      ELSE NULL
    END,
    outcome_reason = CASE
      WHEN status = 'replied' THEN 'reply_persisted'
      WHEN status = 'handoff' THEN 'handoff_to_manager'
      WHEN reason = 'missing_openai_config' THEN 'missing_provider_config'
      WHEN reason IN (
        'model_error', 'semantic_verifier_error', 'turn_timeout',
        'empty_model_response', 'unsafe_model_response',
        'grounding_validation_failed', 'agent_reply_blocked',
        'ai_persistence_unconfirmed', 'execution_context_mismatch',
        'candidate_invalid', 'no_safe_answer', 'missing_approved_fact', 'gate_closed'
      ) THEN reason
      ELSE NULL
    END,
    failure_code = CASE
      WHEN status IN ('replied', 'handoff') THEN NULL
      WHEN reason = 'missing_openai_config' THEN 'provider_unavailable'
      WHEN reason IN ('model_error', 'semantic_verifier_error', 'turn_timeout', 'empty_model_response')
        THEN 'model_failure'
      WHEN reason IN ('unsafe_model_response', 'grounding_validation_failed')
        THEN 'policy_violation'
      WHEN reason = 'agent_reply_blocked' THEN 'send_gate_blocked'
      WHEN reason = 'ai_persistence_unconfirmed' THEN 'persistence_failure'
      WHEN reason = 'execution_context_mismatch' THEN 'execution_context_mismatch'
      WHEN reason = 'candidate_invalid' THEN 'invalid_candidate'
      ELSE 'runtime_failure'
    END,
    profile_validator_result = CASE
      WHEN verifier_verdict = 'pass' THEN 'passed'
      WHEN verifier_verdict IS NULL THEN 'not_run'
      ELSE 'rejected'
    END,
    metadata = COALESCE(metadata, '{}'::jsonb),
    completed_at = created_at,
    updated_at = created_at
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'narrow';

UPDATE ai_runs
SET recording_contract = 'native_recorded',
    inbound_public_message_id = inbound_public_message_id,
    metadata = COALESCE(metadata, '{}'::jsonb)
WHERE current_setting('granit.ai_schema_reconciliation_lineage') = 'broad';

ALTER TABLE ai_runs
  ALTER COLUMN trace_id DROP NOT NULL,
  ALTER COLUMN trace_id DROP DEFAULT,
  ALTER COLUMN idempotency_key DROP NOT NULL,
  ALTER COLUMN policy_version DROP NOT NULL,
  ALTER COLUMN prompt_version DROP NOT NULL,
  ALTER COLUMN tool_version DROP NOT NULL,
  ALTER COLUMN disclosure_version DROP NOT NULL,
  ALTER COLUMN configured_model_provider DROP NOT NULL,
  ALTER COLUMN configured_model_name DROP NOT NULL,
  ALTER COLUMN reasoning_effort DROP NOT NULL,
  ALTER COLUMN reasoning_effort DROP DEFAULT,
  ALTER COLUMN model_profile_version DROP NOT NULL,
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN started_at DROP DEFAULT;

ALTER TABLE ai_runs
  ALTER COLUMN recording_contract SET NOT NULL,
  ALTER COLUMN inbound_message_id SET NOT NULL,
  ALTER COLUMN inbound_public_message_id SET NOT NULL,
  ALTER COLUMN channel SET NOT NULL,
  ALTER COLUMN runtime_mode SET NOT NULL,
  ALTER COLUMN decision_profile SET NOT NULL,
  ALTER COLUMN input_fingerprint SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN send_gate_result SET NOT NULL,
  ALTER COLUMN profile_validator_result SET NOT NULL,
  ALTER COLUMN metadata SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN recording_contract SET DEFAULT 'native_recorded',
  ALTER COLUMN channel SET DEFAULT 'site_widget',
  ALTER COLUMN runtime_mode SET DEFAULT 'direct_openai',
  ALTER COLUMN decision_profile SET DEFAULT 'legacy_s05',
  ALTER COLUMN status SET DEFAULT 'running',
  ALTER COLUMN send_gate_result SET DEFAULT 'not_checked',
  ALTER COLUMN profile_validator_result SET DEFAULT 'not_run',
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_runs'::regclass
      AND conname = 'ai_runs_inbound_message_id_fkey'
  ) THEN
    ALTER TABLE ai_runs
      ADD CONSTRAINT ai_runs_inbound_message_id_fkey
      FOREIGN KEY (inbound_message_id) REFERENCES conversation_messages (id)
      ON DELETE NO ACTION NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_runs'::regclass
      AND conname = 'ai_runs_outbound_message_id_fkey'
  ) THEN
    ALTER TABLE ai_runs
      ADD CONSTRAINT ai_runs_outbound_message_id_fkey
      FOREIGN KEY (outbound_message_id) REFERENCES conversation_messages (id)
      ON DELETE NO ACTION NOT VALID;
  END IF;
END
$$;

ALTER TABLE ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_channel_check,
  DROP CONSTRAINT IF EXISTS ai_runs_runtime_mode_check,
  DROP CONSTRAINT IF EXISTS ai_runs_runtime_run_id_check,
  DROP CONSTRAINT IF EXISTS ai_runs_runtime_linkage_check,
  DROP CONSTRAINT IF EXISTS ai_runs_decision_profile_check,
  DROP CONSTRAINT IF EXISTS ai_runs_runtime_profile_check,
  DROP CONSTRAINT IF EXISTS ai_runs_decision_action_check,
  DROP CONSTRAINT IF EXISTS ai_runs_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS ai_runs_input_fingerprint_check,
  DROP CONSTRAINT IF EXISTS ai_runs_status_check,
  DROP CONSTRAINT IF EXISTS ai_runs_version_fields_check,
  DROP CONSTRAINT IF EXISTS ai_runs_model_provider_check,
  DROP CONSTRAINT IF EXISTS ai_runs_configured_model_provider_check,
  DROP CONSTRAINT IF EXISTS ai_runs_observed_model_provider_check,
  DROP CONSTRAINT IF EXISTS ai_runs_model_names_check,
  DROP CONSTRAINT IF EXISTS ai_runs_model_observation_state_check,
  DROP CONSTRAINT IF EXISTS ai_runs_reasoning_effort_check,
  DROP CONSTRAINT IF EXISTS ai_runs_token_counts_check,
  DROP CONSTRAINT IF EXISTS ai_runs_cost_estimate_check,
  DROP CONSTRAINT IF EXISTS ai_runs_send_gate_result_check,
  DROP CONSTRAINT IF EXISTS ai_runs_send_gate_timestamp_check,
  DROP CONSTRAINT IF EXISTS ai_runs_outcome_reason_check,
  DROP CONSTRAINT IF EXISTS ai_runs_failure_code_check,
  DROP CONSTRAINT IF EXISTS ai_runs_profile_validator_result_check,
  DROP CONSTRAINT IF EXISTS ai_runs_timing_check,
  DROP CONSTRAINT IF EXISTS ai_runs_outbound_linkage_check,
  DROP CONSTRAINT IF EXISTS ai_runs_terminal_evidence_check,
  DROP CONSTRAINT IF EXISTS ai_runs_send_gate_state_check,
  DROP CONSTRAINT IF EXISTS ai_runs_terminal_action_check,
  DROP CONSTRAINT IF EXISTS ai_runs_verifier_verdict_check,
  DROP CONSTRAINT IF EXISTS ai_runs_catalog_content_hash_check;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_recording_contract_check
    CHECK (recording_contract IN ('native_grounded', 'native_recorded', 'legacy_narrow')) NOT VALID,
  ADD CONSTRAINT ai_runs_channel_check
    CHECK (channel = 'site_widget') NOT VALID,
  ADD CONSTRAINT ai_runs_runtime_mode_check
    CHECK (runtime_mode IN ('direct_openai', 'mastra_openai_api')) NOT VALID,
  ADD CONSTRAINT ai_runs_runtime_run_id_check CHECK (
    runtime_run_id IS NULL
    OR (char_length(runtime_run_id) BETWEEN 1 AND 200 AND runtime_run_id ~ '^[A-Za-z0-9._:/@+-]+$')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_decision_profile_check
    CHECK (decision_profile IN ('legacy_s05', 'live_v2', 'grounded_v1')) NOT VALID,
  ADD CONSTRAINT ai_runs_runtime_linkage_check
    CHECK (runtime_mode = 'mastra_openai_api' OR runtime_run_id IS NULL) NOT VALID,
  ADD CONSTRAINT ai_runs_runtime_profile_check CHECK (
    (recording_contract = 'native_recorded'
      AND ((runtime_mode = 'direct_openai' AND decision_profile = 'legacy_s05')
        OR (runtime_mode = 'mastra_openai_api' AND decision_profile = 'live_v2')))
    OR (recording_contract IN ('native_grounded', 'legacy_narrow')
      AND runtime_mode = 'direct_openai'
      AND decision_profile = 'grounded_v1')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_decision_action_check CHECK (
    decision_action IS NULL
    OR decision_action IN ('answer', 'ask_clarifying_question', 'handoff_to_manager', 'no_reply')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_idempotency_key_check CHECK (
    idempotency_key IS NULL
    OR (char_length(idempotency_key) BETWEEN 1 AND 200 AND idempotency_key ~ '^[A-Za-z0-9._:/@+-]+$')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_input_fingerprint_check CHECK (
    char_length(input_fingerprint) = 64 AND input_fingerprint ~ '^[a-f0-9]{64}$'
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_status_check CHECK (
    status IN ('running', 'persisted', 'handed_off', 'blocked', 'fallback_unavailable', 'failed')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_version_fields_check CHECK (
    (policy_version IS NULL OR (char_length(policy_version) BETWEEN 1 AND 160 AND policy_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (prompt_version IS NULL OR (char_length(prompt_version) BETWEEN 1 AND 160 AND prompt_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (tool_version IS NULL OR (char_length(tool_version) BETWEEN 1 AND 160 AND tool_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (asset_version IS NULL OR (char_length(asset_version) BETWEEN 1 AND 160 AND asset_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (tone_version IS NULL OR (char_length(tone_version) BETWEEN 1 AND 160 AND tone_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (facts_version IS NULL OR (char_length(facts_version) BETWEEN 1 AND 160 AND facts_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (disclosure_version IS NULL OR (char_length(disclosure_version) BETWEEN 1 AND 160 AND disclosure_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (model_profile_version IS NULL OR (char_length(model_profile_version) BETWEEN 1 AND 160 AND model_profile_version ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (runtime_version IS NULL OR (char_length(runtime_version) BETWEEN 1 AND 160 AND runtime_version ~ '^[A-Za-z0-9._:/@+-]+$'))
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_configured_model_provider_check CHECK (
    configured_model_provider IS NULL OR configured_model_provider IN ('none', 'openai', 'fake')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_observed_model_provider_check CHECK (
    observed_model_provider IS NULL OR observed_model_provider IN ('none', 'openai', 'policy', 'fake')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_model_names_check CHECK (
    (configured_model_name IS NULL OR (char_length(configured_model_name) BETWEEN 1 AND 120
      AND configured_model_name ~ '^[A-Za-z0-9._:/@+-]+$'))
    AND (observed_model_name IS NULL OR (char_length(observed_model_name) BETWEEN 1 AND 120
      AND observed_model_name ~ '^[A-Za-z0-9._:/@+-]+$'))
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_model_observation_state_check CHECK (
    recording_contract <> 'native_recorded'
    OR (status = 'running' AND observed_model_provider IS NULL AND observed_model_name IS NULL)
    OR (status <> 'running'
      AND observed_model_provider IS NOT NULL
      AND ((observed_model_provider = 'none' AND observed_model_name IS NULL)
        OR (observed_model_provider <> 'none' AND observed_model_name IS NOT NULL)))
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_reasoning_effort_check CHECK (
    reasoning_effort IS NULL OR reasoning_effort IN ('none', 'low', 'medium', 'high')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_token_counts_check CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_cost_estimate_check CHECK (
    (cost_estimate_microunits IS NULL AND cost_rate_version IS NULL)
    OR (cost_estimate_microunits IS NOT NULL
      AND cost_rate_version IS NOT NULL
      AND cost_estimate_microunits >= 0
      AND char_length(cost_rate_version) BETWEEN 1 AND 160
      AND cost_rate_version ~ '^[A-Za-z0-9._:/@+-]+$')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_send_gate_result_check
    CHECK (send_gate_result IN ('not_checked', 'allowed', 'blocked')) NOT VALID,
  ADD CONSTRAINT ai_runs_outcome_reason_check CHECK (
    outcome_reason IS NULL OR outcome_reason IN (
      'reply_persisted', 'handoff_to_manager', 'missing_provider_config', 'model_error',
      'semantic_verifier_error', 'turn_timeout', 'empty_model_response',
      'unsafe_model_response', 'grounding_validation_failed', 'agent_reply_blocked',
      'ai_persistence_unconfirmed', 'execution_context_mismatch', 'generator_failed',
      'candidate_invalid', 'no_safe_answer', 'missing_approved_fact', 'gate_closed',
      'recorder_failure'
    )
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'provider_unavailable', 'model_failure', 'policy_violation', 'send_gate_blocked',
      'persistence_failure', 'runtime_failure', 'recorder_failure', 'invalid_candidate',
      'execution_context_mismatch'
    )
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_profile_validator_result_check CHECK (
    profile_validator_result IS NULL
    OR profile_validator_result IN ('not_run', 'passed', 'rejected', 'failed')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_verifier_verdict_check CHECK (
    verifier_verdict IS NULL OR verifier_verdict IN ('pass', 'repair', 'handoff', 'block')
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_catalog_content_hash_check CHECK (
    catalog_content_hash IS NULL OR char_length(catalog_content_hash) = 64
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_public_internal_linkage_check CHECK (
    inbound_message_id IS NOT NULL AND inbound_public_message_id IS NOT NULL
    AND ((outbound_message_id IS NULL) = (outbound_public_message_id IS NULL))
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_send_gate_timestamp_check CHECK (
    (send_gate_result = 'not_checked' AND send_gate_checked_at IS NULL)
    OR (send_gate_result <> 'not_checked' AND send_gate_checked_at IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_outbound_linkage_check CHECK (
    (status IN ('persisted', 'handed_off')
      AND outbound_message_id IS NOT NULL
      AND outbound_public_message_id IS NOT NULL
      AND send_gate_result = 'allowed')
    OR (status NOT IN ('persisted', 'handed_off')
      AND outbound_message_id IS NULL
      AND outbound_public_message_id IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_timing_check CHECK (
    (recording_contract = 'native_recorded'
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
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_contract_evidence_check CHECK (
    (recording_contract = 'native_recorded'
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
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_terminal_evidence_check CHECK (
    (status = 'running'
      AND decision_action IS NULL
      AND outcome_reason IS NULL
      AND failure_code IS NULL)
    OR (status IN ('persisted', 'handed_off')
      AND decision_action IS NOT NULL
      AND outcome_reason IS NOT NULL
      AND failure_code IS NULL)
    OR (status = 'fallback_unavailable'
      AND decision_action = 'no_reply'
      AND outcome_reason IN ('no_safe_answer', 'missing_approved_fact')
      AND failure_code IS NULL)
    OR (status IN ('blocked', 'fallback_unavailable', 'failed')
      AND decision_action IS NOT NULL
      AND (outcome_reason IS NOT NULL
        OR (recording_contract IN ('native_grounded', 'legacy_narrow') AND reason IS NOT NULL))
      AND (outcome_reason IS NULL OR outcome_reason NOT IN ('no_safe_answer', 'missing_approved_fact'))
      AND failure_code IS NOT NULL)
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_send_gate_state_check CHECK (
    (send_gate_result = 'allowed' AND status IN ('persisted', 'handed_off'))
    OR (send_gate_result = 'blocked' AND status = 'blocked')
    OR send_gate_result = 'not_checked'
  ) NOT VALID,
  ADD CONSTRAINT ai_runs_terminal_action_check CHECK (
    status = 'running'
    OR (status = 'persisted' AND decision_action IN ('answer', 'ask_clarifying_question'))
    OR (status = 'handed_off' AND decision_action = 'handoff_to_manager')
    OR (status = 'fallback_unavailable' AND decision_action = 'no_reply')
    OR status IN ('blocked', 'failed')
  ) NOT VALID;

ALTER TABLE ai_quality_events
  DROP CONSTRAINT IF EXISTS ai_quality_events_event_type_check,
  DROP CONSTRAINT IF EXISTS ai_quality_events_reason_code_check,
  DROP CONSTRAINT IF EXISTS ai_quality_events_severity_check,
  DROP CONSTRAINT IF EXISTS ai_quality_events_resolution_status_check,
  DROP CONSTRAINT IF EXISTS ai_quality_events_resolution_code_check,
  DROP CONSTRAINT IF EXISTS ai_quality_events_resolution_check;

ALTER TABLE ai_quality_events
  ADD CONSTRAINT ai_quality_events_event_type_check CHECK (
    event_type IN (
      'handoff', 'degradation', 'blocked', 'policy_violation',
      'model_failure', 'tool_failure', 'runtime_failure'
    )
  ) NOT VALID,
  ADD CONSTRAINT ai_quality_events_reason_code_check CHECK (
    reason_code IN (
      'handoff_to_manager', 'missing_openai_config', 'model_error',
      'semantic_verifier_error', 'turn_timeout', 'empty_model_response',
      'unsafe_model_response', 'grounding_validation_failed', 'agent_reply_blocked',
      'ai_persistence_unconfirmed', 'execution_context_mismatch', 'candidate_invalid',
      'no_safe_answer', 'missing_approved_fact', 'gate_closed', 'send_gate_blocked',
      'tool_failed', 'runtime_failed', 'recorder_failed'
    )
  ) NOT VALID,
  ADD CONSTRAINT ai_quality_events_severity_check
    CHECK (severity IN ('info', 'warning', 'error', 'critical')) NOT VALID,
  ADD CONSTRAINT ai_quality_events_resolution_status_check
    CHECK (resolution_status IN ('open', 'resolved')) NOT VALID,
  ADD CONSTRAINT ai_quality_events_resolution_code_check CHECK (
    resolution_code IS NULL
    OR resolution_code IN ('manager_acknowledged', 'recovered', 'superseded', 'false_positive')
  ) NOT VALID,
  ADD CONSTRAINT ai_quality_events_resolution_check CHECK (
    (resolution_status = 'open' AND resolution_code IS NULL AND resolved_at IS NULL)
    OR (resolution_status = 'resolved' AND resolution_code IS NOT NULL AND resolved_at IS NOT NULL)
  ) NOT VALID;

DO $$
DECLARE
  duplicate_count bigint;
  orphan_count bigint;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT trace_id FROM ai_runs
      WHERE trace_id IS NOT NULL GROUP BY trace_id HAVING count(*) > 1
    UNION ALL
    SELECT inbound_public_message_id FROM ai_runs
      GROUP BY inbound_public_message_id HAVING count(*) > 1
    UNION ALL
    SELECT outbound_message_id FROM ai_runs
      WHERE outbound_message_id IS NOT NULL GROUP BY outbound_message_id HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO orphan_count
  FROM ai_runs r
  LEFT JOIN conversation_messages inbound ON inbound.id = r.inbound_message_id
  LEFT JOIN conversation_messages outbound ON outbound.id = r.outbound_message_id
  WHERE inbound.id IS NULL OR (r.outbound_message_id IS NOT NULL AND outbound.id IS NULL);

  IF duplicate_count <> 0 OR orphan_count <> 0 THEN
    RAISE EXCEPTION '0017 reconciliation canary failed: duplicates %, orphans %',
      duplicate_count, orphan_count;
  END IF;
END
$$;

DROP INDEX IF EXISTS ai_runs_conversation_created_idx;
DROP INDEX IF EXISTS ai_quality_events_lead_open_created_idx;
DROP INDEX IF EXISTS ai_quality_events_conversation_created_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_trace_id_idx ON ai_runs (trace_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_idempotency_key_idx ON ai_runs (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_inbound_public_message_id_idx
  ON ai_runs (inbound_public_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_runs_outbound_message_id_idx
  ON ai_runs (outbound_message_id) WHERE outbound_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_runs_conversation_started_idx
  ON ai_runs (conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_inbound_message_id_idx ON ai_runs (inbound_message_id);
CREATE INDEX IF NOT EXISTS ai_runs_status_started_idx ON ai_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_input_fingerprint_idx ON ai_runs (input_fingerprint);

CREATE UNIQUE INDEX IF NOT EXISTS ai_run_spans_run_span_id_idx
  ON ai_run_spans (ai_run_id, span_id);
CREATE INDEX IF NOT EXISTS ai_run_spans_run_created_idx
  ON ai_run_spans (ai_run_id, created_at);
CREATE INDEX IF NOT EXISTS ai_run_spans_expires_at_idx ON ai_run_spans (expires_at);

CREATE INDEX IF NOT EXISTS ai_quality_events_run_created_idx
  ON ai_quality_events (ai_run_id, created_at);
CREATE INDEX ai_quality_events_conversation_created_idx
  ON ai_quality_events (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_quality_events_manager_open_idx
  ON ai_quality_events (manager_visible, resolution_status, created_at DESC)
  WHERE manager_visible = true AND resolution_status = 'open';
CREATE INDEX IF NOT EXISTS ai_quality_events_lead_created_idx
  ON ai_quality_events (lead_id, created_at DESC);

ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_inbound_message_id_fkey;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_outbound_message_id_fkey;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_recording_contract_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_channel_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_runtime_mode_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_runtime_run_id_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_runtime_linkage_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_decision_profile_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_runtime_profile_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_decision_action_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_idempotency_key_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_input_fingerprint_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_status_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_version_fields_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_configured_model_provider_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_observed_model_provider_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_model_names_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_model_observation_state_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_reasoning_effort_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_token_counts_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_cost_estimate_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_send_gate_result_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_outcome_reason_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_failure_code_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_profile_validator_result_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_verifier_verdict_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_catalog_content_hash_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_public_internal_linkage_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_send_gate_timestamp_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_outbound_linkage_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_timing_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_contract_evidence_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_terminal_evidence_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_send_gate_state_check;
ALTER TABLE ai_runs VALIDATE CONSTRAINT ai_runs_terminal_action_check;

ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_event_type_check;
ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_reason_code_check;
ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_severity_check;
ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_resolution_status_check;
ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_resolution_code_check;
ALTER TABLE ai_quality_events VALIDATE CONSTRAINT ai_quality_events_resolution_check;

COMMIT;
