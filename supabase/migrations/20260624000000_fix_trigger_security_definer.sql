-- Fix trigger functions that insert into service-role-only tables.
-- Without SECURITY DEFINER, triggers run as the calling user (e.g. staff),
-- which has no permission to write to email_automation_queue or admin_notifications.

CREATE OR REPLACE FUNCTION queue_transaction_email()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_name  TEXT;
  v_biz   TEXT;
  v_amount NUMERIC;
  v_type  TEXT;
BEGIN
  SELECT email, full_name, business_name
    INTO v_email, v_name, v_biz
    FROM profiles WHERE id = NEW.user_id;

  IF v_email IS NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_type   := COALESCE(NEW.type, 'transaction');

  INSERT INTO email_automation_queue (
    recipient_email, recipient_name, subject, html_body,
    template_type, user_id, user_type, trigger_event, metadata
  ) VALUES (
    v_email, v_name,
    CASE
      WHEN v_type IN ('credit','income','in') THEN 'Cash In Recorded — ' || v_biz
      ELSE 'Cash Out Recorded — ' || v_biz
    END,
    '<p>Transaction recorded: ' || v_type || ' of ₦' || v_amount || '</p>',
    'transaction_notification', NEW.user_id, 'business', 'transaction_insert',
    jsonb_build_object('amount', v_amount, 'type', v_type, 'transaction_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_admin_new_ticket()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, category, title, message, link, metadata)
  VALUES (
    'info', 'ticket',
    'New Support Ticket: ' || COALESCE(NEW.ticket_number, 'KT-NEW'),
    COALESCE(NEW.subject, 'New ticket submitted'),
    '/support',
    jsonb_build_object('ticket_id', NEW.id, 'priority', NEW.priority, 'user_type', NEW.user_type)
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_admin_security_event()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.action IN ('login_failed','password_changed','role_changed','admin_deleted','2fa_disabled') THEN
    INSERT INTO admin_notifications (type, category, title, message, link, metadata)
    VALUES (
      'warning', 'security',
      'Security Event: ' || REPLACE(NEW.action, '_', ' '),
      'Action by ' || COALESCE(NEW.admin_username, 'unknown') || ': ' || COALESCE(NEW.details, ''),
      '/security',
      jsonb_build_object('action', NEW.action, 'admin_id', NEW.admin_id, 'target_id', NEW.target_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION handle_claim_approval()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    UPDATE profiles
    SET marketer_id = NEW.marketer_id
    WHERE id = NEW.business_id;

    INSERT INTO admin_notifications(type, category, title, message, link)
    VALUES (
      'success', 'finance',
      'Business Claim Approved',
      'Marketer claim for ' || COALESCE(NEW.business_name, 'a business') || ' was approved. Commission will be calculated.',
      '/commissions'
    );
  END IF;
  RETURN NEW;
END;
$$;
