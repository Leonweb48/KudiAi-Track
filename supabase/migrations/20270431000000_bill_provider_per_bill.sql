-- 2026-10-27 (owner: "set it for me"): main provider per bill from the live price comparison —
--   VTpass main for cable TV, electricity and Smile (same bouquet prices + 1.5–2% back on cable; 0.9–1.7% on electricity;
--   ClubKonnect sends no Smile list); ClubKonnect main for airtime (Glo 8% / 9mobile 7% vs VTpass 4%), data (cheaper on
--   every matched MTN / Airtel plan, and our own selling prices apply) and WAEC (Bigisub first anyway).
-- The other provider stays each bill's automatic backup. bill_provider back to clubkonnect so the single switch agrees
-- with the per-bill list should the list ever be cleared.
INSERT INTO public.platform_config (key, value, description) VALUES
  ('bill_provider_vtpass_services', 'cable,electricity,smile', 'Bills VTpass is the MAIN provider for (admin portal → Bill Provider, per bill). Others: ClubKonnect main.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
UPDATE public.platform_config SET value = 'clubkonnect' WHERE key = 'bill_provider';

-- READ-ONLY readout (counts only — the repo and its logs are public): bills in the last 48 h by category and status, and the
-- ClubKonnect refusals seen in data orders, to see whether ClubKonnect data works again since the product-code change.
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'PB settings | vtpass main for: % | bill_provider: %',
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider_vtpass_services'),
    (SELECT value FROM public.platform_config WHERE key = 'bill_provider');
  FOR r IN
    SELECT category, COALESCE(bill_status, '?') AS st, count(*) AS n, max(created_at) AS last
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND created_at > now() - interval '48 hours'
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'PB bills48h | % | % | n=% | last=%', r.category, r.st, r.n, to_char(r.last AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI');
  END LOOP;
  FOR r IN
    SELECT COALESCE(substring(note from '(INVALID_[A-Z_]+|ORDER_RECEIVED|ORDER_COMPLETED|SUCCESS[A-Z_]*|IP NOT WHITELISTED|INSUFFICIENT[A-Z_]*)'), 'other') AS why,
           bill_status AS st, count(*) AS n, max(created_at) AS last
      FROM public.transactions
     WHERE payment_type = 'bill_payment' AND category = 'data' AND created_at > now() - interval '72 hours'
     GROUP BY 1, 2 ORDER BY 4 DESC LOOP
    RAISE NOTICE 'PB data72h | % | % | n=% | last=%', r.why, r.st, r.n, to_char(r.last AT TIME ZONE 'Africa/Lagos', 'DD Mon HH24:MI');
  END LOOP;
  FOR r IN
    SELECT COALESCE(meta ->> 'provider', 'clubkonnect') AS provider, category, count(*) AS n
      FROM public.finance_entries
     WHERE line_code = 'bills.provider_cost' AND source_type = 'bill_cost' AND occurred_at > now() - interval '72 hours'
     GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'PB delivered72h | % | % | n=%', r.provider, r.category, r.n;
  END LOOP;
END $$;
