-- READ-ONLY (2026-10-25, audit): the live body of redeem_promo_code (made outside migrations) and whether its tables
-- hold rows. Log deleted after reading. No writes.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'redeem_promo_code' LIMIT 1;
  RAISE NOTICE 'P1 %', replace(coalesce(d, 'not found'), E'\n', ' ⏎ ');
  RAISE NOTICE 'P2 promo tables: %', (SELECT string_agg(table_name, ',') FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~* 'promo');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
