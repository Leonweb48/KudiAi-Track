-- ═══════════════════════════════════════════════════════════════
-- SMTP CONFIG TABLE
-- Stores SMTP credentials read by email.ts via sendEmail()
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS smtp_config (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  host        TEXT        NOT NULL,
  port        INTEGER     NOT NULL DEFAULT 587,
  username    TEXT        NOT NULL,
  password    TEXT        NOT NULL,
  from_email  TEXT        NOT NULL,
  from_name   TEXT        NOT NULL DEFAULT 'KudiAI',
  encryption  TEXT        NOT NULL DEFAULT 'tls' CHECK (encryption IN ('tls','ssl','none')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only service role can read/write SMTP credentials
ALTER TABLE smtp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON smtp_config
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Seed the SMTP credentials
INSERT INTO smtp_config (host, port, username, password, from_email, from_name, encryption)
VALUES (
  'mail.agrodice.com.ng',
  465,
  'support@agrodice.com.ng',
  'Smart@0852',
  'support@agrodice.com.ng',
  'KudiAI',
  'ssl'
)
ON CONFLICT DO NOTHING;
