-- Fix notify_admin_ticket_reply: ticket_messages uses ticket_id (not support_ticket_id)
-- Also restore the em-dash that was mangled during the initial migration write.
CREATE OR REPLACE FUNCTION public.notify_admin_ticket_reply()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket   RECORD;
BEGIN
  SELECT id, subject, ticket_no, assigned_to, status
    INTO v_ticket
    FROM public.support_tickets
   WHERE id = NEW.ticket_id
   LIMIT 1;

  -- Skip if ticket is closed or we could not find it
  IF v_ticket.id IS NULL OR v_ticket.status IN ('resolved', 'closed') THEN
    RETURN NEW;
  END IF;

  IF v_ticket.assigned_to IS NOT NULL THEN
    INSERT INTO public.admin_notifications
      (type, category, title, message, link, target_admin_id, metadata)
    VALUES (
      'info', 'ticket',
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
      'info', 'ticket',
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

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (
  '20261103000004',
  'fix_ticket_reply_trigger',
  ARRAY['CREATE OR REPLACE FUNCTION public.notify_admin_ticket_reply()']
)
ON CONFLICT (version) DO NOTHING;
