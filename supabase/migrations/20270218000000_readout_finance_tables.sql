-- READ-ONLY diagnostic (no writes, no row values): the columns of every table that could carry platform revenue, cost, commission, refund or reward data.
-- Read with:  gh run view <id> --log | grep NOTICE
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, string_agg(c.column_name || ':' || c.data_type, ', ' ORDER BY c.ordinal_position) AS cols
      FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND (c.table_name ~* '(commission|payout|referral|coupon|sms|cashback|reward|usage|refund|billing|payment_req|bill_|ledger_|fee|marketer|partner|expense|settlement|platform_)'
            OR c.table_name IN ('coupons', 'coupon_redemptions', 'sms_log', 'cashback_transactions', 'reward_points_log', 'admin_audit_log', 'rate_limits'))
       AND c.table_name NOT LIKE 'pg_%'
     GROUP BY c.table_name ORDER BY c.table_name
  LOOP RAISE NOTICE 'FIN % : %', r.t, r.cols; END LOOP;

  FOR r IN SELECT n.nspname || '.' || p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
            WHERE p.proname ~* '(finance|profit|revenue|commission|settlement|report|statement)' ORDER BY 1
  LOOP RAISE NOTICE 'FN % (%)', r.fn, left(r.args, 120); END LOOP;

  RAISE NOTICE 'pg_cron available: %', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron');
  RAISE NOTICE 'pg_net available: %', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net');
END $$;
