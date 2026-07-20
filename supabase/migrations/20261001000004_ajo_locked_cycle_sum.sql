-- ─────────────────────────────────────────────────────────────────────────────
-- Fix ajo_locked_cycle_amount: lock per-cycle savings, not full balance
--
-- Previous (20261001000001/20261001000003): returned client's ENTIRE
-- current_balance when any first_period cycle was active with fee settled.
-- This blocked percent-cycle savings even though they are unrelated to the
-- first_period cycle, preventing legitimate withdrawals.
--
-- Correct model: lock only the NET savings credited inside each first_period
-- cycle — i.e. the SUM of contributions attributed to that cycle minus the
-- commission fee and registration fee rows. Percent-cycle savings remain
-- freely withdrawable.
--
-- Dual-signal: a cycle is considered "fee settled" if EITHER
--   a) commission_balance >= expected_amount_per_period  (new data path)
--   b) a completed commission row exists for the cycle   (old data fallback)
-- and nothing is locked while the fee is still accumulating.
--
-- Reversal-aware: reversal_contribution reduces the lock;
-- reversal_commission / reversal_registration_fee restore it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_locked_cycle_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(
    SUM(
      CASE c.type
        WHEN 'contribution'              THEN  c.amount
        WHEN 'commission'                THEN -c.amount
        WHEN 'registration_fee'          THEN -c.amount
        WHEN 'reversal_contribution'     THEN -c.amount
        WHEN 'reversal_commission'       THEN  c.amount
        WHEN 'reversal_registration_fee' THEN  c.amount
        ELSE 0
      END
    ),
    0
  ), 0)
  FROM  ajo_contributions c
  JOIN  ajo_cycles cy ON cy.id = c.cycle_id
  WHERE c.aso_client_id = p_client_id
    AND c.status        = 'completed'
    AND cy.status       = 'active'
    AND cy.commission_model = 'first_period'
    AND (
          cy.commission_balance >= cy.expected_amount_per_period
          OR EXISTS (
               SELECT 1
               FROM   ajo_contributions fc
               WHERE  fc.cycle_id = cy.id
                 AND  fc.type     = 'commission'
                 AND  fc.status   = 'completed'
             )
        )
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_cycle_amount(UUID)
  TO service_role, authenticated;
