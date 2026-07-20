-- ─────────────────────────────────────────────────────────────────────────────
-- Fix ajo_locked_cycle_amount + backfill commission_balance for old data
--
-- Problem: migration 20261001000001 changed the lock function to rely on
-- commission_balance >= expected_amount_per_period. But deposits approved
-- before that migration ran left commission_balance = 0 even though a
-- commission row exists. These clients' cycles look "unlocked" and
-- withdrawals are not blocked.
--
-- Fixes:
--   1. Backfill commission_balance for existing cycles that have a
--      completed commission row but still have commission_balance = 0.
--   2. Update ajo_locked_cycle_amount to also check for a completed
--      commission row as a fallback — handles any row that slips through.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── 1. Backfill commission_balance for old data ────────────────────────────
-- Sets commission_balance = expected_amount_per_period for every active
-- first_period cycle that already has a completed commission contribution row
-- but still has commission_balance below the expected amount.
UPDATE ajo_cycles cy
SET    commission_balance = cy.expected_amount_per_period
WHERE  cy.status                    = 'active'
  AND  cy.commission_model          = 'first_period'
  AND  cy.expected_amount_per_period > 0
  AND  cy.commission_balance        < cy.expected_amount_per_period
  AND  EXISTS (
         SELECT 1
         FROM   ajo_contributions fc
         WHERE  fc.cycle_id = cy.id
           AND  fc.type     = 'commission'
           AND  fc.status   = 'completed'
       );


-- ── 2. ajo_locked_cycle_amount — dual-signal lock check ───────────────────
-- Locks the client's entire current_balance when ANY active first_period
-- cycle meets EITHER condition:
--   a) commission_balance >= expected_amount_per_period   (new data, fast)
--   b) a completed commission row exists for the cycle   (old-data fallback)
-- This makes the lock work for all clients regardless of when their first
-- deposit was approved.
CREATE OR REPLACE FUNCTION public.ajo_locked_cycle_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM   ajo_cycles cy
      WHERE  cy.client_id             = p_client_id
        AND  cy.status                = 'active'
        AND  cy.commission_model      = 'first_period'
        AND  cy.expected_amount_per_period > 0
        AND  (
               cy.commission_balance >= cy.expected_amount_per_period
               OR EXISTS (
                    SELECT 1
                    FROM   ajo_contributions fc
                    WHERE  fc.cycle_id = cy.id
                      AND  fc.type     = 'commission'
                      AND  fc.status   = 'completed'
                  )
             )
    )
    THEN (SELECT COALESCE(current_balance, 0) FROM aso_clients WHERE id = p_client_id)
    ELSE 0
  END
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  TO service_role, authenticated;
