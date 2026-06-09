-- Add portal fields to aso_clients
ALTER TABLE aso_clients
  ADD COLUMN IF NOT EXISTS membership_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_pin        TEXT,
  ADD COLUMN IF NOT EXISTS portal_active     BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill existing clients with auto-generated credentials
UPDATE aso_clients
SET
  membership_number = 'AJO-' || TO_CHAR(COALESCE(created_at, NOW()), 'YYYYMM')
                      || '-' || UPPER(SUBSTR(MD5(id::TEXT), 1, 6)),
  portal_pin        = LPAD(FLOOR(1000 + RANDOM() * 9000)::TEXT, 4, '0')
WHERE membership_number IS NULL;

-- Contribution / withdrawal event log
CREATE TABLE IF NOT EXISTS ajo_contributions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aso_client_id   UUID        NOT NULL REFERENCES aso_clients(id) ON DELETE CASCADE,
  owner_id        UUID        NOT NULL,
  amount          NUMERIC     NOT NULL DEFAULT 0,
  type            TEXT        NOT NULL DEFAULT 'contribution',
  payment_method  TEXT        DEFAULT 'cash',
  paystack_ref    TEXT,
  status          TEXT        NOT NULL DEFAULT 'completed',
  notes           TEXT,
  recorded_by     UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ajo_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ajo_contributions_owner" ON ajo_contributions
  FOR ALL USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS ajo_contributions_client_idx ON ajo_contributions(aso_client_id);
CREATE INDEX IF NOT EXISTS ajo_contributions_owner_idx  ON ajo_contributions(owner_id);
