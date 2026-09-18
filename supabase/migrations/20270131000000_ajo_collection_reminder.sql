-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase D4: Ajo/Esusu collection reminder.
--
-- No automated reminder existed for this at all before — TodaysCollection.jsx
-- is a staff/owner-facing dashboard LIST (filters aso_clients where
-- next_contribution_date <= today), not a notification. This cron aggregates
-- that same condition per owner and fires one rolled-up notification each
-- collection morning: "Collect from N clients today · ₦X expected" — matching
-- the spec's example exactly. Direct-SQL insert (ajo_check_wallet_payout_
-- shortfall pattern) since it's a pure sweep, no edge-function call needed.
-- ═════════════════════════════════════════════════════════════════════════════

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

-- 6:30am UTC daily (~7:30am WAT) — early enough for the owner/agent to plan
-- their collection round for the day.
SELECT cron.schedule(
  'ajo-collection-reminder',
  '30 6 * * *',
  'SELECT public.ajo_check_collection_reminder()'
);
