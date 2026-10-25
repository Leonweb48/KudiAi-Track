-- READ-ONLY (2026-10-25, audit): what the bill gate logged in the last 30 days (would-block floor, refusals), by
-- category and outcome, with paid ÷ face for the would-block ones. Counts and amounts only. No writes.
DO $$
DECLARE r record; cols text;
BEGIN
  SELECT string_agg(column_name, ',') INTO cols FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bill_gate_log';
  RAISE NOTICE 'L0 columns: %', cols;
  FOR r IN EXECUTE 'SELECT cat, coalesce(to_jsonb(l)->>''outcome'', to_jsonb(l)->>''verdict'', to_jsonb(l)->>''reason'', ''?'') o, count(*) n
                      FROM public.bill_gate_log l WHERE created_at > now() - interval ''30 days'' GROUP BY 1, 2 ORDER BY 1, 2' LOOP
    RAISE NOTICE 'L1 % | % | n=%', r.cat, r.o, r.n;
  END LOOP;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'readout failed: %', SQLERRM;
END $$;
