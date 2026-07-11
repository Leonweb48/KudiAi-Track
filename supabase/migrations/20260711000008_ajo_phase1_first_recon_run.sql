-- Phase 1, Step 8: First manual reconciliation run (diagnostic deliverable).
-- This migration triggers the first ajo_run_reconciliation() run and logs
-- all results via RAISE NOTICE so they appear in the migration output.
-- After this first run, the function is scheduled nightly (via pg_cron).
-- This migration file can be removed after the deliverable is captured.

DO $$
DECLARE
  r        RECORD;
  cnt      INT := 0;
  err_cnt  INT := 0;
BEGIN
  RAISE NOTICE 'RECONCILIATION_RUN: Starting first ajo_run_reconciliation()...';

  FOR r IN SELECT * FROM ajo_run_reconciliation()
  LOOP
    cnt := cnt + 1;
    IF r.error IS NOT NULL THEN
      err_cnt := err_cnt + 1;
      RAISE NOTICE 'RECON_ERROR: client=% error=%', r.client_id, r.error;
    ELSE
      RAISE NOTICE 'RECON_DELTA: client=% delta=%', r.client_id, r.delta;
    END IF;
  END LOOP;

  IF cnt = 0 THEN
    RAISE NOTICE 'RECONCILIATION_RUN: COMPLETE. 0 discrepancies — all client balances match ledger.';
  ELSE
    RAISE NOTICE 'RECONCILIATION_RUN: COMPLETE. % row(s) processed: % corrected, % error(s).',
      cnt, cnt - err_cnt, err_cnt;
  END IF;
END;
$$;
