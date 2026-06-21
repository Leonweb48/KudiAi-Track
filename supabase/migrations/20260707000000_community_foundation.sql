-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 1: Foundation, Roles, Invites, Moderation
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Admin helper (no chat_role dependency) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id
      AND (owner_id = auth.uid() OR portal_user_id = auth.uid())
  );
$$;

-- ── Extend org_chat_settings ─────────────────────────────────────────────────

ALTER TABLE public.org_chat_settings
  ADD COLUMN IF NOT EXISTS cover_image_url       text,
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS is_private            boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_verified           boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS disappearing_messages text     DEFAULT 'off'
    CHECK (disappearing_messages IN ('off','24h','7d','30d','90d')),
  ADD COLUMN IF NOT EXISTS chat_locked           boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS anti_spam_enabled     boolean  DEFAULT true,
  ADD COLUMN IF NOT EXISTS forwarding_restricted boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_restricted       boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS screenshot_detection  boolean  DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_members           integer  DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS slow_mode_seconds     integer  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS welcome_message       text;

-- ── Extend org_group_messages ────────────────────────────────────────────────

ALTER TABLE public.org_group_messages
  ADD COLUMN IF NOT EXISTS is_announcement    boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_kept            boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz,
  ADD COLUMN IF NOT EXISTS forwarded_from_id  uuid      REFERENCES public.org_group_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_count         smallint  DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orgmsg_expires   ON public.org_group_messages(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orgmsg_announce  ON public.org_group_messages(org_id, is_announcement)
  WHERE is_announcement = true;
CREATE INDEX IF NOT EXISTS idx_orgmsg_kept      ON public.org_group_messages(org_id, is_kept)
  WHERE is_kept = true;

-- ── Extend org_members ───────────────────────────────────────────────────────

ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS avatar_url        text,
  ADD COLUMN IF NOT EXISTS chat_role         text      DEFAULT 'member'
    CHECK (chat_role IN ('owner','admin','moderator','verified','premium','member')),
  ADD COLUMN IF NOT EXISTS reputation_points integer   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS level             smallint  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS badge_count       smallint  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_count     integer   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_muted          boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS muted_until       timestamptz,
  ADD COLUMN IF NOT EXISTS is_banned         boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS banned_at         timestamptz,
  ADD COLUMN IF NOT EXISTS ban_reason        text,
  ADD COLUMN IF NOT EXISTS last_active_at    timestamptz;

CREATE INDEX IF NOT EXISTS idx_orgmem_reputation ON public.org_members(org_id, reputation_points DESC);
CREATE INDEX IF NOT EXISTS idx_orgmem_level      ON public.org_members(org_id, level DESC);

-- ── Mod-or-above helper (needs chat_role column to exist first) ───────────────

CREATE OR REPLACE FUNCTION public.is_org_mod_or_above(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_org_admin(p_org_id)
      OR EXISTS (
           SELECT 1 FROM public.org_members
           WHERE org_id   = p_org_id
             AND user_id  = auth.uid()
             AND status   = 'active'
             AND chat_role IN ('owner','admin','moderator')
         );
$$;

-- ── Group Invites ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_invites (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  created_by          uuid        NOT NULL,
  code                text        UNIQUE NOT NULL
                                  DEFAULT upper(left(replace(gen_random_uuid()::text,'-',''),8)),
  label               text,
  expires_at          timestamptz,
  max_uses            integer,
  use_count           integer     DEFAULT 0,
  requires_approval   boolean     DEFAULT false,
  is_active           boolean     DEFAULT true,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_invites_org  ON public.group_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_group_invites_code ON public.group_invites(code) WHERE is_active = true;
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invite_select"  ON public.group_invites
  FOR SELECT USING (public.can_access_org_chat(org_id) OR code IS NOT NULL);
CREATE POLICY "invite_manage"  ON public.group_invites
  FOR ALL    USING (public.is_org_mod_or_above(org_id));

-- ── Group Join Requests ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_join_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  invite_id       uuid        REFERENCES public.group_invites(id) ON DELETE SET NULL,
  user_id         uuid        NOT NULL,
  full_name       text        NOT NULL,
  email           text,
  phone           text,
  message         text,
  status          text        DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_joinreq_org    ON public.group_join_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_joinreq_user   ON public.group_join_requests(user_id);
ALTER TABLE public.group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_join_requests REPLICA IDENTITY FULL;

CREATE POLICY "joinreq_read"   ON public.group_join_requests
  FOR SELECT USING (user_id = auth.uid() OR public.is_org_admin(org_id));
CREATE POLICY "joinreq_insert" ON public.group_join_requests
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "joinreq_admin"  ON public.group_join_requests
  FOR UPDATE USING (public.is_org_admin(org_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_join_requests;

-- ── Group Mutes ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_mutes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id    uuid        REFERENCES public.org_members(id) ON DELETE CASCADE NOT NULL,
  muted_by     uuid        NOT NULL,
  reason       text,
  muted_until  timestamptz,
  created_at   timestamptz DEFAULT now(),
  UNIQUE(org_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_group_mutes_org ON public.group_mutes(org_id);
ALTER TABLE public.group_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mutes_admin"      ON public.group_mutes
  FOR ALL    USING (public.is_org_mod_or_above(org_id));
CREATE POLICY "mutes_own_select" ON public.group_mutes
  FOR SELECT USING (
    member_id IN (SELECT id FROM public.org_members WHERE user_id = auth.uid())
  );

-- ── Group Bans ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_bans (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  member_id      uuid        REFERENCES public.org_members(id) ON DELETE SET NULL,
  banned_user_id uuid,
  banned_by      uuid        NOT NULL,
  reason         text,
  expires_at     timestamptz,
  is_permanent   boolean     DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_bans_org  ON public.group_bans(org_id);
CREATE INDEX IF NOT EXISTS idx_group_bans_user ON public.group_bans(banned_user_id);
ALTER TABLE public.group_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bans_admin" ON public.group_bans
  FOR ALL USING (public.is_org_admin(org_id));
CREATE POLICY "bans_own_select" ON public.group_bans
  FOR SELECT USING (banned_user_id = auth.uid());
