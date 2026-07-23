CREATE TABLE widget_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id uuid NOT NULL REFERENCES conversation_messages (id) ON DELETE CASCADE,
  inbound_public_message_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'retrying', 'replied', 'degraded', 'blocked', 'failed')
  ),
  input_payload jsonb NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  output_public_message_id uuid,
  terminal_reason text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX widget_ai_jobs_inbound_message_idx
  ON widget_ai_jobs (inbound_message_id);

CREATE UNIQUE INDEX widget_ai_jobs_inbound_public_message_idx
  ON widget_ai_jobs (inbound_public_message_id);

CREATE INDEX widget_ai_jobs_claim_idx
  ON widget_ai_jobs (status, available_at, created_at);

CREATE INDEX widget_ai_jobs_conversation_created_idx
  ON widget_ai_jobs (conversation_id, created_at);
