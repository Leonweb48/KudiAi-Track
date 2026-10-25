-- READ-ONLY (2026-10-25, audit): would enforcing the bill price floor block genuine orders? Bill gate verdicts of the
-- last 30 days by category, plus how far below the floor the would-block ones were. Counts and amounts only. No writes.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'G0 gate config: %', (SELECT string_agg(key || '=' || value, ' ') FROM public.platform_config WHERE key LIKE 'bills_gate%');
  FOR r IN SELECT cat, verdict, count(*) n, sum(face_kobo) / 100 face, sum(paid_kobo) / 100 paid
             FROM public.bill_gate_claims WHERE created_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'G1 % | % | n=% face=₦% paid=₦%', r.cat, r.verdict, r.n, r.face, r.paid;
  END LOOP;
  FOR r IN SELECT cat, face_kobo / 100 face, paid_kobo / 100 paid, allowance_kobo / 100 allow, (coupon_code IS NOT NULL) coupon,
                  to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') at_l
             FROM public.bill_gate_claims WHERE created_at > now() - interval '30 days' AND verdict <> 'ok' ORDER BY created_at LOOP
    RAISE NOTICE 'G2 % % | face ₦% paid ₦% allowance ₦% coupon=%', r.at_l, r.cat, r.face, r.paid, r.allow, r.coupon;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
