BEGIN;

DROP INDEX IF EXISTS ai_runs_inbound_public_message_id_idx;

CREATE INDEX ai_runs_inbound_public_message_id_idx
  ON ai_runs (inbound_public_message_id);

COMMIT;
