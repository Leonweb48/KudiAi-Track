-- ═════════════════════════════════════════════════════════════════════════════
-- Notification redesign — Phase D2: credit due reminder.
--
-- Credit/invoice due dates were 100% manual before this — `credits.status`
-- includes 'overdue' but nothing ever set it; it's computed client-side on
-- every render, and reminders were sent by the owner manually tapping a
-- credit row (pre-built WhatsApp message or copy-to-clipboard). No automated
-- notification existed the morning something actually comes due.
--
-- New cron scans for credits due exactly today (not yet overdue — that's a
-- distinct, already-existing 'overdue' framing) and fires one notification
-- per credit, direct-SQL insert (same pattern as ajo_check_wallet_payout_
-- shortfall, 20270118000000) since this is a pure server-side sweep with
-- no edge-function call needed. Deduped per (credit id, date) so it won't
-- double-fire within a day but does re-fire daily until paid/status changes.
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

-- 7:00am UTC daily (~8am WAT) — "the morning of the due date", per the spec.
SELECT cron.schedule(
  'credit-due-today-reminder',
  '0 7 * * *',
  'SELECT public.credit_check_due_today()'
);
