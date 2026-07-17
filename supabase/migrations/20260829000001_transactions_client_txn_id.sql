-- Idempotency column for client-originated transaction inserts.
-- The client generates a UUID at record time; the server enforces uniqueness so
-- any retry (reconnect flush, duplicate sync trigger) is silently ignored.
-- Nullable so existing rows keep their NULL and are unaffected.

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS client_txn_id UUID;

-- Partial unique index: NULLs are excluded so legacy rows don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_client_txn_id_unique
  ON transactions (client_txn_id)
  WHERE client_txn_id IS NOT NULL;

-- RLS: existing policies cover this column automatically (it lives on the same
-- row as user_id which all existing policies already filter by).
