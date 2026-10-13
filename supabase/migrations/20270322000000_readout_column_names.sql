-- READ-ONLY (2026-10-13): column names (schema only, no data) of aso_clients / staff / org_members, in order, to build
-- the app's explicit select lists before secret columns lose their SELECT grant. No writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['aso_clients', 'staff', 'org_members', 'profiles'] LOOP
    RAISE NOTICE 'COLS % | %', t, (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t);
  END LOOP;
END $$;
