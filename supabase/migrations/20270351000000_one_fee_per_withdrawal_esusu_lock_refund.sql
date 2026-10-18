-- Esusu "Pay out" failed with aso_clients_balance_nonneg (2026-10-18). Read-out 20270350: one member's savings balance
-- was ₦175 below their esusu contributions for the round, so the pot sweep would have taken them below zero.
--
-- How it happened (14 Oct): a ₦5,000 personal-savings withdrawal was charged the card fee twice — the 3.5% withdrawal
-- fee (₦175) AND the "cycle commission (auto-settled at withdrawal)" for the finished card (₦175). The withdrawal was
-- allowed although that took esusu money, because ajo_locked_esusu_amount counted esusu contributions only from the
-- current turn's period_start while the payout sweeps everything since the ROUND started.
--
-- Owner's decision 2026-10-18: refund the duplicate ₦175 to the client's savings and stop charging both on one
-- withdrawal for everyone.
--   1. ajo_record_withdrawal: one fee per withdrawal. Commission settled for finished cards in the same withdrawal
--      counts toward the withdrawal fee (total charged = the larger of the two, never both). Edited in place.
--   2. ajo_locked_esusu_amount: locks exactly what the payout sweeps — per active round with a current turn, the
--      member's esusu net (contributions - sweeps) for that group since the round started.
--   3. Refund the ₦175 (record-only 'reversal_commission', like ajo_reverse_contribution writes; the savings money
--      already sits in the owner's wallet, so no wallet move). Other past double charges are only counted.

-- ── 1. one fee per withdrawal ────────────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE
  v_def  text;
  v_old  constant text := 'v_net_amount := p_gross_amount - v_fee_amount;';
  v_new  constant text := '-- One fee per withdrawal (2026-10-18): commission just settled for finished cards counts toward this fee.
  v_fee_amount := GREATEST(0, v_fee_amount - COALESCE(v_total_commission_due, 0));
  v_net_amount := p_gross_amount - v_fee_amount;';
  v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  IF v_def IS NULL THEN RAISE EXCEPTION 'ajo_record_withdrawal not found'; END IF;

  IF position('One fee per withdrawal (2026-10-18)' IN v_def) > 0 THEN
    RAISE NOTICE 'one-fee-per-withdrawal | already applied';
  ELSE
    v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'expected the net-amount line exactly once in ajo_record_withdrawal, found % — refusing to guess', v_hits;
    END IF;
    IF position('v_total_commission_due' IN v_def) = 0 THEN
      RAISE EXCEPTION 'ajo_record_withdrawal has no commission sweep (v_total_commission_due) — refusing to guess';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
    RAISE NOTICE 'one-fee-per-withdrawal | applied';
  END IF;
END $mig$;

DO $grants$
DECLARE v_sig text;
BEGIN
  SELECT p.oid::regprocedure::text INTO v_sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ajo_record_withdrawal';
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
END $grants$;

-- ── 2. the esusu lock matches the payout sweep ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_locked_esusu_amount(p_client_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Same window and rows as ajo_execute_payout's sweep: per active round (with a current turn) of each esusu group
  -- the client is in, their completed esusu contributions for that group since the round started, less sweeps.
  SELECT COALESCE(SUM(GREATEST(x.net, 0)), 0)
  FROM (
    SELECT (
      SELECT COALESCE(SUM(CASE WHEN ac.type = 'contribution'    THEN ac.amount ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN ac.type = 'esusu_pot_sweep' THEN ac.amount ELSE 0 END), 0)
        FROM ajo_contributions ac
       WHERE ac.aso_client_id        = p_client_id
         AND ac.contribution_context = 'esusu_rotation'
         AND ac.group_id             = r.group_id
         AND ac.status               = 'completed'
         AND ac.created_at          >= r.created_at
    ) AS net
    FROM ajo_group_rounds r
    WHERE r.status = 'active'
      AND EXISTS (SELECT 1 FROM ajo_group_turns t WHERE t.round_id = r.id AND t.status = 'current')
      AND (
        r.group_id IN (SELECT group_id FROM aso_client_group_memberships WHERE client_id = p_client_id AND status = 'active')
        OR r.group_id IN (SELECT ajo_group_id FROM aso_clients WHERE id = p_client_id AND ajo_group_id IS NOT NULL)
      )
  ) x;
$$;

REVOKE EXECUTE ON FUNCTION public.ajo_locked_esusu_amount(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_locked_esusu_amount(UUID) TO service_role, authenticated;

-- ── 3. refund the duplicate ₦175 (owner-approved); count any other past double charges ──────────────────────────
DO $refund$
DECLARE r record; v_done int := 0; v_other int := 0; v_other_sum numeric := 0; v_dup numeric;
BEGIN
  FOR r IN
    SELECT cm.id, cm.aso_client_id, cm.owner_id, cm.amount, cm.cycle_id, cm.created_at,
           (SELECT sum(f.amount) FROM ajo_contributions f
             WHERE f.aso_client_id = cm.aso_client_id AND f.type = 'withdrawal_fee' AND f.status = 'completed'
               AND f.created_at = cm.created_at) AS fee_same_tx,
           EXISTS (SELECT 1 FROM ajo_group_rounds gr
                    WHERE gr.status = 'active' AND left(gr.group_id::text, 8) = 'b77ae164'
                      AND (gr.group_id IN (SELECT group_id FROM aso_client_group_memberships WHERE client_id = cm.aso_client_id AND status = 'active')
                           OR gr.group_id IN (SELECT ajo_group_id FROM aso_clients WHERE id = cm.aso_client_id))) AS is_target
      FROM ajo_contributions cm
     WHERE cm.type = 'commission' AND cm.status = 'completed'
       AND cm.notes = 'Cycle commission (auto-settled at withdrawal)'
       AND NOT EXISTS (SELECT 1 FROM ajo_contributions rv WHERE rv.reverses_contribution_id = cm.id)
  LOOP
    CONTINUE WHEN r.fee_same_tx IS NULL;          -- commission alone (no withdrawal fee in that withdrawal) is fine
    v_dup := LEAST(r.amount, r.fee_same_tx);
    IF r.is_target AND r.created_at::date = DATE '2026-10-14' AND r.amount = 175 THEN
      INSERT INTO ajo_contributions (
        aso_client_id, owner_id, amount, type, payment_method, status, notes,
        reverses_contribution_id, paystack_status, cycle_id, contribution_context
      ) VALUES (
        r.aso_client_id, r.owner_id, v_dup, 'reversal_commission', 'commission', 'completed',
        'Refund: card fee was charged twice on the 14 Oct withdrawal (withdrawal fee + cycle commission)',
        r.id, 'completed', r.cycle_id, 'personal_savings'
      );
      UPDATE aso_clients SET current_balance = COALESCE(current_balance, 0) + v_dup WHERE id = r.aso_client_id;
      v_done := v_done + 1;
    ELSE
      v_other := v_other + 1; v_other_sum := v_other_sum + v_dup;
    END IF;
  END LOOP;
  RAISE NOTICE 'double-fee refund | refunded=% (the esusu member) | other past double charges NOT refunded: % totalling ₦%',
    v_done, v_other, v_other_sum;
END $refund$;

-- ── self-check: no active esusu member is still below their pot share ────────────────────────────────────────────
DO $check$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM ajo_group_rounds r
    JOIN LATERAL (
      SELECT c.id, COALESCE(c.current_balance, 0) bal
        FROM aso_clients c
       WHERE c.id IN (SELECT client_id FROM aso_client_group_memberships WHERE group_id = r.group_id AND status = 'active'
                      UNION SELECT id FROM aso_clients WHERE ajo_group_id = r.group_id)
    ) m ON true
   WHERE r.status = 'active'
     AND EXISTS (SELECT 1 FROM ajo_group_turns t WHERE t.round_id = r.id AND t.status = 'current')
     AND m.bal < (SELECT COALESCE(SUM(CASE WHEN type = 'contribution' THEN amount ELSE 0 END), 0)
                       - COALESCE(SUM(CASE WHEN type = 'esusu_pot_sweep' THEN amount ELSE 0 END), 0)
                    FROM ajo_contributions
                   WHERE aso_client_id = m.id AND contribution_context = 'esusu_rotation' AND group_id = r.group_id
                     AND status = 'completed' AND created_at >= r.created_at);
  RAISE NOTICE 'self-check | esusu members still below their pot share: %', n;
END $check$;
