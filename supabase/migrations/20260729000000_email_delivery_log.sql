-- ═══════════════════════════════════════════════════════════════
-- EMAIL DELIVERY LOG
-- Tracks every transactional email attempt (sent / failed)
-- so admins can diagnose which notifications are not delivering.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    TEXT        NOT NULL,
  subject     TEXT,
  status      TEXT        NOT NULL DEFAULT 'sent'
               CHECK (status IN ('sent', 'failed')),
  error_msg   TEXT,
  smtp_host   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edl_created  ON email_delivery_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edl_status   ON email_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_edl_to_email ON email_delivery_log(to_email);

ALTER TABLE email_delivery_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edl_service_role_only" ON email_delivery_log
  USING  (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
