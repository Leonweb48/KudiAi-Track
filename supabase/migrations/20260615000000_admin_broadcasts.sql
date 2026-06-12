-- Admin Broadcasts table for Communications Center

CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  segment    TEXT        NOT NULL DEFAULT 'all',
  channel    TEXT        NOT NULL DEFAULT 'in_app',
  status     TEXT        NOT NULL DEFAULT 'sent'
               CHECK (status IN ('sent','pending','draft')),
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_broadcasts_created
  ON admin_broadcasts(created_at DESC);

ALTER TABLE admin_broadcasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON admin_broadcasts
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
