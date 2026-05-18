CREATE TABLE IF NOT EXISTS channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads (id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('site_widget', 'telegram')),
  provider text NOT NULL,
  provider_account_id text,
  external_chat_id text,
  external_user_id text,
  widget_session_id uuid REFERENCES widget_sessions (id) ON DELETE SET NULL,
  display_name text,
  username text,
  normalized_phone text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_identities_lead_id_idx
  ON channel_identities (lead_id, updated_at);

CREATE INDEX IF NOT EXISTS channel_identities_channel_last_seen_idx
  ON channel_identities (channel, last_seen_at);

CREATE UNIQUE INDEX IF NOT EXISTS channel_identities_widget_session_id_idx
  ON channel_identities (widget_session_id)
  WHERE widget_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS channel_identities_telegram_chat_idx
  ON channel_identities (provider, provider_account_id, external_chat_id)
  WHERE channel = 'telegram'
    AND provider_account_id IS NOT NULL
    AND external_chat_id IS NOT NULL;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_source_channel_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_source_channel_check
  CHECK (source_channel IN ('site_form', 'site_widget', 'telegram'));

ALTER TABLE leads
  ALTER COLUMN source_page_url DROP NOT NULL,
  ALTER COLUMN source_form_kind DROP NOT NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS next_step_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_step_summary text,
  ADD COLUMN IF NOT EXISTS next_step_channel text;

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_next_step_channel_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_next_step_channel_check
  CHECK (
    next_step_channel IS NULL
    OR next_step_channel IN (
      'manager_call',
      'phone',
      'whatsapp',
      'telegram',
      'site_widget',
      'email'
    )
  );

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS public_conversation_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS channel_identity_id uuid REFERENCES channel_identities (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_state text NOT NULL DEFAULT 'ai_collecting_info';

UPDATE conversations
SET public_conversation_id = gen_random_uuid()
WHERE public_conversation_id IS NULL;

ALTER TABLE conversations
  ALTER COLUMN public_conversation_id SET NOT NULL,
  ALTER COLUMN widget_session_id DROP NOT NULL,
  ALTER COLUMN source_page_url DROP NOT NULL,
  ALTER COLUMN widget_instance_id DROP NOT NULL;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('site_widget', 'telegram'));

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_ai_state_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_ai_state_check
  CHECK (ai_state IN ('ai_collecting_info', 'needs_manager', 'manager_active', 'watching', 'closed'));

INSERT INTO channel_identities (
  lead_id,
  channel,
  provider,
  widget_session_id,
  display_name,
  metadata,
  created_at,
  updated_at,
  last_seen_at
)
SELECT DISTINCT ON (ws.id)
  c.lead_id,
  'site_widget',
  'site_widget',
  ws.id,
  NULL,
  jsonb_build_object(
    'public_session_id', ws.public_session_id,
    'widget_instance_id', ws.widget_instance_id,
    'backfilled_from', '0006_p0_channel_neutral_conversation'
  ),
  ws.created_at,
  now(),
  ws.last_seen_at
FROM widget_sessions ws
JOIN conversations c ON c.widget_session_id = ws.id
WHERE NOT EXISTS (
  SELECT 1
  FROM channel_identities ci
  WHERE ci.widget_session_id = ws.id
);

UPDATE conversations c
SET channel_identity_id = ci.id
FROM channel_identities ci
WHERE c.widget_session_id = ci.widget_session_id
  AND c.channel_identity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_public_conversation_id_idx
  ON conversations (public_conversation_id);

CREATE INDEX IF NOT EXISTS conversations_channel_identity_id_idx
  ON conversations (channel_identity_id);

ALTER TABLE conversation_messages
  ADD COLUMN IF NOT EXISTS channel_identity_id uuid REFERENCES channel_identities (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_update_id text,
  ADD COLUMN IF NOT EXISTS provider_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS provider_file_id text,
  ADD COLUMN IF NOT EXISTS provider_file_unique_id text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_size integer,
  ADD COLUMN IF NOT EXISTS duration_seconds integer,
  ADD COLUMN IF NOT EXISTS caption text;

ALTER TABLE conversation_messages
  ALTER COLUMN source_page_url DROP NOT NULL;

ALTER TABLE conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_content_type_check;

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_content_type_check
  CHECK (content_type IN ('text', 'voice', 'sticker', 'video_note', 'photo', 'document'));

UPDATE conversation_messages cm
SET channel_identity_id = c.channel_identity_id
FROM conversations c
WHERE cm.conversation_id = c.id
  AND cm.channel_identity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_provider_message_idx
  ON conversation_messages (channel_identity_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_provider_update_idx
  ON conversation_messages (channel_identity_id, provider_update_id)
  WHERE provider_update_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_message_id uuid NOT NULL REFERENCES conversation_messages (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('site_widget', 'telegram')),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed', 'retrying', 'blocked_no_destination', 'blocked')
  ),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_deliveries_message_id_idx
  ON message_deliveries (conversation_message_id);

CREATE INDEX IF NOT EXISTS message_deliveries_status_idx
  ON message_deliveries (status, updated_at);

CREATE TABLE IF NOT EXISTS manager_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  conversation_message_id uuid NOT NULL REFERENCES conversation_messages (id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  destination_kind text NOT NULL,
  destination_identity_id uuid REFERENCES channel_identities (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed', 'retrying', 'blocked_no_destination')
  ),
  provider text NOT NULL,
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_notification_outbox_lead_id_idx
  ON manager_notification_outbox (lead_id, created_at);

CREATE INDEX IF NOT EXISTS manager_notification_outbox_status_idx
  ON manager_notification_outbox (status, updated_at);

CREATE INDEX IF NOT EXISTS manager_notification_outbox_message_id_idx
  ON manager_notification_outbox (conversation_message_id);
