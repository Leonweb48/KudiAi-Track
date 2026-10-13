-- READ-ONLY (2026-10-13): before switching Loyalty on — can signed-in owners use its three tables (privileges + RLS),
-- and is there any data already. Counts and booleans only. No writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_loyalty', 'loyalty_transactions', 'loyalty_settings'] LOOP
    RAISE NOTICE 'LY % | select % insert % update % delete % | rls % | policies % | rows %', t,
      has_table_privilege('authenticated', 'public.' || t, 'SELECT'), has_table_privilege('authenticated', 'public.' || t, 'INSERT'),
      has_table_privilege('authenticated', 'public.' || t, 'UPDATE'), has_table_privilege('authenticated', 'public.' || t, 'DELETE'),
      (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass),
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t),
      (SELECT reltuples::bigint FROM pg_class WHERE oid = ('public.' || t)::regclass);
  END LOOP;
  RAISE NOTICE 'LY anon can read customer_loyalty: %', has_table_privilege('anon', 'public.customer_loyalty', 'SELECT');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
