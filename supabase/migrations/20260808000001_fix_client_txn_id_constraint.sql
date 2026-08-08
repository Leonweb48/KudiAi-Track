-- Fix: the partial unique index on client_txn_id (WHERE client_txn_id IS NOT NULL)
-- cannot be used by PostgREST for ON CONFLICT because PostgreSQL requires the exact
-- partial predicate to be included in the conflict clause, which Supabase's upsert
-- API never passes.  Replace it with a full unique constraint — PostgreSQL treats
-- each NULL as a distinct value, so existing rows with client_txn_id=NULL are safe.

DROP INDEX IF EXISTS transactions_client_txn_id_unique;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_client_txn_id_key UNIQUE (client_txn_id);
