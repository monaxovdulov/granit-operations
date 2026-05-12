CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new')),
  source_channel text NOT NULL DEFAULT 'site_form' CHECK (source_channel = 'site_form'),
  source_page_url text NOT NULL,
  source_form_kind text NOT NULL,
  contact_name text NOT NULL,
  contact_phone text,
  contact_email text,
  contact_preferred text,
  contact_city text,
  request_text text,
  request_product_interest text,
  submitted_at timestamptz NOT NULL,
  referrer_url text,
  utm jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_status_idx ON leads (status);
CREATE INDEX leads_created_at_idx ON leads (created_at);

CREATE TABLE intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_submission_id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_version text NOT NULL CHECK (schema_version = 'site_form.v1'),
  event_type text NOT NULL CHECK (event_type = 'site_form.submitted'),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE RESTRICT,
  source_channel text NOT NULL CHECK (source_channel = 'site_form'),
  source_page_url text NOT NULL,
  source_form_kind text NOT NULL,
  request_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX intake_submissions_public_submission_id_idx
  ON intake_submissions (public_submission_id);

CREATE UNIQUE INDEX intake_submissions_idempotency_key_idx
  ON intake_submissions (idempotency_key);

CREATE INDEX intake_submissions_lead_id_idx ON intake_submissions (lead_id);

CREATE TABLE lead_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lead_timeline_events_lead_created_idx
  ON lead_timeline_events (lead_id, created_at);
