CREATE TABLE conversation_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN ('style', 'color', 'shape', 'accessory', 'decoration', 'site_constraint', 'other')
  ),
  mode text NOT NULL CHECK (mode IN ('preference', 'requirement', 'avoidance')),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 240),
  source text NOT NULL CHECK (source IN ('ai_extraction', 'manager')),
  source_public_message_id uuid NOT NULL,
  evidence_quote text NOT NULL,
  evidence_start integer NOT NULL CHECK (evidence_start >= 0),
  evidence_end integer NOT NULL CHECK (evidence_end > evidence_start),
  confidence_permille integer NOT NULL CHECK (confidence_permille BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_requirements_identity_idx
  ON conversation_requirements (conversation_id, category, mode, value);

CREATE INDEX conversation_requirements_lead_updated_idx
  ON conversation_requirements (lead_id, updated_at);

CREATE TABLE conversation_ai_memory (
  conversation_id uuid PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 12000),
  covered_through_public_message_id uuid NOT NULL,
  covered_through_created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_shadow_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_conversation_id uuid NOT NULL REFERENCES conversations (public_conversation_id) ON DELETE CASCADE,
  inbound_public_message_id uuid NOT NULL,
  version text NOT NULL,
  input_fingerprint text CHECK (
    input_fingerprint IS NULL OR char_length(input_fingerprint) = 64
  ),
  legacy_result jsonb NOT NULL,
  grounded_result jsonb,
  grounded_error_code text,
  legacy_latency_ms integer NOT NULL CHECK (legacy_latency_ms >= 0),
  grounded_latency_ms integer NOT NULL CHECK (grounded_latency_ms >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_shadow_comparisons_inbound_idx
  ON ai_shadow_comparisons (inbound_public_message_id);

CREATE INDEX ai_shadow_comparisons_conversation_created_idx
  ON ai_shadow_comparisons (public_conversation_id, created_at);
