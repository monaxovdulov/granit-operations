CREATE TABLE ai_quality_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id uuid REFERENCES conversation_messages (id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'handoff',
      'degradation',
      'blocked',
      'policy_violation',
      'model_failure',
      'runtime_failure'
    )
  ),
  reason_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  manager_visible boolean NOT NULL DEFAULT true,
  resolution_status text NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'resolved')),
  resolution_code text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_quality_events_lead_open_created_idx
  ON ai_quality_events (lead_id, manager_visible, resolution_status, created_at);

CREATE INDEX ai_quality_events_conversation_created_idx
  ON ai_quality_events (conversation_id, created_at);
