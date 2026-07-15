CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  inbound_message_id uuid NOT NULL REFERENCES conversation_messages (id) ON DELETE NO ACTION,
  outbound_message_id uuid REFERENCES conversation_messages (id) ON DELETE NO ACTION,
  channel text NOT NULL,
  runtime_mode text NOT NULL,
  runtime_run_id text,
  decision_profile text NOT NULL,
  decision_action text,
  idempotency_key text NOT NULL,
  input_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'running',
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
  reasoning_effort text NOT NULL DEFAULT 'none',
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
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_runs_channel_check
    CHECK (channel IN ('site_widget')),
  CONSTRAINT ai_runs_runtime_mode_check
    CHECK (runtime_mode IN ('direct_openai', 'mastra_openai_api')),
  CONSTRAINT ai_runs_runtime_run_id_check
    CHECK (
      runtime_run_id IS NULL
      OR (
        char_length(runtime_run_id) BETWEEN 1 AND 200
        AND runtime_run_id ~ '^[A-Za-z0-9._:/@+-]+$'
      )
    ),
  CONSTRAINT ai_runs_runtime_linkage_check
    CHECK (runtime_mode = 'mastra_openai_api' OR runtime_run_id IS NULL),
  CONSTRAINT ai_runs_decision_profile_check
    CHECK (decision_profile IN ('legacy_s05', 'live_v2')),
  CONSTRAINT ai_runs_runtime_profile_check
    CHECK (
      (runtime_mode = 'direct_openai' AND decision_profile = 'legacy_s05')
      OR (runtime_mode = 'mastra_openai_api' AND decision_profile = 'live_v2')
    ),
  CONSTRAINT ai_runs_decision_action_check
    CHECK (
      decision_action IS NULL
      OR decision_action IN ('answer', 'ask_clarifying_question', 'handoff_to_manager', 'no_reply')
    ),
  CONSTRAINT ai_runs_idempotency_key_check
    CHECK (
      char_length(idempotency_key) BETWEEN 1 AND 200
      AND idempotency_key ~ '^[A-Za-z0-9._:/@+-]+$'
    ),
  CONSTRAINT ai_runs_input_fingerprint_check
    CHECK (
      char_length(input_fingerprint) = 64
      AND input_fingerprint ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT ai_runs_status_check
    CHECK (
      status IN (
        'running',
        'persisted',
        'handed_off',
        'blocked',
        'fallback_unavailable',
        'failed'
      )
    ),
  CONSTRAINT ai_runs_version_fields_check
    CHECK (
      char_length(policy_version) BETWEEN 1 AND 160
      AND policy_version ~ '^[A-Za-z0-9._:/@+-]+$'
      AND char_length(prompt_version) BETWEEN 1 AND 160
      AND prompt_version ~ '^[A-Za-z0-9._:/@+-]+$'
      AND char_length(tool_version) BETWEEN 1 AND 160
      AND tool_version ~ '^[A-Za-z0-9._:/@+-]+$'
      AND (
        asset_version IS NULL
        OR (
          char_length(asset_version) BETWEEN 1 AND 160
          AND asset_version ~ '^[A-Za-z0-9._:/@+-]+$'
        )
      )
      AND (
        tone_version IS NULL
        OR (
          char_length(tone_version) BETWEEN 1 AND 160
          AND tone_version ~ '^[A-Za-z0-9._:/@+-]+$'
        )
      )
      AND (
        facts_version IS NULL
        OR (
          char_length(facts_version) BETWEEN 1 AND 160
          AND facts_version ~ '^[A-Za-z0-9._:/@+-]+$'
        )
      )
      AND char_length(disclosure_version) BETWEEN 1 AND 160
      AND disclosure_version ~ '^[A-Za-z0-9._:/@+-]+$'
      AND char_length(model_profile_version) BETWEEN 1 AND 160
      AND model_profile_version ~ '^[A-Za-z0-9._:/@+-]+$'
      AND (
        runtime_version IS NULL
        OR (
          char_length(runtime_version) BETWEEN 1 AND 160
          AND runtime_version ~ '^[A-Za-z0-9._:/@+-]+$'
        )
      )
    ),
  CONSTRAINT ai_runs_configured_model_provider_check
    CHECK (configured_model_provider IN ('none', 'openai', 'fake')),
  CONSTRAINT ai_runs_observed_model_provider_check
    CHECK (
      observed_model_provider IS NULL
      OR observed_model_provider IN ('none', 'openai', 'policy', 'fake')
    ),
  CONSTRAINT ai_runs_model_names_check
    CHECK (
      char_length(configured_model_name) BETWEEN 1 AND 120
      AND configured_model_name ~ '^[A-Za-z0-9._:/@+-]+$'
      AND (
        observed_model_name IS NULL
        OR (
          char_length(observed_model_name) BETWEEN 1 AND 120
          AND observed_model_name ~ '^[A-Za-z0-9._:/@+-]+$'
        )
      )
    ),
  CONSTRAINT ai_runs_model_observation_state_check
    CHECK (
      (
        status = 'running'
        AND observed_model_provider IS NULL
        AND observed_model_name IS NULL
      )
      OR (
        status <> 'running'
        AND observed_model_provider IS NOT NULL
        AND (
          (observed_model_provider = 'none' AND observed_model_name IS NULL)
          OR (observed_model_provider <> 'none' AND observed_model_name IS NOT NULL)
        )
      )
    ),
  CONSTRAINT ai_runs_reasoning_effort_check
    CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high')),
  CONSTRAINT ai_runs_token_counts_check
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
      AND (total_tokens IS NULL OR total_tokens >= 0)
    ),
  CONSTRAINT ai_runs_cost_estimate_check
    CHECK (
      (cost_estimate_microunits IS NULL AND cost_rate_version IS NULL)
      OR (
        cost_estimate_microunits IS NOT NULL
        AND cost_rate_version IS NOT NULL
        AND cost_estimate_microunits >= 0
        AND char_length(cost_rate_version) BETWEEN 1 AND 160
        AND cost_rate_version ~ '^[A-Za-z0-9._:/@+-]+$'
      )
    ),
  CONSTRAINT ai_runs_send_gate_result_check
    CHECK (send_gate_result IN ('not_checked', 'allowed', 'blocked')),
  CONSTRAINT ai_runs_send_gate_timestamp_check
    CHECK (
      (send_gate_result = 'not_checked' AND send_gate_checked_at IS NULL)
      OR (send_gate_result <> 'not_checked' AND send_gate_checked_at IS NOT NULL)
    ),
  CONSTRAINT ai_runs_outcome_reason_check
    CHECK (
      outcome_reason IS NULL
      OR outcome_reason IN (
        'reply_persisted',
        'handoff_to_manager',
        'missing_provider_config',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'agent_reply_blocked',
        'ai_persistence_unconfirmed',
        'execution_context_mismatch',
        'generator_failed',
        'candidate_invalid',
        'gate_closed',
        'recorder_failure'
      )
    ),
  CONSTRAINT ai_runs_failure_code_check
    CHECK (
      failure_code IS NULL
      OR failure_code IN (
        'provider_unavailable',
        'model_failure',
        'policy_violation',
        'send_gate_blocked',
        'persistence_failure',
        'runtime_failure',
        'recorder_failure',
        'invalid_candidate',
        'execution_context_mismatch'
      )
    ),
  CONSTRAINT ai_runs_profile_validator_result_check
    CHECK (profile_validator_result IN ('not_run', 'passed', 'rejected', 'failed')),
  CONSTRAINT ai_runs_timing_check
    CHECK (
      (status = 'running' AND completed_at IS NULL AND latency_ms IS NULL)
      OR (
        status <> 'running'
        AND completed_at IS NOT NULL
        AND completed_at >= started_at
        AND latency_ms IS NOT NULL
        AND latency_ms >= 0
      )
    ),
  CONSTRAINT ai_runs_outbound_linkage_check
    CHECK (
      (
        status IN ('persisted', 'handed_off')
        AND outbound_message_id IS NOT NULL
        AND send_gate_result = 'allowed'
      )
      OR (
        status NOT IN ('persisted', 'handed_off')
        AND outbound_message_id IS NULL
      )
    ),
  CONSTRAINT ai_runs_terminal_evidence_check
    CHECK (
      (
        status = 'running'
        AND decision_action IS NULL
        AND outcome_reason IS NULL
        AND failure_code IS NULL
        AND send_gate_result = 'not_checked'
      )
      OR (
        status IN ('persisted', 'handed_off')
        AND decision_action IS NOT NULL
        AND outcome_reason IS NOT NULL
        AND failure_code IS NULL
      )
      OR (
        status IN ('blocked', 'fallback_unavailable', 'failed')
        AND decision_action IS NOT NULL
        AND outcome_reason IS NOT NULL
        AND failure_code IS NOT NULL
      )
    ),
  CONSTRAINT ai_runs_send_gate_state_check
    CHECK (
      (send_gate_result = 'allowed' AND status IN ('persisted', 'handed_off'))
      OR (send_gate_result = 'blocked' AND status = 'blocked')
      OR send_gate_result = 'not_checked'
    ),
  CONSTRAINT ai_runs_terminal_action_check
    CHECK (
      status = 'running'
      OR (
        status = 'persisted'
        AND decision_action IS NOT NULL
        AND decision_action IN ('answer', 'ask_clarifying_question')
      )
      OR (
        status = 'handed_off'
        AND decision_action IS NOT NULL
        AND decision_action = 'handoff_to_manager'
      )
      OR (
        status = 'fallback_unavailable'
        AND decision_action IS NOT NULL
        AND decision_action = 'no_reply'
      )
      OR status IN ('blocked', 'failed')
    )
);

