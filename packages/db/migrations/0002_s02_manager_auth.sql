CREATE TABLE manager_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  yandex_uid text,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'viewer')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by uuid REFERENCES manager_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE UNIQUE INDEX manager_users_email_ci_idx ON manager_users (lower(email));
CREATE UNIQUE INDEX manager_users_yandex_uid_idx ON manager_users (yandex_uid);
CREATE INDEX manager_users_role_status_idx ON manager_users (role, status);

CREATE TABLE manager_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash text NOT NULL,
  manager_user_id uuid NOT NULL REFERENCES manager_users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX manager_sessions_token_hash_idx
  ON manager_sessions (session_token_hash);

CREATE INDEX manager_sessions_user_idx ON manager_sessions (manager_user_id);
CREATE INDEX manager_sessions_expires_at_idx ON manager_sessions (expires_at);
