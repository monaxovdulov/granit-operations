BEGIN;

ALTER TABLE ai_runs
  DROP CONSTRAINT ai_runs_outcome_reason_check,
  ADD CONSTRAINT ai_runs_outcome_reason_check
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
        'no_safe_answer',
        'missing_approved_fact',
        'gate_closed',
        'recorder_failure'
      )
    ),
  DROP CONSTRAINT ai_runs_terminal_evidence_check,
  ADD CONSTRAINT ai_runs_terminal_evidence_check
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
        status = 'fallback_unavailable'
        AND decision_action = 'no_reply'
        AND outcome_reason IN ('no_safe_answer', 'missing_approved_fact')
        AND failure_code IS NULL
      )
      OR (
        status IN ('blocked', 'fallback_unavailable', 'failed')
        AND decision_action IS NOT NULL
        AND outcome_reason IS NOT NULL
        AND outcome_reason NOT IN ('no_safe_answer', 'missing_approved_fact')
        AND failure_code IS NOT NULL
      )
    );

ALTER TABLE ai_quality_events
  DROP CONSTRAINT ai_quality_events_reason_code_check,
  ADD CONSTRAINT ai_quality_events_reason_code_check
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
        'no_safe_answer',
        'missing_approved_fact',
        'gate_closed',
        'send_gate_blocked',
        'tool_failed',
        'runtime_failed',
        'recorder_failed'
      )
    );

COMMIT;
