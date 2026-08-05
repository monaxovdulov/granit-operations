BEGIN;

ALTER TABLE ai_runs
  DROP CONSTRAINT ai_runs_runtime_linkage_check,
  DROP CONSTRAINT ai_runs_runtime_profile_check;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_runtime_linkage_check CHECK (
    decision_profile = 'live_v2' OR runtime_run_id IS NULL
  ),
  ADD CONSTRAINT ai_runs_runtime_profile_check CHECK (
    (recording_contract = 'native_recorded'
      AND ((runtime_mode = 'direct_openai'
          AND decision_profile IN ('legacy_s05', 'live_v2'))
        OR (runtime_mode = 'mastra_openai_api'
          AND decision_profile = 'live_v2')))
    OR (recording_contract IN ('native_grounded', 'legacy_narrow')
      AND runtime_mode = 'direct_openai'
      AND decision_profile = 'grounded_v1')
  );

COMMIT;
