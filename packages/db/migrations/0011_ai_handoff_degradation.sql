CREATE TABLE ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  inbound_public_message_id uuid NOT NULL,
  outbound_public_message_id uuid,
  status text NOT NULL CHECK (status IN ('replied', 'handoff', 'degraded')),
  action text,
  intent text,
  input_fingerprint text NOT NULL CHECK (char_length(input_fingerprint) = 64),
  prompt_version text,
  policy_version text,
  knowledge_version text,
  model_name text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_runs_inbound_public_message_id_idx
  ON ai_runs (inbound_public_message_id);

CREATE INDEX ai_runs_conversation_created_idx
  ON ai_runs (conversation_id, created_at);

CREATE TABLE conversation_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  inbound_public_message_id uuid NOT NULL,
  outbound_public_message_id uuid NOT NULL,
  reason text NOT NULL,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 900),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  slots_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX conversation_handoffs_inbound_public_message_id_idx
  ON conversation_handoffs (inbound_public_message_id);

CREATE INDEX conversation_handoffs_conversation_status_idx
  ON conversation_handoffs (conversation_id, status);
