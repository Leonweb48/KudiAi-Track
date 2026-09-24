-- READ-ONLY diagnostic (no writes): the CURRENT definitions of every function that enforces a wallet cap
-- (single transfer / daily withdrawals / max balance), plus the current cap values in platform_config.
-- Needed to add per-tier limits by changing ONLY the cap lookups. Function source is code, not data (no secrets, no holder data).
-- Read with:  gh run view <id> --log | grep "DEF|"
DO $$
DECLARE f record; l record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.prosrc ILIKE '%wallet_daily_withdrawal_cap_kobo%' OR p.prosrc ILIKE '%wallet_max_withdrawal_kobo%' OR p.prosrc ILIKE '%wallet_max_balance_kobo%')
     ORDER BY p.proname
  LOOP
    RAISE NOTICE 'DEF|%|(%)|BEGIN', f.proname, f.args;
    FOR l IN SELECT ord, line FROM regexp_split_to_table(pg_get_functiondef(f.oid), E'\n') WITH ORDINALITY AS t(line, ord) LOOP
      RAISE NOTICE 'DEF|%|%|%', f.proname, l.ord, l.line;
    END LOOP;
  END LOOP;

  FOR l IN SELECT key, value FROM public.platform_config
            WHERE key LIKE 'wallet\_%' ESCAPE '\' OR key LIKE 'flw\_%' ESCAPE '\' ORDER BY key LOOP
    RAISE NOTICE 'CFG|%|%', l.key, l.value;
  END LOOP;
END $$;
