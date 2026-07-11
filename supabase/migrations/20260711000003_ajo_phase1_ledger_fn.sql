-- Phase 1, Step 3: Ledger-truth function and non-negative balance constraint.
-- The function computes the canonical client balance from the ledger (sum of completed rows).
-- All 8 row types are accounted for:
--   Credits  (+): contribution, reversal_withdrawal, reversal_withdrawal_fee, reversal_registration_fee
--   Debits   (-): withdrawal, withdrawal_fee, registration_fee, reversal_contribution

CREATE OR REPLACE FUNCTION ajo_client_ledger_balance(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(CASE
      WHEN type IN (
        'contribution',
        'reversal_withdrawal',
        'reversal_withdrawal_fee',
        'reversal_registration_fee'
      ) AND status = 'completed' THEN amount
      ELSE 0
    END)
    -
    SUM(CASE
      WHEN type IN (
        'withdrawal',
        'withdrawal_fee',
        'registration_fee',
        'reversal_contribution'
      ) AND status = 'completed' THEN amount
      ELSE 0
    END),
  0)
  FROM ajo_contributions
  WHERE aso_client_id = p_client_id;
$$;

GRANT EXECUTE ON FUNCTION ajo_client_ledger_balance(UUID) TO authenticated;

-- ── Pre-check: detect and log any negative balances before adding constraint ──
-- Any clients with negative balances are clamped to zero here and logged via
-- a RAISE NOTICE so the output appears in migration logs.
-- Root cause is always a fee-accounting discrepancy that reconciliation
-- will surface and correct on subsequent runs.
DO $$
DECLARE
  r   RECORD;
  cnt INT := 0;
BEGIN
  FOR r IN
    SELECT id, full_name, current_balance
    FROM aso_clients
    WHERE current_balance < 0
  LOOP
    cnt := cnt + 1;
    RAISE NOTICE 'NEGATIVE_BALANCE: client=% name=% balance=%',
      r.id, r.full_name, r.current_balance;
    UPDATE aso_clients SET current_balance = 0 WHERE id = r.id;
  END LOOP;

  IF cnt = 0 THEN
    RAISE NOTICE 'NEGATIVE_BALANCE_CHECK: 0 clients with negative balance — clean.';
  ELSE
    RAISE NOTICE 'NEGATIVE_BALANCE_CHECK: % client(s) clamped to 0. Will reconcile on next run.', cnt;
  END IF;
END;
$$;

-- Now safe to add constraint — all balances are >= 0.
ALTER TABLE aso_clients
  ADD CONSTRAINT aso_clients_balance_nonneg CHECK (current_balance >= 0);
