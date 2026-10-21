-- READ-ONLY (2026-10-21): the bill provider switches as stored. No writes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT key, value FROM public.platform_config WHERE key LIKE 'bill_provider%' ORDER BY key LOOP
    RAISE NOTICE 'switch | % = %', r.key, r.value;
  END LOOP;
END $$;
