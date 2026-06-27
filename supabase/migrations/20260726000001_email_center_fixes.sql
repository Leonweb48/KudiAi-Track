-- Fix email_leads unique constraint so ON CONFLICT (email) works
-- The old functional index on lower(email) breaks Supabase JS upsert.
-- Emails are already normalised to lowercase in the API so a plain UNIQUE
-- column constraint is equivalent and compatible with onConflict:"email".
DROP INDEX IF EXISTS idx_email_leads_email;
ALTER TABLE email_leads
  DROP CONSTRAINT IF EXISTS email_leads_email_unique;
ALTER TABLE email_leads
  ADD CONSTRAINT email_leads_email_unique UNIQUE (email);

-- Email center saved templates
CREATE TABLE IF NOT EXISTS email_center_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  subject       TEXT        NOT NULL DEFAULT '',
  subtitle      TEXT        NOT NULL DEFAULT '',
  pre_header    TEXT,
  heading       TEXT,
  body_text     TEXT        NOT NULL DEFAULT '',
  image_url     TEXT,
  image_alt     TEXT,
  extra_sections JSONB      NOT NULL DEFAULT '[]',
  cta_text      TEXT,
  cta_url       TEXT,
  header_color  TEXT        NOT NULL DEFAULT '#4f46e5',
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ect_created ON email_center_templates(created_at DESC);

ALTER TABLE email_center_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ect_service_role_only" ON email_center_templates;
CREATE POLICY "ect_service_role_only" ON email_center_templates
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add extra_sections column to campaigns table for history record
ALTER TABLE email_center_campaigns
  ADD COLUMN IF NOT EXISTS extra_sections JSONB NOT NULL DEFAULT '[]';
