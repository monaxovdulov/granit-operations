ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_direction_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sender_role_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_sender_role_check
  CHECK (sender_role IN ('visitor', 'ai_assistant'));

CREATE INDEX IF NOT EXISTS conversation_messages_sender_role_created_idx
  ON conversation_messages (sender_role, created_at);
