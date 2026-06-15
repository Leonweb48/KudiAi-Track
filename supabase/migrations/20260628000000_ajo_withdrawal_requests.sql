-- Tracks client-initiated withdrawal requests pending business approval
CREATE TABLE IF NOT EXISTS ajo_withdrawal_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  aso_client_id  UUID        NOT NULL REFERENCES aso_clients(id) ON DELETE CASCADE,
  owner_id       UUID        NOT NULL,
  amount         NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  fee_type       TEXT        NOT NULL CHECK (fee_type IN ('registration_fee', 'withdrawal_fee')),
  fee_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_amount     NUMERIC(18,2) NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes          TEXT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at    TIMESTAMPTZ,
  approved_by    UUID
);

ALTER TABLE ajo_withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- Business owner can read and update their clients' requests
CREATE POLICY "owner_manage_withdrawal_requests" ON ajo_withdrawal_requests
  FOR ALL TO authenticated
  USING   (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_awr_owner_status ON ajo_withdrawal_requests(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_awr_client       ON ajo_withdrawal_requests(aso_client_id);
