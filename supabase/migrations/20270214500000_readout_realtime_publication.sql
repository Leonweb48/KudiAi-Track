-- READ-ONLY diagnostic (no writes): which tables are in the supabase_realtime publication, and the SELECT policies on the inventory tables.
-- Prints STRUCTURE only. Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  BEGIN
    RAISE NOTICE 'PUBLICATION supabase_realtime tables: %',
      (SELECT string_agg(schemaname || '.' || tablename, ', ' ORDER BY tablename) FROM pg_publication_tables WHERE pubname = 'supabase_realtime');
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'publication failed: %', SQLERRM; END;

  BEGIN
    FOR r IN SELECT tablename, policyname, cmd, left(COALESCE(qual, ''), 160) AS q
               FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('products', 'stock_movements') ORDER BY tablename, policyname
    LOOP RAISE NOTICE 'POLICY % % [%] : %', r.tablename, r.policyname, r.cmd, r.q; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'policies failed: %', SQLERRM; END;

  BEGIN
    FOR r IN SELECT c.relname, c.relreplident, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
              WHERE c.relname IN ('products', 'stock_movements', 'subscriptions')
    LOOP RAISE NOTICE 'TABLE % replica_identity=% rls=%', r.relname, r.relreplident, r.relrowsecurity; END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'tables failed: %', SQLERRM; END;
END $$;
