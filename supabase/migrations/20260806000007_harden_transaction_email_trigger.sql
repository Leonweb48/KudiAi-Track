-- The queue_transaction_email() AFTER INSERT trigger inserts into email_automation_queue.
-- If that insert ever fails (NULL business_name produces a NULL subject which violates
-- NOT NULL, quota exceeded, schema drift, etc.) PostgreSQL rolls back the entire
-- originating transaction INSERT — blocking all cash-in/cash-out for that business.
--
-- Fix: wrap the email queue insert in a BEGIN/EXCEPTION block so trigger failures
-- are silently swallowed. A failed email notification is never worth aborting a
-- real money movement. Also add COALESCE guards on every NOT-NULL column.

CREATE OR REPLACE FUNCTION public.queue_transaction_email()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email  TEXT;
  v_name   TEXT;
  v_biz    TEXT;
  v_amount NUMERIC;
  v_type   TEXT;
BEGIN
  SELECT email, full_name, business_name
    INTO v_email, v_name, v_biz
    FROM profiles WHERE id = NEW.user_id;

  -- Nothing to do if no email on file
  IF v_email IS NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_type   := COALESCE(NEW.type, 'transaction');

  BEGIN
    INSERT INTO email_automation_queue (
      recipient_email, recipient_name, subject, html_body,
      template_type, user_id, user_type, trigger_event, metadata
    ) VALUES (
      v_email,
      COALESCE(v_name, ''),
      CASE
        WHEN v_type IN ('credit', 'income', 'in')
          THEN 'Cash In Recorded — ' || COALESCE(v_biz, 'Your Business')
        ELSE
          'Cash Out Recorded — ' || COALESCE(v_biz, 'Your Business')
      END,
      '<p>Transaction recorded: ' || v_type || ' of ₦' || v_amount || '</p>',
      'transaction_notification',
      NEW.user_id,
      'business',
      'transaction_insert',
      jsonb_build_object('amount', v_amount, 'type', v_type, 'transaction_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never let an email-queue failure abort a real transaction insert.
    -- The failure is silent here; the JS layer sends its own transaction_failed
    -- email trigger only when the INSERT itself fails, which it now won't.
    NULL;
  END;

  RETURN NEW;
END;
$$;
