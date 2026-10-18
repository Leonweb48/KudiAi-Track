-- READ-ONLY (2026-10-18): "Pay out" on an esusu group fails with aso_clients_balance_nonneg. ajo_execute_payout
-- takes each member's esusu net (contributions - sweeps since the round started) off current_balance; find the
-- members whose current_balance is below that net and what moved their balance. Amounts and types only, no names.
DO $$
DECLARE g record; m record; x record; n int := 0;
BEGIN
  FOR g IN
    SELECT r.id AS round_id, r.group_id, r.created_at AS round_start, r.round_number, gr.group_mode
      FROM public.ajo_group_rounds r JOIN public.ajo_groups gr ON gr.id = r.group_id
     WHERE r.status = 'active' AND EXISTS (SELECT 1 FROM public.ajo_group_turns t WHERE t.round_id = r.id AND t.status = 'current')
  LOOP
    FOR m IN
      SELECT c.id, coalesce(c.current_balance, 0) AS bal, coalesce(c.contribution_amount, 0) AS due,
             (SELECT coalesce(sum(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0)
                   - coalesce(sum(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
                FROM public.ajo_contributions
               WHERE aso_client_id = c.id AND contribution_context = 'esusu_rotation' AND group_id = g.group_id
                 AND status = 'completed' AND created_at >= g.round_start) AS net
        FROM public.aso_clients c
       WHERE c.id IN (SELECT client_id FROM public.aso_client_group_memberships WHERE group_id = g.group_id AND status = 'active'
                      UNION SELECT id FROM public.aso_clients WHERE ajo_group_id = g.group_id)
    LOOP
      IF m.net > m.bal THEN
        n := n + 1;
        RAISE NOTICE 'E1 group=% round=% mode=% member#% | balance=% esusu_net=% due=% short=%',
          left(g.group_id::text, 8), g.round_number, g.group_mode, n, m.bal, m.net, m.due, m.net - m.bal;
        FOR x IN
          SELECT type, coalesce(contribution_context, '-') ctx, status, payment_method, count(*) k, sum(amount) amt,
                 max(created_at)::date last_at, bool_or(created_at >= g.round_start) in_round
            FROM public.ajo_contributions WHERE aso_client_id = m.id GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4
        LOOP
          RAISE NOTICE 'E2   member#% type=% ctx=% status=% method=% n=% sum=% last=% in_round=%',
            n, x.type, x.ctx, x.status, x.payment_method, x.k, x.amt, x.last_at, x.in_round;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'E0 members whose balance is below their esusu net: %', n;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
