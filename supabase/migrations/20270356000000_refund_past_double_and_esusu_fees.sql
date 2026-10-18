-- Owner's decision 2026-10-18 ("go ahead"): refund the past charges that today's rules no longer allow.
--   a) cards charged BOTH withdrawal fees and the card commission (20270353 counted 2, ₦70): the overlap
--      (the smaller of the two) goes back to the client's savings as 'reversal_commission'.
--   b) withdrawal fees taken on esusu / savings-group withdrawals (20270354 counted 2, ₦175, 17 Sept): refunded as
--      'reversal_withdrawal_fee'. (These were refunded once by 20270109 and taken back by 20270110 under the old
--      rule; the owner has now ruled that such withdrawals carry no fee.)
-- Record-only, like ajo_reverse_contribution's fee reversals: the savings money already sits in the owner's wallet.
-- Each row is refunded once (skipped when a reversal already points at it), so a re-run changes nothing.

DO $refund$
DECLARE r record; v_amt numeric; na int := 0; sa numeric := 0; nb int := 0; sb numeric := 0;
BEGIN
  -- a) card commission on top of the card's withdrawal fees
  FOR r IN
    SELECT cm.id, cm.aso_client_id, cm.owner_id, cm.amount, cm.cycle_id,
           (SELECT COALESCE(SUM(CASE WHEN f.type = 'withdrawal_fee' THEN f.amount WHEN f.type = 'reversal_withdrawal_fee' THEN -f.amount ELSE 0 END), 0)
              FROM ajo_contributions f WHERE f.cycle_id = cm.cycle_id AND f.status = 'completed') AS fees
      FROM ajo_contributions cm
     WHERE cm.type = 'commission' AND cm.status = 'completed' AND cm.cycle_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ajo_contributions rv WHERE rv.reverses_contribution_id = cm.id)
  LOOP
    CONTINUE WHEN r.fees <= 0;
    v_amt := LEAST(r.amount, r.fees);
    INSERT INTO ajo_contributions (aso_client_id, owner_id, amount, type, payment_method, status, notes,
                                   reverses_contribution_id, paystack_status, cycle_id, contribution_context)
    VALUES (r.aso_client_id, r.owner_id, v_amt, 'reversal_commission', 'commission', 'completed',
            'Refund: card commission was charged on top of the withdrawal fees already taken on this card',
            r.id, 'completed', r.cycle_id, 'personal_savings');
    UPDATE aso_clients SET current_balance = COALESCE(current_balance, 0) + v_amt WHERE id = r.aso_client_id;
    na := na + 1; sa := sa + v_amt;
  END LOOP;

  -- b) withdrawal fees on esusu / savings-group withdrawals
  FOR r IN
    SELECT f.id, f.aso_client_id, f.owner_id, f.amount, f.payment_method, f.cycle_id, f.group_id, f.contribution_context
      FROM ajo_contributions f
     WHERE f.type = 'withdrawal_fee' AND f.status = 'completed' AND f.group_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ajo_contributions rv WHERE rv.reverses_contribution_id = f.id)
  LOOP
    INSERT INTO ajo_contributions (aso_client_id, owner_id, amount, type, payment_method, status, notes,
                                   reverses_contribution_id, paystack_status,
                                   cycle_id, group_id, contribution_context)
    VALUES (r.aso_client_id, r.owner_id, r.amount, 'reversal_withdrawal_fee', r.payment_method, 'completed',
            'Refund: esusu and savings-group withdrawals carry no fee',
            r.id, 'completed', r.cycle_id, r.group_id, r.contribution_context);
    UPDATE aso_clients SET current_balance = COALESCE(current_balance, 0) + r.amount WHERE id = r.aso_client_id;
    nb := nb + 1; sb := sb + r.amount;
  END LOOP;

  RAISE NOTICE 'refunds | card double charges: % (₦%) | esusu/group withdrawal fees: % (₦%)', na, sa, nb, sb;
END $refund$;
