ALTER TABLE conversation_slots
  ADD COLUMN evidence_quote text,
  ADD COLUMN evidence_start integer,
  ADD COLUMN evidence_end integer;

ALTER TABLE conversation_slots
  ADD CONSTRAINT conversation_slots_evidence_offsets_check CHECK (
    (evidence_quote IS NULL AND evidence_start IS NULL AND evidence_end IS NULL)
    OR (
      evidence_quote IS NOT NULL
      AND evidence_start IS NOT NULL
      AND evidence_end IS NOT NULL
      AND evidence_start >= 0
      AND evidence_end > evidence_start
    )
  );

CREATE TABLE conversation_slot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  name text NOT NULL,
  value text NOT NULL,
  source text NOT NULL,
  source_public_message_id uuid,
  evidence_quote text,
  evidence_start integer,
  evidence_end integer,
  confidence_permille integer NOT NULL CHECK (confidence_permille BETWEEN 0 AND 1000),
  previous_value text,
  applied boolean NOT NULL,
  conflict boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_slot_events_evidence_offsets_check CHECK (
    (evidence_quote IS NULL AND evidence_start IS NULL AND evidence_end IS NULL)
    OR (
      evidence_quote IS NOT NULL
      AND evidence_start IS NOT NULL
      AND evidence_end IS NOT NULL
      AND evidence_start >= 0
      AND evidence_end > evidence_start
    )
  )
);

CREATE INDEX conversation_slot_events_conversation_created_idx
  ON conversation_slot_events (conversation_id, created_at);

CREATE INDEX conversation_slot_events_lead_created_idx
  ON conversation_slot_events (lead_id, created_at);

ALTER TABLE ai_runs
  ADD COLUMN generator_model_name text,
  ADD COLUMN verifier_model_name text,
  ADD COLUMN verifier_version text,
  ADD COLUMN verifier_verdict text,
  ADD COLUMN catalog_version text,
  ADD COLUMN catalog_content_hash text;

ALTER TABLE ai_runs
  ADD CONSTRAINT ai_runs_verifier_verdict_check CHECK (
    verifier_verdict IS NULL OR verifier_verdict IN ('pass', 'repair', 'handoff', 'block')
  ),
  ADD CONSTRAINT ai_runs_catalog_content_hash_check CHECK (
    catalog_content_hash IS NULL OR char_length(catalog_content_hash) = 64
  );

CREATE TABLE ai_review_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id uuid NOT NULL REFERENCES ai_runs (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES manager_users (id) ON DELETE SET NULL,
  label text NOT NULL CHECK (
    label IN (
      'correct',
      'unsupported_fact',
      'wrong_slot',
      'missed_handoff',
      'unnecessary_handoff',
      'poor_tone',
      'other'
    )
  ),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_review_labels_run_created_idx
  ON ai_review_labels (ai_run_id, created_at);

CREATE INDEX ai_review_labels_lead_created_idx
  ON ai_review_labels (lead_id, created_at);

CREATE TABLE ai_eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_key text NOT NULL,
  version text NOT NULL,
  category text NOT NULL,
  input jsonb NOT NULL,
  expectations jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_eval_cases_key_version_idx
  ON ai_eval_cases (case_key, version);

CREATE TABLE ai_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('offline', 'live')),
  status text NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  generator_model_name text,
  verifier_model_name text,
  catalog_version text,
  total_cases integer NOT NULL DEFAULT 0,
  passed_cases integer NOT NULL DEFAULT 0,
  failed_cases integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX ai_eval_runs_started_idx ON ai_eval_runs (started_at);
