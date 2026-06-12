-- ============================================================
-- Admin Notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_admin_id UUID, -- NULL = broadcast to all admins
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  category TEXT NOT NULL DEFAULT 'system'
    CHECK (category IN ('system','user','security','finance','support','ticket','audit')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  metadata JSONB,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notifs_target ON admin_notifications(target_admin_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifs_broadcast ON admin_notifications(is_read, created_at DESC)
  WHERE target_admin_id IS NULL;

-- ============================================================
-- Platform-wide notification log (cross-portal activity feed)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_type TEXT CHECK (user_type IN ('business','staff','ajo_client','org_member','marketer','admin','super_admin')),
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('auth','profile','transaction','ajo','org','staff','inventory','support','system','general')),
  description TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_activity_user ON platform_activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_activity_type ON platform_activity_log(user_type, category, created_at DESC);

-- ============================================================
-- Automated email queue (enhanced from welcome_email_queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_automation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  template_type TEXT NOT NULL DEFAULT 'custom',
  user_id UUID,
  user_type TEXT,
  trigger_event TEXT,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts INT DEFAULT 0,
  last_error TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_automation_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_user ON email_automation_queue(user_id, trigger_event);

-- ============================================================
-- Support tickets: add assignment + auto-ticket-number
-- ============================================================
ALTER TABLE IF EXISTS support_tickets
  ADD COLUMN IF NOT EXISTS ticket_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS assigned_admin_id UUID,
  ADD COLUMN IF NOT EXISTS assigned_admin_username TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_type TEXT DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS portal TEXT DEFAULT 'business';

-- Auto-generate ticket numbers
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  seq_val INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 4) AS INT)), 0) + 1
    INTO seq_val FROM support_tickets WHERE ticket_number IS NOT NULL;
  NEW.ticket_number := 'KT-' || LPAD(seq_val::TEXT, 6, '0');
  -- SLA: 24h for normal, 4h for high/critical
  IF NEW.priority IN ('high','critical') THEN
    NEW.sla_due_at := now() + INTERVAL '4 hours';
  ELSE
    NEW.sla_due_at := now() + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_number ON support_tickets;
CREATE TRIGGER trg_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW WHEN (NEW.ticket_number IS NULL)
  EXECUTE FUNCTION generate_ticket_number();

-- Auto-notify admin when new support ticket created
CREATE OR REPLACE FUNCTION notify_admin_new_ticket()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_new_ticket_notify ON support_tickets;
CREATE TRIGGER trg_new_ticket_notify
  AFTER INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION notify_admin_new_ticket();

-- ============================================================
-- Business transaction email triggers
-- ============================================================
CREATE OR REPLACE FUNCTION queue_transaction_email()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_email TEXT;
  v_name TEXT;
  v_biz TEXT;
  v_amount NUMERIC;
  v_type TEXT;
BEGIN
  -- Get user profile
  SELECT email, full_name, business_name
    INTO v_email, v_name, v_biz
    FROM profiles WHERE id = NEW.user_id;

  IF v_email IS NULL THEN RETURN NEW; END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_type := COALESCE(NEW.type, 'transaction');

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

-- Only create trigger if transactions table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transactions') THEN
    DROP TRIGGER IF EXISTS trg_transaction_email ON transactions;
    CREATE TRIGGER trg_transaction_email
      AFTER INSERT ON transactions
      FOR EACH ROW EXECUTE FUNCTION queue_transaction_email();
  END IF;
END $$;

-- ============================================================
-- Security alert notification for admin
-- ============================================================
CREATE OR REPLACE FUNCTION notify_admin_security_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_security_notify ON admin_audit_log;
CREATE TRIGGER trg_security_notify
  AFTER INSERT ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION notify_admin_security_event();

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_automation_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (admin APIs use service role)
CREATE POLICY "service_role_all_notifs" ON admin_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_activity" ON platform_activity_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_email_queue" ON email_automation_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
