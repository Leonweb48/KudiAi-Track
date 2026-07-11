-- Phase 1, Step 7: Nightly reconciliation — run this last.
-- After deploying, run SELECT * FROM ajo_run_reconciliation() manually.
-- The output is the historical damage report deliverable.
--
-- FK on client_id is RESTRICT (not CASCADE): audit rows must survive
-- client-row deletion attempts (which are already blocked by Step 1 anyway).

CREATE TABLE IF NOT EXISTS ajo_reconciliation_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID          REFERENCES aso_clients(id) ON DELETE RESTRICT,
  owner_id        UUID          NOT NULL,
  stored_balance  NUMERIC,
  ledger_balance  NUMERIC,
  delta           NUMERIC,      -- ledger_balance - stored_balance
  corrected_at    TIMESTAMPTZ   DEFAULT NOW(),
  auto_corrected  BOOLEAN       DEFAULT true,
  error_message   TEXT          -- NULL on success; set when per-client EXCEPTION fires
);

ALTER TABLE ajo_reconciliation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_read_recon" ON ajo_reconciliation_log
  FOR SELECT
  USING (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_recon_log_client    ON ajo_reconciliation_log(client_id);
CREATE INDEX IF NOT EXISTS idx_recon_log_corrected ON ajo_reconciliation_log(corrected_at DESC);

-- Main reconciliation function.
-- Wrapped in per-client exception handler: one bad client cannot abort the run.
CREATE OR REPLACE FUNCTION ajo_run_reconciliation()
RETURNS TABLE(client_id UUID, delta NUMERIC, error TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  v_ledger NUMERIC;
  v_delta  NUMERIC;
BEGIN
  FOR r IN
    SELECT id, user_id, current_balance
    FROM aso_clients
    WHERE archived_at IS NULL
  LOOP
    BEGIN
      v_ledger := ajo_client_ledger_balance(r.id);
      v_delta  := v_ledger - COALESCE(r.current_balance, 0);

      IF ABS(v_delta) > 0.001 THEN
        INSERT INTO ajo_reconciliation_log (
          client_id, owner_id, stored_balance, ledger_balance, delta
        ) VALUES (
          r.id, r.user_id,
          COALESCE(r.current_balance, 0), v_ledger, v_delta
        );

        UPDATE aso_clients
        SET current_balance = v_ledger
        WHERE id = r.id;

        client_id := r.id;
        delta     := v_delta;
        error     := NULL;
        RETURN NEXT;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- Log the error but continue processing remaining clients
      INSERT INTO ajo_reconciliation_log (
        client_id, owner_id,
        stored_balance, ledger_balance, delta,
        auto_corrected, error_message
      ) VALUES (
        r.id, r.user_id,
        COALESCE(r.current_balance, 0), NULL, NULL,
        false, SQLERRM
      );

      client_id := r.id;
      delta     := NULL;
      error     := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION ajo_run_reconciliation() TO service_role;

-- Schedule nightly at 02:00 WAT (01:00 UTC).
-- Requires pg_cron extension. Enable via Supabase Dashboard → Extensions if not present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'ajo-nightly-recon',
      '0 1 * * *',
      'SELECT ajo_run_reconciliation()'
    );
    RAISE NOTICE 'CRON: ajo-nightly-recon scheduled.';
  ELSE
    RAISE NOTICE 'CRON_SKIP: pg_cron extension not enabled. Enable it in Supabase Dashboard → Extensions, then run: SELECT cron.schedule(''ajo-nightly-recon'', ''0 1 * * *'', ''SELECT ajo_run_reconciliation()'');';
  END IF;
END;
$$;
