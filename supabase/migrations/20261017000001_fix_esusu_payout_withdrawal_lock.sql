-- Fix: ajo_locked_group_amount was locking ALL esusu_rotation contributions ever
-- recorded, even those already swept. After ajo_execute_payout runs, it inserts
-- esusu_pot_sweep rows to debit each member's contribution from their balance.
-- The original contributions remain in the DB (not deleted), so the old lock
-- formula kept counting them — blocking the payout recipient from withdrawing
-- their received payout.
--
-- The correct approach: exclude esusu_rotation from this function entirely.
-- The current turn's unswept esusu contribution is already locked by
-- ajo_locked_esusu_amount. Counting it here again causes double-locking AND
-- blocks payout recipients (whose swept contributions net to zero but still
-- appear as a positive sum here).

CREATE OR REPLACE FUNCTION public.ajo_locked_group_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Locks only group_savings contributions.
  -- Esusu rotation money is covered by ajo_locked_esusu_amount; including it
  -- here created double-locking and prevented payout recipients from withdrawing.
  SELECT GREATEST(COALESCE(
    SUM(
      CASE c.type
        WHEN 'contribution'           THEN  c.amount
        WHEN 'reversal_contribution'  THEN -c.amount
        WHEN 'disbursement'           THEN -c.amount
        WHEN 'withdrawal'             THEN -c.amount
        WHEN 'reversal_withdrawal'    THEN  c.amount
        ELSE 0
      END
    ),
    0
  ), 0)
  FROM ajo_contributions c
  WHERE c.aso_client_id = p_client_id
    AND c.status        = 'completed'
    AND (
      (c.type IN ('contribution', 'reversal_contribution')
       AND c.contribution_context = 'group_savings')
      OR
      (c.type IN ('disbursement', 'withdrawal', 'reversal_withdrawal')
       AND c.group_id IS NOT NULL
       AND c.contribution_context = 'group_savings')
    );
$$;

REVOKE ALL ON FUNCTION public.ajo_locked_group_amount(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajo_locked_group_amount(UUID) TO service_role, authenticated;
