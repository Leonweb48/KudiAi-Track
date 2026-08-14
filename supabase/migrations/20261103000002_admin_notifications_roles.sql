-- Add role-based targeting to admin_notifications
ALTER TABLE public.admin_notifications
  ADD COLUMN IF NOT EXISTS target_roles TEXT[];

-- ── Update ticket trigger ─────────────────────────────────────────────────
-- Deep-link to the specific ticket; scope to support_admin + super_admin.
CREATE OR REPLACE FUNCTION public.notify_admin_new_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.admin_notifications
    (type, category, title, message, link, target_roles, metadata)
  VALUES (
    'info',
    'ticket',
    'New Support Ticket',
    COALESCE(NEW.subject, 'New ticket submitted'),
    '/support?ticket=' || NEW.id::TEXT,
    ARRAY['support_admin', 'super_admin'],
    jsonb_build_object(
      'ticket_id',  NEW.id,
      'priority',   COALESCE(NEW.priority, 'medium'),
      'user_name',  NEW.user_name,
      'user_email', NEW.user_email,
      'ticket_no',  NEW.ticket_no
    )
  );
  RETURN NEW;
END;
$$;

-- ── Verification submission trigger ──────────────────────────────────────
-- Fires when a Tier-2 verification is submitted; notifies compliance_admin.
CREATE OR REPLACE FUNCTION public.notify_admin_new_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only fire on pending (initial) submissions, not on status updates
  IF NEW.status = 'pending' AND (OLD IS NULL OR OLD.status <> 'pending') THEN
    INSERT INTO public.admin_notifications
      (type, category, title, message, link, target_roles, metadata)
    VALUES (
      'info',
      'user',
      'New Verification Submission',
      COALESCE(NEW.submitted_name, 'A user') || ' submitted Tier-' || NEW.tier::TEXT || ' verification',
      '/verification',
      ARRAY['compliance_admin', 'super_admin'],
      jsonb_build_object(
        'submission_id', NEW.id,
        'user_id',       NEW.user_id,
        'tier',          NEW.tier,
        'submitted_name', NEW.submitted_name
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Create the trigger if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_verification_submission'
      AND tgrelid = 'public.verification_submissions'::regclass
  ) THEN
    CREATE TRIGGER on_verification_submission
      AFTER INSERT OR UPDATE ON public.verification_submissions
      FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_verification();
  END IF;
END;
$$;

-- ── Marketer payout request trigger ──────────────────────────────────────
-- Fires when a marketer submits a payout request; notifies finance_admin.
CREATE OR REPLACE FUNCTION public.notify_admin_new_payout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.admin_notifications
      (type, category, title, message, link, target_roles, metadata)
    VALUES (
      'warning',
      'finance',
      'New Payout Request',
      '₦' || to_char(NEW.amount, 'FM999,999,999') || ' payout from marketer',
      '/finance?tab=payouts',
      ARRAY['finance_admin', 'super_admin'],
      jsonb_build_object(
        'payout_id',      NEW.id,
        'marketer_id',    NEW.marketer_id,
        'amount',         NEW.amount,
        'bank_name',      NEW.bank_name,
        'account_number', NEW.account_number,
        'reference',      NEW.reference
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_marketer_payout_request'
      AND tgrelid = 'public.marketer_payouts'::regclass
  ) THEN
    CREATE TRIGGER on_marketer_payout_request
      AFTER INSERT ON public.marketer_payouts
      FOR EACH ROW EXECUTE FUNCTION public.notify_admin_new_payout();
  END IF;
END;
$$;

-- ── Ticket reply trigger ──────────────────────────────────────────────────
-- When a user adds a comment on an open ticket, notify the assigned admin.
-- Fires on support_ticket_comments or ticket_messages depending on schema.
CREATE OR REPLACE FUNCTION public.notify_admin_ticket_reply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket      RECORD;
  v_admin_id    UUID;
BEGIN
  -- Fetch the parent ticket
  SELECT id, subject, ticket_no, assigned_to, status
    INTO v_ticket
    FROM public.support_tickets
    WHERE id = COALESCE(NEW.ticket_id, NEW.support_ticket_id)
    LIMIT 1;

  -- Only notify if ticket is still open/in-progress
  IF v_ticket.id IS NULL OR v_ticket.status IN ('resolved', 'closed') THEN
    RETURN NEW;
  END IF;

  -- If assigned, notify that admin specifically; otherwise broadcast to support_admin
  IF v_ticket.assigned_to IS NOT NULL THEN
    INSERT INTO public.admin_notifications
      (type, category, title, message, link, target_admin_id, metadata)
    VALUES (
      'info',
      'ticket',
      'User Reply — ' || COALESCE(v_ticket.ticket_no, ''),
      COALESCE(v_ticket.subject, 'A user replied to their ticket'),
      '/support?ticket=' || v_ticket.id::TEXT,
      v_ticket.assigned_to,
      jsonb_build_object('ticket_id', v_ticket.id)
    );
  ELSE
    INSERT INTO public.admin_notifications
      (type, category, title, message, link, target_roles, metadata)
    VALUES (
      'info',
      'ticket',
      'User Reply — ' || COALESCE(v_ticket.ticket_no, ''),
      COALESCE(v_ticket.subject, 'A user replied to their ticket'),
      '/support?ticket=' || v_ticket.id::TEXT,
      ARRAY['support_admin', 'super_admin'],
      jsonb_build_object('ticket_id', v_ticket.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Attach reply trigger to ticket_messages (user replies)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ticket_messages'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_ticket_user_reply'
      AND tgrelid = 'public.ticket_messages'::regclass
  ) THEN
    CREATE TRIGGER on_ticket_user_reply
      AFTER INSERT ON public.ticket_messages
      FOR EACH ROW EXECUTE FUNCTION public.notify_admin_ticket_reply();
  END IF;
END;
$$;

-- Record migration
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000002',
  'admin_notifications_roles',
  ARRAY[
    'ALTER TABLE public.admin_notifications ADD COLUMN IF NOT EXISTS target_roles TEXT[]',
    'CREATE OR REPLACE FUNCTION public.notify_admin_new_ticket()',
    'CREATE OR REPLACE FUNCTION public.notify_admin_new_verification()',
    'CREATE TRIGGER on_verification_submission',
    'CREATE OR REPLACE FUNCTION public.notify_admin_new_payout()',
    'CREATE TRIGGER on_marketer_payout_request',
    'CREATE OR REPLACE FUNCTION public.notify_admin_ticket_reply()',
    'CREATE TRIGGER on_ticket_user_reply'
  ]
)
ON CONFLICT (version) DO NOTHING;
