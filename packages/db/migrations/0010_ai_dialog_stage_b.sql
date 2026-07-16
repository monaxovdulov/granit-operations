CREATE TABLE conversation_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (name IN (
    'monumentType',
    'material',
    'size',
    'city',
    'cemetery',
    'engraving',
    'installation',
    'budgetContext',
    'desiredTiming',
    'customerName',
    'phone',
    'preferredContact',
    'questionSummary'
  )),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 240),
  source text NOT NULL CHECK (source IN ('contact', 'visitor_message', 'ai_extraction', 'manager')),
  source_public_message_id uuid,
  confidence_permille integer NOT NULL CHECK (confidence_permille BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_slots_conversation_name_idx
  ON conversation_slots (conversation_id, name);

CREATE INDEX conversation_slots_lead_updated_idx
  ON conversation_slots (lead_id, updated_at);
