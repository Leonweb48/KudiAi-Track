-- Full ledger archive for permanently deleted Ajo clients.
-- Written BEFORE the hard delete so no data is lost.
CREATE TABLE IF NOT EXISTS deleted_client_archives (
  id                        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  original_client_id        UUID        NOT NULL,
  full_name                 TEXT,
  phone                     TEXT,
  balance_at_deletion       BIGINT      DEFAULT 0,
  client_record             JSONB,          -- full aso_clients row at deletion time
  contributions             JSONB,          -- all ajo_contributions rows
  group_turns               JSONB,          -- all ajo_group_turns rows
  reconciliation_log        JSONB,          -- all ajo_reconciliation_log rows
  withdrawal_requests       JSONB,          -- all ajo_withdrawal_requests rows
  deleted_at                TIMESTAMPTZ DEFAULT NOW(),
  deleted_by_admin_id       UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  deleted_by_admin_username TEXT,
  client_created_at         TIMESTAMPTZ
);
