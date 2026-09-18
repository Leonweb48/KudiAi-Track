-- ═════════════════════════════════════════════════════════════════════════════
-- Diagnostic (20270122000000) found these two payouts were never failed —
-- both are legitimately scheduled_date=2026-09-21 (normal withdrawal→payout
-- timing), owner_id=fef18c36-867b-4740-926d-7399e6aa6596, owner balance
-- ₦12,665.07 kobo, more than enough to cover both (₦5,000 + ₦3,860). That's
-- why Retry never showed for them — Aso's Failed list only surfaces rows
-- that are 'failed' or overdue-pending, and these were neither. Owner
-- explicitly asked to pay these two out today instead of waiting until the
-- 21st, with funds already available. Pull just these two rows'
-- scheduled_date forward to today, then settle — scoped to this one owner
-- only, via the same reset-then-settle mechanism Retry and the auto-settle
-- trigger already use.
-- ═════════════════════════════════════════════════════════════════════════════

UPDATE public.ajo_wallet_payouts
SET scheduled_date = CURRENT_DATE
WHERE id IN ('72de12f5-cae4-424b-85b5-23cdd094e09e', 'f54be6b4-a26b-4768-be7e-67a8430d1c53')
  AND status = 'pending';

SELECT public.ajo_settle_due_wallet_payouts('fef18c36-867b-4740-926d-7399e6aa6596'::uuid, true);

DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, status, failure_reason, amount_kobo
    FROM public.ajo_wallet_payouts
    WHERE id IN ('72de12f5-cae4-424b-85b5-23cdd094e09e', 'f54be6b4-a26b-4768-be7e-67a8430d1c53')
  LOOP
    RAISE NOTICE 'result: payout_id=% status=% failure_reason=% amount_kobo=%',
      v_row.id, v_row.status, v_row.failure_reason, v_row.amount_kobo;
  END LOOP;
END $$;