CREATE UNIQUE INDEX ai_runs_trace_id_idx ON ai_runs (trace_id);
CREATE UNIQUE INDEX ai_runs_idempotency_key_idx ON ai_runs (idempotency_key);
CREATE UNIQUE INDEX ai_runs_outbound_message_id_idx
  ON ai_runs (outbound_message_id)
  WHERE outbound_message_id IS NOT NULL;
CREATE INDEX ai_runs_conversation_started_idx
  ON ai_runs (conversation_id, started_at DESC);
CREATE INDEX ai_runs_inbound_message_id_idx ON ai_runs (inbound_message_id);
CREATE INDEX ai_runs_status_started_idx ON ai_runs (status, started_at DESC);
CREATE INDEX ai_runs_input_fingerprint_idx ON ai_runs (input_fingerprint);

CREATE TABLE ai_run_spans (
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
  CONSTRAINT ai_run_spans_span_id_check
    CHECK (
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
  CONSTRAINT ai_run_spans_name_check
    CHECK (
      name IN (
        'turn_execution',
        'decision_generation',
        'candidate_validation',
        'reply_persistence',
        'send_gate_check',
        'runtime_execution',
        'model_generation',
        'tool_execution'
      )
    ),
  CONSTRAINT ai_run_spans_tool_version_check
    CHECK (tool_version IS NULL OR char_length(tool_version) BETWEEN 1 AND 160),
  CONSTRAINT ai_run_spans_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'blocked', 'skipped')),
  CONSTRAINT ai_run_spans_latency_check
    CHECK (
      (status = 'running' AND latency_ms IS NULL)
      OR (status <> 'running' AND latency_ms IS NOT NULL AND latency_ms >= 0)
    ),
  CONSTRAINT ai_run_spans_error_code_check
    CHECK (
      error_code IS NULL
      OR error_code IN (
        'provider_unavailable',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'validation_failed',
        'send_gate_blocked',
        'persistence_failed',
        'tool_failed',
        'runtime_failed',
        'recorder_failed'
      )
    ),
  CONSTRAINT ai_run_spans_expiry_check
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX ai_run_spans_run_span_id_idx
  ON ai_run_spans (ai_run_id, span_id);
