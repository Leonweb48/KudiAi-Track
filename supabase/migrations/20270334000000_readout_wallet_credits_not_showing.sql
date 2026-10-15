-- Read-out (changes nothing, counts only): "deposits show successful but don't reflect in the wallet — bank deposits
-- and KudiAI wallet-to-wallet" (reported 2026-10-15). Is the money reaching the database (ledger + balance), or can the
-- app not read it (privileges / realtime)?

DO $$
DECLARE r RECORD; n bigint; m bigint; x text;
BEGIN
  -- 1. credits by day and source (Lagos time), last 4 days
  FOR r IN
    SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'MM-DD') AS d, source, status, count(*) AS n
      FROM public.wallet_ledger
     WHERE direction = 'credit' AND created_at > now() - interval '4 days'
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  LOOP
    RAISE NOTICE 'credits | % | % | % | %', r.d, r.source, r.status, r.n;
  END LOOP;

  FOR r IN
    SELECT source, to_char(max(created_at) AT TIME ZONE 'Africa/Lagos', 'MM-DD HH24:MI') AS last_at
      FROM public.wallet_ledger WHERE direction = 'credit' AND status = 'completed'
       AND source IN ('topup', 'sale', 'transfer_in', 'wallet_transfer', 'p2p', 'internal_transfer')
     GROUP BY source
  LOOP
    RAISE NOTICE 'last completed credit | % | %', r.source, r.last_at;
  END LOOP;

  -- 2. wallets whose balance disagrees with their newest completed ledger row
  SELECT count(*) INTO n FROM (
    SELECT w.id, w.balance_kobo,
           (SELECT l.balance_after_kobo FROM public.wallet_ledger l
             WHERE l.wallet_id = w.id AND l.status = 'completed' AND l.balance_after_kobo IS NOT NULL
             ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_after
      FROM public.wallets w
  ) t WHERE t.last_after IS NOT NULL AND t.last_after <> t.balance_kobo;
  SELECT count(*) INTO m FROM public.wallets;
  RAISE NOTICE 'balance vs ledger | % of % wallets disagree with their newest ledger row', n, m;

  SELECT count(*) INTO n FROM public.wallet_ledger WHERE status <> 'completed' AND direction = 'credit' AND created_at > now() - interval '4 days';
  RAISE NOTICE 'credits not completed (4 days) | %', n;

  -- 3. Flutterwave webhooks vs ledger (last 4 days)
  FOR r IN SELECT event, count(*) AS n FROM public.wallet_webhook_log WHERE processed_at > now() - interval '4 days' GROUP BY 1 ORDER BY 2 DESC LOOP
    RAISE NOTICE 'webhooks | % | %', r.event, r.n;
  END LOOP;
  SELECT count(*) INTO n FROM public.wallet_webhook_log h
   WHERE h.processed_at > now() - interval '4 days' AND h.event ILIKE '%charge%' AND h.flw_reference IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.flw_reference = h.flw_reference);
  RAISE NOTICE 'charge webhooks with no ledger row (4 days) | %', n;

  -- 4. can signed-in users read their wallet?
  RAISE NOTICE 'privilege | authenticated SELECT wallets=% wallet_ledger=%',
    has_table_privilege('authenticated', 'public.wallets', 'SELECT'), has_table_privilege('authenticated', 'public.wallet_ledger', 'SELECT');
  SELECT string_agg(column_name, ',') INTO x FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'wallets'
     AND NOT has_column_privilege('authenticated', 'public.wallets', column_name, 'SELECT');
  RAISE NOTICE 'privilege | wallets columns authenticated cannot read: %', COALESCE(x, 'none');
  SELECT string_agg(column_name, ',') INTO x FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'wallet_ledger'
     AND NOT has_column_privilege('authenticated', 'public.wallet_ledger', column_name, 'SELECT');
  RAISE NOTICE 'privilege | wallet_ledger columns authenticated cannot read: %', COALESCE(x, 'none');
  SELECT string_agg(policyname || '(' || cmd || ')', ', ') INTO x FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallets';
  RAISE NOTICE 'policies | wallets: %', COALESCE(x, 'none');
  SELECT string_agg(tablename, ',') INTO x FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('wallets', 'wallet_ledger');
  RAISE NOTICE 'realtime | published: %', COALESCE(x, 'none');

  -- 5. recently changed functions that move money in
  FOR r IN SELECT p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
            WHERE s.nspname = 'public' AND p.proname IN ('wallet_credit', 'wallet_take_deposit_fee', 'wallet_internal_transfer', 'wallet_p2p_transfer')
  LOOP
    RAISE NOTICE 'function present | %', r.proname;
  END LOOP;
END $$;
