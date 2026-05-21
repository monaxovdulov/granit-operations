CREATE TABLE IF NOT EXISTS manager_telegram_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id uuid NOT NULL REFERENCES manager_users (id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'telegram_bot',
  provider_account_id text NOT NULL,
  external_chat_id text NOT NULL,
  external_user_id text,
  username text,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS manager_telegram_bindings_manager_idx
  ON manager_telegram_bindings (manager_user_id, status);

CREATE INDEX IF NOT EXISTS manager_telegram_bindings_chat_idx
  ON manager_telegram_bindings (provider, provider_account_id, external_chat_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS manager_telegram_bindings_manager_provider_idx
  ON manager_telegram_bindings (manager_user_id, provider, provider_account_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS manager_telegram_bindings_chat_unique_idx
  ON manager_telegram_bindings (provider, provider_account_id, external_chat_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS manager_telegram_bind_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id uuid NOT NULL REFERENCES manager_users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manager_telegram_bind_tokens_hash_idx
  ON manager_telegram_bind_tokens (token_hash);

CREATE INDEX IF NOT EXISTS manager_telegram_bind_tokens_manager_idx
  ON manager_telegram_bind_tokens (manager_user_id, created_at);

CREATE INDEX IF NOT EXISTS manager_telegram_bind_tokens_expires_idx
  ON manager_telegram_bind_tokens (expires_at);

CREATE TABLE IF NOT EXISTS manager_telegram_reply_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_user_id uuid NOT NULL REFERENCES manager_users (id) ON DELETE CASCADE,
  manager_telegram_binding_id uuid NOT NULL REFERENCES manager_telegram_bindings (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  public_conversation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manager_telegram_reply_contexts_manager_status_idx
  ON manager_telegram_reply_contexts (manager_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS manager_telegram_reply_contexts_conversation_idx
  ON manager_telegram_reply_contexts (conversation_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS manager_telegram_reply_contexts_one_pending_idx
  ON manager_telegram_reply_contexts (manager_user_id)
  WHERE status = 'pending';

ALTER TABLE manager_notification_outbox
  ADD COLUMN IF NOT EXISTS manager_telegram_binding_id uuid REFERENCES manager_telegram_bindings (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS manager_notification_outbox_manager_tg_binding_idx
  ON manager_notification_outbox (manager_telegram_binding_id, created_at);
