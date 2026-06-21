-- ═══════════════════════════════════════════════════════════════
--  IN-APP NOTIFICATION SYSTEM FOR ORG & MEMBER PORTALS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.coop_notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- null = org-level notification (recipient_type = 'org')
  recipient_id    uuid        REFERENCES public.org_members(id) ON DELETE CASCADE,
  recipient_type  text        NOT NULL DEFAULT 'member' CHECK (recipient_type IN ('member', 'org')),
  type            text        NOT NULL DEFAULT 'info'
                              CHECK (type IN ('info', 'success', 'warning', 'error', 'alert')),
  category        text        NOT NULL DEFAULT 'system'
                              CHECK (category IN ('loan', 'broadcast', 'program', 'finance', 'member', 'system')),
  title           text        NOT NULL,
  body            text        NOT NULL DEFAULT '',
  action_tab      text,       -- tab to navigate to on tap: loans | finance | contributions | broadcast | members | programs
  metadata        jsonb       DEFAULT '{}',
  is_read         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast filtered reads
CREATE INDEX IF NOT EXISTS coop_notifs_org_idx      ON public.coop_notifications (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coop_notifs_member_idx   ON public.coop_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS coop_notifs_unread_idx   ON public.coop_notifications (org_id, recipient_type, is_read);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE public.coop_notifications ENABLE ROW LEVEL SECURITY;

-- Service role: full access (edge functions insert)
CREATE POLICY "coop_notif_service_all" ON public.coop_notifications
  FOR ALL USING (true) WITH CHECK (true);

-- Members: read their own notifications
DROP POLICY IF EXISTS "coop_notif_member_read" ON public.coop_notifications;
CREATE POLICY "coop_notif_member_read" ON public.coop_notifications
  FOR SELECT
  USING (
    recipient_type = 'member'
    AND recipient_id IN (
      SELECT id FROM public.org_members WHERE user_id = auth.uid()
    )
  );

-- Members: update (mark read) their own
DROP POLICY IF EXISTS "coop_notif_member_update" ON public.coop_notifications;
CREATE POLICY "coop_notif_member_update" ON public.coop_notifications
  FOR UPDATE
  USING (
    recipient_type = 'member'
    AND recipient_id IN (
      SELECT id FROM public.org_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- Org portal or owner: read org-level notifications
DROP POLICY IF EXISTS "coop_notif_org_read" ON public.coop_notifications;
CREATE POLICY "coop_notif_org_read" ON public.coop_notifications
  FOR SELECT
  USING (
    recipient_type = 'org'
    AND org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  );

-- Org portal or owner: mark org notifications read
DROP POLICY IF EXISTS "coop_notif_org_update" ON public.coop_notifications;
CREATE POLICY "coop_notif_org_update" ON public.coop_notifications
  FOR UPDATE
  USING (
    recipient_type = 'org'
    AND org_id IN (
      SELECT id FROM public.organizations
      WHERE owner_id = auth.uid() OR portal_user_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- ── Enable Realtime ────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.coop_notifications;
