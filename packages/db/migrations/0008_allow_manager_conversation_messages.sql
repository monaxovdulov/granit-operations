ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_sender_role_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_sender_role_check
  CHECK (sender_role IN ('visitor', 'ai_assistant', 'manager'));
