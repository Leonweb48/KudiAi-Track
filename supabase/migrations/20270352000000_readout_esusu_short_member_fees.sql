-- READ-ONLY (2026-10-18): the short esusu member's fee rows on 14 Oct — notes, timestamps, links. No writes, no names.
DO $$
DECLARE c uuid; x record;
BEGIN
  SELECT m.id INTO c FROM (
    SELECT cl.id, COALESCE(cl.current_balance, 0) bal, r.group_id, r.created_at rs
      FROM ajo_group_rounds r
      JOIN aso_clients cl ON cl.id IN (SELECT client_id FROM aso_client_group_memberships WHERE group_id = r.group_id AND status = 'active'
                                       UNION SELECT id FROM aso_clients WHERE ajo_group_id = r.group_id)
     WHERE r.status = 'active' AND left(r.group_id::text, 8) = 'b77ae164') m
   WHERE m.bal < (SELECT COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
                    FROM ajo_contributions WHERE aso_client_id = m.id AND contribution_context = 'esusu_rotation'
                     AND group_id = m.group_id AND status = 'completed' AND created_at >= m.rs)
   LIMIT 1;
  RAISE NOTICE 'F0 short member found: %', c IS NOT NULL;
  FOR x IN SELECT id, type, amount, payment_method, status, notes, created_at, cycle_id IS NOT NULL has_cycle,
                  left(coalesce(fee_for_contribution_id::text, '-'), 8) fee_for, left(id::text, 8) sid, reverses_contribution_id IS NOT NULL is_rev
             FROM ajo_contributions WHERE aso_client_id = c AND created_at >= '2026-10-13' ORDER BY created_at LOOP
    RAISE NOTICE 'F1 % % type=% amt=% method=% status=% cycle=% fee_for=% rev=% notes=%',
      x.sid, to_char(x.created_at, 'MM-DD HH24:MI:SS.US'), x.type, x.amount, x.payment_method, x.status, x.has_cycle, x.fee_for, x.is_rev, left(coalesce(x.notes, '-'), 90);
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
