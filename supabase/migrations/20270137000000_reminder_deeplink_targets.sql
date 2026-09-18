-- ═════════════════════════════════════════════════════════════════════════════
-- Notification deep links — give the two SQL reminders a real target.
--
-- Tapping a notification previously landed on the right tab and stopped: the
-- destination screens never received the record/sub-section to open. That's
-- fixed in the app (src/utils/deepLinkBus.js); these two cron notifiers just
-- need to say what to open.
--
-- credit_due_today: sub 'credit' + action 'remind' → Credit opens the
--   payment-reminder sheet for that debtor (the action its body nudges).
-- ajo_collection_reminder: sub 'clients' — explicit so the Ajo screen doesn't
--   apply its "no sub → jump to stuck payouts" fallback, which is meant for the
--   payout-failed / balance-shortfall alerts, not this.
--
-- Bodies are unchanged from 20270136000000 (including the notif_pref_allows
-- gate) — only deep_link differs.
-- ═════════════════════════════════════════════════════════════════════════════

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
      jsonb_build_object('tab', 'finance', 'sub', 'credit', 'id', v_row.id, 'action', 'remind'), 'high',
      format('credit_due_today_%s_%s', v_row.id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.credit_check_due_today() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.credit_check_due_today() TO service_role;

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
      jsonb_build_object('tab', 'aso', 'sub', 'clients'), 'high',
      format('ajo_collection_reminder_%s_%s', v_row.user_id, CURRENT_DATE)
    )
    ON CONFLICT (dedupe_key) WHERE read_at IS NULL AND dedupe_key IS NOT NULL DO NOTHING;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.ajo_check_collection_reminder() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ajo_check_collection_reminder() TO service_role;
