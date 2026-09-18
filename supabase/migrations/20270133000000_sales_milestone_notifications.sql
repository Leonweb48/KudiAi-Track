-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase D5: sales milestone notifications.
--
-- Nothing like this existed before — the only prior "milestone" cron
-- reference in this codebase (check_milestones_all(), mentioned in an old
-- migration comment) was never actually registered; confirmed not live.
--
-- Unlike D2/D3/D4 (point-in-time threshold checks), a milestone is a
-- crossing event against a MOVING cumulative total — firing every day the
-- total stays above a tier would spam the owner for the rest of the month.
-- notifications.dedupe_key only prevents duplicates while UNREAD (the
-- partial-unique-index/full-unique-constraint pattern used everywhere else
-- in this file), which isn't enough here: if the owner reads today's
-- milestone notification, tomorrow's sweep would insert a fresh one for the
-- same already-crossed tier. New milestone_tiers_notified table gives a
-- permanent (not read-state-dependent) per-owner-per-month-per-tier marker.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.milestone_tiers_notified (
  user_id      uuid        NOT NULL,
  month_start  date        NOT NULL,
  tier_kobo    bigint      NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month_start, tier_kobo)
);

REVOKE ALL ON public.milestone_tiers_notified FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.milestone_tiers_notified TO service_role;

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
  v_tier   NUMERIC;
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
    FOREACH v_tier IN ARRAY v_tiers LOOP
      CONTINUE WHEN v_row.month_total < v_tier;
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.milestone_tiers_notified
        WHERE user_id = v_row.user_id AND month_start = v_month AND tier_kobo = v_tier
      );

      INSERT INTO public.milestone_tiers_notified (user_id, month_start, tier_kobo)
      VALUES (v_row.user_id, v_month, v_tier)
      ON CONFLICT (user_id, month_start, tier_kobo) DO NOTHING;

      INSERT INTO public.notifications (user_id, type, category, title, body, deep_link, priority, dedupe_key)
      VALUES (
        v_row.user_id, 'sales_milestone', 'milestone',
        '🎉 Milestone reached!',
        'You''ve recorded ₦' || to_char(v_tier, 'FM999,999,990') || ' in sales this month!',
        jsonb_build_object('tab', 'insights'), 'high',
        format('sales_milestone_%s_%s_%s', v_row.user_id, v_tier, v_month)
      )
      ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_sales_milestones() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_sales_milestones() TO service_role;

-- 6:15am UTC daily (~7:15am WAT) — after the previous day's activity has
-- fully settled.
SELECT cron.schedule(
  'sales-milestone-check',
  '15 6 * * *',
  'SELECT public.check_sales_milestones()'
);
