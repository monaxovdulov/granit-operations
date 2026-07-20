CREATE TABLE ai_runtime_controls (
  scope text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  changed_by_manager_id uuid REFERENCES manager_users (id) ON DELETE SET NULL,
  changed_by_manager_email text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_runtime_controls_scope_check CHECK (scope IN ('site_widget')),
  CONSTRAINT ai_runtime_controls_version_check CHECK (version > 0),
  CONSTRAINT ai_runtime_controls_actor_check CHECK (
    (changed_by_manager_id IS NULL AND changed_by_manager_email IS NULL)
    OR (changed_by_manager_id IS NOT NULL AND changed_by_manager_email IS NOT NULL)
  )
);

INSERT INTO ai_runtime_controls (scope, enabled, version)
VALUES ('site_widget', true, 1);
