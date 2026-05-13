ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_channel_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_source_channel_check
  CHECK (source_channel IN ('site_form', 'site_widget'));

CREATE TABLE widget_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_session_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_page_url text NOT NULL,
  widget_instance_id text NOT NULL,
  referrer_url text,
  page_title text,
  utm jsonb,
  visitor_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX widget_sessions_public_session_id_idx
  ON widget_sessions (public_session_id);

CREATE INDEX widget_sessions_last_seen_idx ON widget_sessions (last_seen_at);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  widget_session_id uuid NOT NULL REFERENCES widget_sessions (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('site_widget')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open')),
  agent_allowed_to_reply boolean NOT NULL DEFAULT false,
  source_page_url text NOT NULL,
  widget_instance_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_lead_id_idx ON conversations (lead_id);
CREATE INDEX conversations_widget_session_id_idx ON conversations (widget_session_id);
CREATE INDEX conversations_channel_updated_idx ON conversations (channel, updated_at);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound')),
  sender_role text NOT NULL CHECK (sender_role IN ('visitor')),
  body text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  source_page_url text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_messages_public_message_id_idx
  ON conversation_messages (public_message_id);

CREATE UNIQUE INDEX conversation_messages_idempotency_key_idx
  ON conversation_messages (idempotency_key);

CREATE INDEX conversation_messages_conversation_created_idx
  ON conversation_messages (conversation_id, created_at);

CREATE INDEX conversation_messages_lead_created_idx
  ON conversation_messages (lead_id, created_at);
