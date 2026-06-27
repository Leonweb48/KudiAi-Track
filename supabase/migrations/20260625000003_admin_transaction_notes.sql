-- Admin notes, flags, and review markers for individual transactions
CREATE TABLE IF NOT EXISTS admin_transaction_notes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text        NOT NULL,
  admin_username text        NOT NULL,
  note           text,
  flagged        boolean     NOT NULL DEFAULT false,
  reviewed       boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_txn_notes_txn ON admin_transaction_notes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_admin_txn_notes_admin ON admin_transaction_notes(admin_username);

-- Allow service role full access
ALTER TABLE admin_transaction_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON admin_transaction_notes
  USING (true) WITH CHECK (true);
