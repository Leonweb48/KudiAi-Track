-- READ-ONLY (2026-10-23): ClubKonnect refused MTN plan 1500.02 ("2GB+2mins Monthly Plan - 30 days (Direct Data)") with
-- INVALID_DATAPLAN although its own plan list shows it. Do ClubKonnect's "Direct Data" plans ever go through? Data bills of
-- the last 30 days: delivered / failed, by plan kind (Direct Data / SME / Gifting / Corporate / other) taken from the plan
-- name in the note, and the refusals that name INVALID_DATAPLAN. Plan names and counts only — no numbers. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE WHEN t.note ~* 'direct data' THEN 'direct' WHEN t.note ~* '\(sme\)|sme' THEN 'sme' WHEN t.note ~* 'gift' THEN 'gifting'
                WHEN t.note ~* 'corporate|cg' THEN 'corporate' ELSE 'other' END AS kind,
           CASE WHEN t.bill_status IN ('success', 'delivered', 'completed') THEN 'ok' ELSE 'not-ok' END AS outcome,
           count(*) AS n
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.created_at > now() - interval '30 days'
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'P1 % | % | n=%', r.kind, r.outcome, r.n;
  END LOOP;
  FOR r IN
    SELECT to_char(t.created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS at, t.amount,
           substring(t.note FROM 'INVALID_DATAPLAN \[[^]]*\]') AS why
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.note ~ 'INVALID_DATAPLAN' AND t.created_at > now() - interval '30 days'
     ORDER BY t.created_at LOOP
    RAISE NOTICE 'P2 % | ₦% | %', r.at, r.amount, r.why;
  END LOOP;
  FOR r IN
    SELECT substring(t.note FROM 'Plan: ([^|]*)') AS plan, count(*) AS n
      FROM public.transactions t
     WHERE t.payment_type = 'bill_payment' AND t.category = 'data' AND t.bill_status IN ('success', 'delivered', 'completed')
       AND t.note ~* 'direct data' AND t.created_at > now() - interval '30 days'
     GROUP BY 1 ORDER BY 2 DESC LIMIT 10 LOOP
    RAISE NOTICE 'P3 delivered Direct Data plan: % | n=%', trim(r.plan), r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