CREATE INDEX ai_run_spans_run_created_idx
  ON ai_run_spans (ai_run_id, created_at);
CREATE INDEX ai_run_spans_expires_at_idx ON ai_run_spans (expires_at);

CREATE TABLE ai_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id uuid REFERENCES conversation_messages (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  reason_code text NOT NULL,
  severity text NOT NULL,
  manager_visible boolean NOT NULL DEFAULT true,
  resolution_status text NOT NULL DEFAULT 'open',
  resolution_code text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_quality_events_event_type_check
    CHECK (
      event_type IN (
        'handoff',
        'degradation',
        'blocked',
        'policy_violation',
        'model_failure',
        'tool_failure',
        'runtime_failure'
      )
    ),
  CONSTRAINT ai_quality_events_reason_code_check
    CHECK (
      reason_code IN (
        'handoff_to_manager',
        'missing_openai_config',
        'model_error',
        'empty_model_response',
        'unsafe_model_response',
        'agent_reply_blocked',
        'ai_persistence_unconfirmed',
        'execution_context_mismatch',
        'candidate_invalid',
        'gate_closed',
        'send_gate_blocked',
        'tool_failed',
        'runtime_failed',
        'recorder_failed'
      )
    ),
  CONSTRAINT ai_quality_events_severity_check
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT ai_quality_events_resolution_status_check
    CHECK (resolution_status IN ('open', 'resolved')),
  CONSTRAINT ai_quality_events_resolution_code_check
    CHECK (
      resolution_code IS NULL
      OR resolution_code IN ('manager_acknowledged', 'recovered', 'superseded', 'false_positive')
    ),
  CONSTRAINT ai_quality_events_resolution_check
    CHECK (
      (resolution_status = 'open' AND resolution_code IS NULL AND resolved_at IS NULL)
      OR (resolution_status = 'resolved' AND resolution_code IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX ai_quality_events_run_created_idx
  ON ai_quality_events (ai_run_id, created_at);
CREATE INDEX ai_quality_events_conversation_created_idx
  ON ai_quality_events (conversation_id, created_at DESC);
CREATE INDEX ai_quality_events_manager_open_idx
  ON ai_quality_events (manager_visible, resolution_status, created_at DESC)
  WHERE manager_visible = true AND resolution_status = 'open';
CREATE INDEX ai_quality_events_lead_created_idx
  ON ai_quality_events (lead_id, created_at DESC);
