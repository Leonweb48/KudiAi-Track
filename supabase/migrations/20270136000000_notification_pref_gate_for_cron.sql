-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase E: make the new cron notifiers respect the
-- per-category toggles.
--
-- notify-send checks notification_preferences before inserting (CAT_PREF),
-- but the Phase D cron functions insert straight into `notifications` in
-- SQL and never went through it — so switching a category off in Settings
-- would not have stopped them. notif_pref_allows() is the SQL twin of
-- notify-send's check: no preferences row, or a NULL/true column, means
-- allowed (fails open, same as notify-send).
--
-- Deliberately NOT gated: the Ajo wallet-payout notifications
-- (ajo_payout / _failed / _delayed / _shortfall). Those are transactional
-- money-movement alerts (a payout that failed, a balance that's too low),
-- not summaries or reminders, and were never preference-checked before —
-- an owner who muted "Money" for noise shouldn't silently miss a failed
-- client payout.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notif_pref_allows(p_user uuid, p_category text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT CASE p_category
           WHEN 'money'       THEN pref_money
           WHEN 'savings'     THEN pref_savings
           WHEN 'stock'       THEN pref_stock
           WHEN 'permissions' THEN pref_permissions
           WHEN 'approvals'   THEN pref_approvals
           WHEN 'credit'      THEN pref_credit
           WHEN 'alert'       THEN pref_alert
           WHEN 'bills'       THEN pref_bills
           WHEN 'milestone'   THEN pref_milestone
           ELSE true
         END
    INTO v_allowed
    FROM public.notification_preferences
   WHERE user_id = p_user;

  RETURN COALESCE(v_allowed, true);
END;
$function$;

REVOKE ALL ON FUNCTION public.notif_pref_allows(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notif_pref_allows(uuid, text) TO service_role;

-- ── D2: credit due today ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.credit_check_due_today()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, user_id, customer_name, outstanding
    FROM public.credits
    WHERE status IN ('active', 'overdue')
      AND outstanding > 0
      AND due_date = CURRENT_DATE
      AND public.notif_pref_allows(user_id, 'credit')
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'credit_due_today', 'credit',
      COALESCE(v_row.customer_name, 'A customer') || ' owes ₦' || to_char(v_row.outstanding, 'FM999,999,990.00') || ' — due today',
      'Tap to send a payment reminder.',
      jsonb_build_object('tab', 'credit', 'id', v_row.id), 'high',
      format('credit_due_today_%s_%s', v_row.id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.credit_check_due_today() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.credit_check_due_today() TO service_role;

-- ── D4: Ajo collection reminder ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ajo_check_collection_reminder()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT
      user_id,
      COUNT(*)                                  AS n_due,
      COALESCE(SUM(contribution_amount), 0)     AS total_expected
    FROM public.aso_clients
    WHERE status = 'active'
      AND next_contribution_date IS NOT NULL
      AND next_contribution_date <= CURRENT_DATE
      AND public.notif_pref_allows(user_id, 'savings')
    GROUP BY user_id
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'ajo_collection_reminder', 'savings',
      'Collect from ' || v_row.n_due || ' client' || CASE WHEN v_row.n_due = 1 THEN '' ELSE 's' END || ' today',
      '₦' || to_char(v_row.total_expected, 'FM999,999,990.00') || ' expected in contributions.',
      jsonb_build_object('tab', 'aso'), 'high',
      format('ajo_collection_reminder_%s_%s', v_row.user_id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_check_collection_reminder() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_check_collection_reminder() TO service_role;

-- ── D3: low stock daily sweep ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stock_check_low_daily()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, user_id, product_name, quantity
    FROM public.products
    WHERE COALESCE(quantity, 0) <= COALESCE(low_stock_threshold, 5)
      AND COALESCE(low_stock_threshold, 5) > 0
      AND public.notif_pref_allows(user_id, 'stock')
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'low_stock', 'stock',
      'Low Stock: ' || v_row.product_name,
      'Only ' || v_row.quantity || ' unit' || CASE WHEN v_row.quantity = 1 THEN '' ELSE 's' END || ' left — consider restocking',
      jsonb_build_object('tab', 'inventory', 'id', v_row.id), 'high',
      format('low_stock_%s_%s', v_row.id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.stock_check_low_daily() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.stock_check_low_daily() TO service_role;

-- ── D5: sales milestones ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_sales_milestones()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tiers  NUMERIC[] := ARRAY[50000,100000,250000,500000,1000000,2500000,5000000,10000000];
  v_month  DATE := date_trunc('month', CURRENT_DATE)::date;
  v_row    RECORD;
  v_top    NUMERIC;
BEGIN
  FOR v_row IN
    SELECT user_id, COALESCE(SUM(amount), 0) AS month_total
    FROM public.transactions
    WHERE type = 'in'
      AND transaction_date >= v_month
      AND transaction_date <  (v_month + INTERVAL '1 month')::date
    GROUP BY user_id
    HAVING COALESCE(SUM(amount), 0) >= v_tiers[1]
  LOOP
    -- Muted owners are skipped without recording anything, so if they
    -- un-mute mid-month they still hear about the highest tier reached
    -- rather than silently never hearing about it.
    CONTINUE WHEN NOT public.notif_pref_allows(v_row.user_id, 'milestone');

    -- Highest crossed tier not yet notified this month. Only that one gets a
    -- notification: a big day that jumps two tiers, or an un-mute after
    -- several were crossed, shouldn't produce a burst of near-identical rows.
    SELECT MAX(t) INTO v_top
      FROM unnest(v_tiers) AS t
     WHERE t <= v_row.month_total
       AND NOT EXISTS (
         SELECT 1 FROM public.milestone_tiers_notified
          WHERE user_id = v_row.user_id AND month_start = v_month AND tier_kobo = t
       );
    CONTINUE WHEN v_top IS NULL;

    -- Record every crossed tier (not just the top one) so the lower ones can
    -- never fire later once the highest has been announced.
    INSERT INTO public.milestone_tiers_notified (user_id, month_start, tier_kobo)
    SELECT v_row.user_id, v_month, t
      FROM unnest(v_tiers) AS t
     WHERE t <= v_row.month_total
    ON CONFLICT (user_id, month_start, tier_kobo) DO NOTHING;

    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'sales_milestone', 'milestone',
      '🎉 Milestone reached!',
      'You''ve recorded ₦' || to_char(v_top, 'FM999,999,990') || ' in sales this month!',
      jsonb_build_object('tab', 'insights'), 'high',
      format('sales_milestone_%s_%s_%s', v_row.user_id, v_top, v_month)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_sales_milestones() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_sales_milestones() TO service_role;

-- ── D1: daily profit summary ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_daily_profit_summary()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    WITH todays_tx AS (
      SELECT *
      FROM public.transactions
      WHERE transaction_date = CURRENT_DATE
        AND NOT (COALESCE(bill_status, '') <> '' OR payment_type = 'bill_payment')
    ),
    revenue_tx AS (
      SELECT * FROM todays_tx
      WHERE type = 'in' AND category IN ('sale', 'credit sale', 'registration_fee', 'withdrawal_fee', 'commission')
    ),
    tx_cogs AS (
      SELECT
        rt.id,
        rt.user_id,
        CASE
          WHEN rt.category IN ('registration_fee', 'withdrawal_fee', 'commission') THEN 0
          WHEN rt.line_items IS NOT NULL AND jsonb_array_length(rt.line_items) > 0 THEN COALESCE((
            SELECT SUM(
              COALESCE(
                NULLIF((li->>'costPrice')::numeric, 0),
                NULLIF((li->>'enteredCostPrice')::numeric, 0),
                CASE WHEN p.needs_costing THEN 0 ELSE p.cost_price END,
                0
              ) * COALESCE((li->>'qty')::numeric, 1)
            )
            FROM jsonb_array_elements(rt.line_items) AS li
            LEFT JOIN public.products p ON p.id = NULLIF(li->>'productId', '')::uuid
          ), 0)
          ELSE
            COALESCE(
              NULLIF(rt.cost_price, 0),
              (SELECT CASE WHEN p2.needs_costing THEN 0 ELSE p2.cost_price END
               FROM public.products p2
               WHERE p2.user_id = rt.user_id AND lower(trim(p2.product_name)) = lower(trim(COALESCE(rt.item_name, '')))
               LIMIT 1),
              0
            ) * COALESCE(rt.quantity, 1)
        END AS cogs
      FROM revenue_tx rt
    ),
    per_user AS (
      SELECT
        t.user_id,
        COUNT(*) FILTER (WHERE t.type = 'in' AND t.category IN ('sale', 'credit sale', 'registration_fee', 'withdrawal_fee', 'commission')) AS sales_count,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'in' AND t.category IN ('sale', 'credit sale', 'registration_fee', 'withdrawal_fee', 'commission')), 0) AS revenue,
        COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'out' AND t.category <> 'stock'), 0) AS expenses,
        COUNT(*) FILTER (WHERE t.category = 'debt repayment') AS repayment_count
      FROM todays_tx t
      GROUP BY t.user_id
    ),
    cogs_by_user AS (
      SELECT user_id, COALESCE(SUM(cogs), 0) AS total_cogs
      FROM tx_cogs
      GROUP BY user_id
    )
    SELECT
      pu.user_id,
      pu.sales_count,
      pu.revenue,
      pu.expenses,
      pu.repayment_count,
      COALESCE(cu.total_cogs, 0) AS cogs
    FROM per_user pu
    LEFT JOIN cogs_by_user cu ON cu.user_id = pu.user_id
    WHERE pu.sales_count > 0
      AND public.notif_pref_allows(pu.user_id, 'money')
  LOOP
    INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
    VALUES (
      v_row.user_id, 'daily_profit_summary', 'money',
      'Today''s profit: ₦' || to_char(GREATEST(v_row.revenue - v_row.cogs - v_row.expenses, 0), 'FM999,999,990.00'),
      v_row.sales_count || ' sale' || CASE WHEN v_row.sales_count = 1 THEN '' ELSE 's' END
        || CASE WHEN v_row.repayment_count > 0
             THEN ' · ' || v_row.repayment_count || ' credit' || CASE WHEN v_row.repayment_count = 1 THEN '' ELSE 's' END || ' repaid'
             ELSE '' END,
      jsonb_build_object('tab', 'insights'), 'high',
      format('daily_profit_summary_%s_%s', v_row.user_id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_daily_profit_summary() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_daily_profit_summary() TO service_role;
