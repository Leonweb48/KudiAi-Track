-- ═══════════════════════════════════════════════════════════════
-- EMAIL CENTER: Lead contacts + outbound marketing campaign history
-- ═══════════════════════════════════════════════════════════════

-- ── email_leads: non-user email contacts for marketing ────────────
CREATE TABLE IF NOT EXISTS email_leads (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT        NOT NULL,
  name       TEXT,
  source     TEXT        NOT NULL DEFAULT 'manual',
  status     TEXT        NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'unsubscribed', 'bounced')),
  tags       TEXT[]      DEFAULT '{}',
  notes      TEXT,
  added_by   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_leads_email  ON email_leads(lower(email));
CREATE INDEX        IF NOT EXISTS idx_email_leads_status ON email_leads(status);

ALTER TABLE email_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_leads_service_role_only" ON email_leads;
CREATE POLICY "email_leads_service_role_only" ON email_leads
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── email_center_campaigns: history of marketing emails sent ─────
CREATE TABLE IF NOT EXISTS email_center_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          TEXT        NOT NULL,
  subtitle         TEXT        NOT NULL DEFAULT 'An Update from KudiAI Track',
  pre_header       TEXT,
  heading          TEXT,
  body_text        TEXT        NOT NULL DEFAULT '',
  image_url        TEXT,
  image_alt        TEXT,
  cta_text         TEXT,
  cta_url          TEXT,
  header_color     TEXT        NOT NULL DEFAULT '#4f46e5',
  status           TEXT        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  target           TEXT        NOT NULL DEFAULT 'all_leads',
  sent_at          TIMESTAMPTZ,
  recipient_count  INTEGER     NOT NULL DEFAULT 0,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  failed_count     INTEGER     NOT NULL DEFAULT 0,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ecc_status  ON email_center_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_ecc_created ON email_center_campaigns(created_at DESC);

ALTER TABLE email_center_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_center_campaigns_service_role_only" ON email_center_campaigns;
CREATE POLICY "email_center_campaigns_service_role_only" ON email_center_campaigns
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
