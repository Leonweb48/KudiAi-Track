-- Fix: reinstate group savings lock release mechanisms lost in 20261017000001.
--
-- 20261017000001 correctly removed esusu_rotation from ajo_locked_group_amount to
-- prevent double-locking (esusu is covered by ajo_locked_esusu_amount). However it
-- also stripped two unlock mechanisms that ajo_close_savings_round and
-- ajo_release_savings_member depend on:
--
--   1. round_status != 'closed' EXISTS check: ajo_close_savings_round sets
--      ajo_groups.round_status = 'closed'; the lock must stop counting contributions
--      once that flag is set. Without this check, closing a round has no effect on
--      the withdrawal ceiling.
--
--   2. group_release CASE row: ajo_release_savings_member inserts a completed
--      ajo_contributions row with type='group_release' to net the lock to zero for
--      the released member. Without this case, those rows are ignored and the member
--      stays locked even after being explicitly released.
--
-- This migration restores both while keeping esusu_rotation excluded.

CREATE OR REPLACE FUNCTION public.ajo_locked_group_amount(p_client_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(
    SUM(
      CASE c.type
        WHEN 'contribution'           THEN  c.amount
        WHEN 'reversal_contribution'  THEN -c.amount
        WHEN 'disbursement'           THEN -c.amount
        WHEN 'withdrawal'             THEN -c.amount
        WHEN 'reversal_withdrawal'    THEN  c.amount
        WHEN 'group_release'          THEN -c.amount
        ELSE 0
      END
    ),
    0
  ), 0)
  FROM ajo_contributions c
  WHERE c.aso_client_id = p_client_id
    AND c.status        = 'completed'
    AND (
      -- Group savings contributions: locked only while the round is open.
      -- ajo_close_savings_round sets round_status='closed'; that is the unlock event.
      (c.type IN ('contribution', 'reversal_contribution')
       AND c.contribution_context = 'group_savings'
       AND EXISTS (
         SELECT 1 FROM ajo_groups g
         WHERE g.id = c.group_id
           AND g.round_status != 'closed'
       ))
      OR
      -- Disbursements, withdrawals, and early-exit releases from group savings
      -- net out the lock. group_release rows are written by ajo_release_savings_member.
      (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal', 'group_release')
       AND c.group_id IS NOT NULL
       AND c.contribution_context = 'group_savings')
    );
$$;
