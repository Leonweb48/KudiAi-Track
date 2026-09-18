-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase D1: daily profit summary push, fixed 8PM WAT.
--
-- The existing "daily_summary" email (src/hooks/useStore.js) is NOT
-- server-side/cron-driven — it's a client-side, on-app-load, once-per-day
-- check that reuses the exact same profit engine (src/lib/profitEngine.js)
-- as the Home screen's "Today's Profit" figure, but it only fires whenever
-- the owner happens to open the app that day, at whatever time that is —
-- it cannot guarantee "fires at 8PM." pg_cron has no JS runtime, so a true
-- fixed-time push needs a genuine server-side computation.
--
-- This is DELIBERATELY a simplified subset of profitEngine.js's full R1-R7
-- derivation, not a port of it — no invoice-linked COGS splitting, no
-- interest-earned allocation, no Ajo-ledger service income, and (unlike the
-- JS engine's "unmeasured" concept, which excludes uncosted revenue from
-- profit entirely) an item with no cost-price snapshot and no costed
-- product match is treated as zero COGS rather than excluded — so for a
-- business with meaningful uncosted/unnamed sales, invoice income, or Ajo
-- commissions, this push's figure will read a little HIGH versus the
-- in-app "Today's Profit" card. Acceptable for a heads-up notification;
-- never treat it as a source of truth. Only fires if there was at least
-- one sale today (mirrors the email's "don't report a silent day" gate).
-- ═════════════════════════════════════════════════════════════════════════════

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

-- Fixed 19:00 UTC = 8PM WAT for every owner, per the confirmed scope
-- decision (per-user configurable time deferred to a later phase).
SELECT cron.schedule(
  'daily-profit-summary-push',
  '0 19 * * *',
  'SELECT public.check_daily_profit_summary()'
);
