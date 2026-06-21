-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 5: Moderation, Reports & Audit Logs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Content Reports ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  reported_by     uuid        NOT NULL,
  reporter_name   text        NOT NULL,
  target_type     text        NOT NULL
                              CHECK (target_type IN ('message','member','media','poll','event')),
  target_id       uuid        NOT NULL,
  category        text        NOT NULL
                              CHECK (category IN (
                                'spam','harassment','hate_speech','misinformation',
                                'inappropriate_content','impersonation','violence','other'
                              )),
  description     text,
  status          text        DEFAULT 'pending'
                              CHECK (status IN ('pending','reviewed','resolved','dismissed')),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  resolution_note text,
  action_taken    text
                              CHECK (action_taken IN (
                                'no_action','warned','muted','banned','message_deleted','content_removed',NULL
                              )),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_org     ON public.group_reports(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target  ON public.group_reports(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_reports_by      ON public.group_reports(reported_by);
ALTER TABLE public.group_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_reports REPLICA IDENTITY FULL;

CREATE POLICY "report_submit"     ON public.group_reports
  FOR INSERT WITH CHECK (reported_by = auth.uid() AND public.can_access_org_chat(org_id));
CREATE POLICY "report_own_read"   ON public.group_reports
  FOR SELECT USING (reported_by = auth.uid() OR public.is_org_mod_or_above(org_id));
CREATE POLICY "report_admin"      ON public.group_reports
  FOR UPDATE USING (public.is_org_mod_or_above(org_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_reports;

-- ── Audit Logs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_audit_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  actor_id     uuid,
  actor_name   text,
  action       text        NOT NULL,
  target_type  text,
  target_id    uuid,
  target_name  text,
  details      jsonb       DEFAULT '{}',
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz DEFAULT now()
);

-- Partition-friendly index: query by org + time
CREATE INDEX IF NOT EXISTS idx_audit_org_time  ON public.group_audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON public.group_audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON public.group_audit_logs(org_id, action);
ALTER TABLE public.group_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_admin_read" ON public.group_audit_logs
  FOR SELECT USING (public.is_org_admin(org_id));

-- Only the system (SECURITY DEFINER functions) may insert audit logs
-- No INSERT policy = no direct client inserts

-- ── Audit Log Writer (callable from other triggers) ───────────────────────────

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_org_id      uuid,
  p_actor_id    uuid,
  p_actor_name  text,
  p_action      text,
  p_target_type text  DEFAULT NULL,
  p_target_id   uuid  DEFAULT NULL,
  p_target_name text  DEFAULT NULL,
  p_details     jsonb DEFAULT '{}'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.group_audit_logs (
    org_id, actor_id, actor_name, action,
    target_type, target_id, target_name, details
  ) VALUES (
    p_org_id, p_actor_id, p_actor_name, p_action,
    p_target_type, p_target_id, p_target_name, p_details
  );
END;
$$;

-- ── Audit trigger: member banned ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_on_ban()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.org_id,
    NEW.banned_by,
    NULL,
    'member_banned',
    'member',
    NEW.member_id,
    NULL,
    jsonb_build_object('reason', NEW.reason, 'permanent', NEW.is_permanent)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_ban ON public.group_bans;
CREATE TRIGGER trg_audit_ban
  AFTER INSERT ON public.group_bans
  FOR EACH ROW EXECUTE FUNCTION public.audit_on_ban();

-- ── Audit trigger: member muted ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_on_mute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.org_id,
    NEW.muted_by,
    NULL,
    'member_muted',
    'member',
    NEW.member_id,
    NULL,
    jsonb_build_object('reason', NEW.reason, 'until', NEW.muted_until)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_mute ON public.group_mutes;
CREATE TRIGGER trg_audit_mute
  AFTER INSERT ON public.group_mutes
  FOR EACH ROW EXECUTE FUNCTION public.audit_on_mute();

-- ── Audit trigger: message deleted ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_on_msg_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.is_deleted = false AND NEW.is_deleted = true THEN
    PERFORM public.log_audit_event(
      NEW.org_id,
      auth.uid(),
      NULL,
      'message_deleted',
      'message',
      NEW.id,
      NULL,
      jsonb_build_object('sender', NEW.sender_name, 'preview', left(coalesce(OLD.content,''),80))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_msg_delete ON public.org_group_messages;
CREATE TRIGGER trg_audit_msg_delete
  AFTER UPDATE ON public.org_group_messages
  FOR EACH ROW EXECUTE FUNCTION public.audit_on_msg_delete();

-- ── Audit trigger: join request reviewed ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_on_join_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    PERFORM public.log_audit_event(
      NEW.org_id,
      NEW.reviewed_by,
      NULL,
      'join_request_' || NEW.status,
      'member',
      NULL,
      NEW.full_name,
      jsonb_build_object('email', NEW.email, 'reason', NEW.reject_reason)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_joinreq ON public.group_join_requests;
CREATE TRIGGER trg_audit_joinreq
  AFTER UPDATE ON public.group_join_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_on_join_request();

-- ── Spam guard: enforce slow-mode ────────────────────────────────────────────
-- (Called from application layer — RPC exposed for validation)

CREATE OR REPLACE FUNCTION public.check_slow_mode(p_org_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT CASE
    WHEN s.slow_mode_seconds IS NULL OR s.slow_mode_seconds = 0 THEN true
    ELSE (
      SELECT coalesce(max(created_at), '1970-01-01') + (s.slow_mode_seconds || ' seconds')::interval < now()
      FROM public.org_group_messages
      WHERE org_id = p_org_id AND sender_id = p_user_id
    )
  END
  FROM public.org_chat_settings s
  WHERE s.org_id = p_org_id;
$$;
