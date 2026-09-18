-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase D3: low-stock daily sweep.
--
-- Low-stock notifications already fire client-side (useInventory.js) at the
-- exact moment a sale/restock crosses low_stock_threshold downward — that
-- stays untouched. Gap: a product that enters a low state via a
-- non-transactional path (a manual quantity edit, a correction, a bulk
-- import) never crosses that trigger and was never caught. This cron sweeps
-- once daily for anything currently at/below its threshold, using the exact
-- same 'low_stock' type + 'stock' category the client-side path already
-- produces (so the drawer/push can't tell which mechanism fired it — they're
-- the same event, just two different ways of detecting it), deduped per
-- product per day so a product that's been low for a week doesn't get 7
-- identical unread rows, but a fresh reminder does land each day it's still
-- unresolved.
-- ═════════════════════════════════════════════════════════════════════════════

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

-- 6:00am UTC daily (~7am WAT) — before the business day starts.
SELECT cron.schedule(
  'stock-low-daily-sweep',
  '0 6 * * *',
  'SELECT public.stock_check_low_daily()'
);
