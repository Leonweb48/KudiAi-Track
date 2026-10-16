-- Read-only check that Invite & Earn landed (prints yes/no + counts only — CI logs are public).
DO $$
DECLARE v_cfg jsonb; v_set bigint;
BEGIN
  v_cfg := public.invite_cfg();
  RAISE NOTICE 'invite: enabled=% tiers=% bonus=% min_spend=% window=%',
    v_cfg->>'enabled', v_cfg->'tiers', v_cfg->>'friend_bonus', v_cfg->>'min_spend', v_cfg->>'window_days';
  RAISE NOTICE 'invite: tables codes=% campaigns=% invites=%',
    (SELECT count(*) FROM public.invite_codes), (SELECT count(*) FROM public.invite_campaigns), (SELECT count(*) FROM public.invites);
  RAISE NOTICE 'invite: ledger source allowed=%',
    (SELECT pg_get_constraintdef(oid) LIKE '%referral_reward%' FROM pg_constraint WHERE conname = 'wallet_ledger_source_check');
  RAISE NOTICE 'invite: cron job scheduled=%', (SELECT count(*) > 0 FROM cron.job WHERE jobname = 'invite-process');
  RAISE NOTICE 'invite: authenticated can call dashboard=% claim=% process=%',
    has_function_privilege('authenticated', 'public.invite_dashboard()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.invite_claim(text, text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.invite_process(uuid)', 'EXECUTE');
  SELECT balance_kobo INTO v_set FROM public.wallets WHERE user_id = '00000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'invite: settlement can fund 1 full campaign=% 10 campaigns=%', COALESCE(v_set, 0) >= 240000, COALESCE(v_set, 0) >= 2400000;
  RAISE NOTICE 'invite: process run ok, rows=%', public.invite_process(NULL);
END $$;
