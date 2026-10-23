-- Owner's decision (2026-10-23): approve the ₦25,000 Esusu group withdrawal request df90b163… (a test client) into the
-- client's wallet now. The business owner's wallet can't cover it, so the platform ADVANCES ₦25,000 into that business
-- wallet first (ledger source 'adjustment', reference PLATFORM-ADVANCE-df90b163…, clearly labelled); the owner says the
-- balance will be covered later today. Then the request is approved through the same function the app uses
-- (ajo_record_withdrawal with the request id), which records the withdrawal and pays business → client wallet at once
-- (free since 20270400). All or nothing: if anything refuses, the advance and everything else are rolled back.
DO $approve$
DECLARE
  v_req   constant uuid := 'df90b163-310b-4496-95f4-b700a42191c5';
  r       record;
  v_res   jsonb;
  v_pay   record;
BEGIN
  SELECT * INTO r FROM public.ajo_withdrawal_requests WHERE id = v_req FOR UPDATE;
  IF NOT FOUND THEN RAISE NOTICE 'approve | request not found — nothing changed'; RETURN; END IF;
  IF r.status <> 'pending' THEN RAISE NOTICE 'approve | request is % — nothing changed', r.status; RETURN; END IF;
  IF r.amount <> 25000 THEN RAISE NOTICE 'approve | request is ₦% not ₦25,000 — nothing changed', r.amount; RETURN; END IF;

  BEGIN
    PERFORM public.wallet_credit(r.owner_id, 2500000, 'adjustment', 'PLATFORM-ADVANCE-' || v_req::text,
      'Platform advance to pay a client''s savings withdrawal — to be covered by KudiAI',
      jsonb_build_object('kind', 'platform_advance', 'request_id', v_req, 'to_be_covered', true));

    v_res := public.ajo_record_withdrawal(r.aso_client_id, r.owner_id, r.amount, 'cash',
      'Approved for the owner by KudiAI (platform advance)', r.owner_id, v_req, r.cycle_id, r.group_id);
    IF NOT coalesce((v_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'withdrawal refused: %', coalesce(v_res->>'error', v_res::text);
    END IF;

    SELECT status, amount_kobo INTO v_pay FROM public.ajo_wallet_payouts WHERE request_id = v_req ORDER BY created_at DESC LIMIT 1;
    IF v_pay.status IS DISTINCT FROM 'paid' THEN
      RAISE EXCEPTION 'payout not paid (status %)', coalesce(v_pay.status, 'none');
    END IF;
    RAISE NOTICE 'approve | request approved, ₦% paid into the client''s wallet; fee ₦%; platform advance ₦25,000 recorded',
      v_pay.amount_kobo / 100.0, coalesce(v_res->>'fee_amount', '0');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'approve | NOT approved, nothing changed: %', SQLERRM;
  END;
END $approve$;
