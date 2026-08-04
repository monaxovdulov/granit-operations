BEGIN;

ALTER TABLE conversations
  ADD COLUMN last_message_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN generation_epoch bigint NOT NULL DEFAULT 0;

ALTER TABLE conversation_messages
  ADD COLUMN message_sequence bigint;

WITH ranked_messages AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY conversation_id
      ORDER BY created_at, id
    ) AS message_sequence
  FROM conversation_messages
)
UPDATE conversation_messages AS message
SET message_sequence = ranked.message_sequence
FROM ranked_messages AS ranked
WHERE message.id = ranked.id;

UPDATE conversations AS conversation
SET last_message_sequence = sequence_state.last_message_sequence
FROM (
  SELECT conversation_id, max(message_sequence) AS last_message_sequence
  FROM conversation_messages
  GROUP BY conversation_id
) AS sequence_state
WHERE conversation.id = sequence_state.conversation_id;

ALTER TABLE conversation_messages
  ALTER COLUMN message_sequence SET NOT NULL,
  ADD CONSTRAINT conversation_messages_message_sequence_check
    CHECK (message_sequence > 0);

CREATE UNIQUE INDEX conversation_messages_conversation_sequence_idx
  ON conversation_messages (conversation_id, message_sequence);

CREATE TABLE IF NOT EXISTS widget_ai_jobs (
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

CREATE UNIQUE INDEX IF NOT EXISTS widget_ai_jobs_inbound_message_idx
  ON widget_ai_jobs (inbound_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS widget_ai_jobs_inbound_public_message_idx
  ON widget_ai_jobs (inbound_public_message_id);
CREATE INDEX IF NOT EXISTS widget_ai_jobs_claim_idx
  ON widget_ai_jobs (status, available_at, created_at);
CREATE INDEX IF NOT EXISTS widget_ai_jobs_conversation_created_idx
  ON widget_ai_jobs (conversation_id, created_at);

ALTER TABLE widget_ai_jobs
  ADD COLUMN expected_generation_epoch bigint,
  ADD COLUMN responds_through_sequence bigint;

UPDATE widget_ai_jobs AS job
SET
  expected_generation_epoch = conversation.generation_epoch,
  responds_through_sequence = inbound.message_sequence
FROM conversations AS conversation,
     conversation_messages AS inbound
WHERE conversation.id = job.conversation_id
  AND inbound.id = job.inbound_message_id
  AND inbound.conversation_id = job.conversation_id
  AND inbound.direction = 'inbound';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM widget_ai_jobs
    WHERE expected_generation_epoch IS NULL
       OR responds_through_sequence IS NULL
  ) THEN
    RAISE EXCEPTION '0018 cannot backfill widget AI turn identity';
  END IF;
END
$$;

ALTER TABLE widget_ai_jobs
  ALTER COLUMN expected_generation_epoch SET NOT NULL,
  ALTER COLUMN responds_through_sequence SET NOT NULL,
  ADD CONSTRAINT widget_ai_jobs_expected_generation_epoch_check
    CHECK (expected_generation_epoch >= 0),
  ADD CONSTRAINT widget_ai_jobs_responds_through_sequence_check
    CHECK (responds_through_sequence > 0);

COMMIT;
