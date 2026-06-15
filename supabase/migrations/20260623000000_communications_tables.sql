-- ═══════════════════════════════════════════════════════════════
-- COMMUNICATIONS: Fix broadcasts, add campaigns & email_templates
-- ═══════════════════════════════════════════════════════════════

-- Fix admin_broadcasts: add missing delivery stat columns
ALTER TABLE admin_broadcasts
  ADD COLUMN IF NOT EXISTS recipients_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count       INTEGER NOT NULL DEFAULT 0;

-- ── Campaigns table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  subject          TEXT        NOT NULL,
  html_body        TEXT        NOT NULL DEFAULT '',
  text_body        TEXT,
  segment          TEXT        NOT NULL DEFAULT 'all',
  channel          TEXT        NOT NULL DEFAULT 'email',
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  recipients_count INTEGER     NOT NULL DEFAULT 0,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status  ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns(created_at DESC);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns_service_role_only" ON campaigns;
CREATE POLICY "campaigns_service_role_only" ON campaigns
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Email Templates table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  category   TEXT        NOT NULL DEFAULT 'General',
  subject    TEXT        NOT NULL,
  html_body  TEXT        NOT NULL DEFAULT '',
  text_body  TEXT,
  status     TEXT        NOT NULL DEFAULT 'draft'
               CHECK (status IN ('active','draft')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_templates_service_role_only" ON email_templates;
CREATE POLICY "email_templates_service_role_only" ON email_templates
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Fix support_tickets type CHECK to include 'ajo' ───────────────
ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_type_check;
ALTER TABLE support_tickets
  ADD CONSTRAINT support_tickets_type_check
  CHECK (type IN ('account','payment','transaction','technical','subscription','ajo','general'));
