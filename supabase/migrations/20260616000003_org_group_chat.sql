-- ══════════════════════════════════════════════════════════
--  ORG GROUP CHAT
--  WhatsApp-style real-time group messaging for org members
-- ══════════════════════════════════════════════════════════

-- ─── Messages ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_group_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  sender_id        uuid        NOT NULL,
  sender_name      text        NOT NULL,
  sender_role      text        DEFAULT 'member',
  content          text,
  type             text        DEFAULT 'text' CHECK (type IN ('text','image','audio','file','system')),
  media_url        text,
  media_name       text,
  media_mime       text,
  duration         integer,                           -- audio length in seconds
  reply_to_id      uuid        REFERENCES public.org_group_messages(id) ON DELETE SET NULL,
  reply_to_content text,                             -- snapshot at send time
  reply_to_sender  text,
  is_edited        boolean     DEFAULT false,
  edited_at        timestamptz,
  is_deleted       boolean     DEFAULT false,
  pinned           boolean     DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

-- ─── Reactions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_message_reactions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid        REFERENCES public.org_group_messages(id) ON DELETE CASCADE NOT NULL,
  org_id     uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  user_name  text        NOT NULL,
  emoji      text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

-- ─── Per-user read-cursor ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_chat_reads (
  user_id      uuid        NOT NULL,
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  last_read_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

-- ─── Indexes ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orgmsg_org_created  ON public.org_group_messages(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orgrxn_message      ON public.org_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_orgrxn_org          ON public.org_message_reactions(org_id);
CREATE INDEX IF NOT EXISTS idx_orgread_org         ON public.org_chat_reads(org_id);

-- ─── Replica identity for realtime DELETE payloads ───────
ALTER TABLE public.org_group_messages    REPLICA IDENTITY FULL;
ALTER TABLE public.org_message_reactions REPLICA IDENTITY FULL;

-- ─── RLS ─────────────────────────────────────────────────
ALTER TABLE public.org_group_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_chat_reads        ENABLE ROW LEVEL SECURITY;

-- helper: can the current user access messages for this org?
-- (active member OR owner OR portal user)
CREATE OR REPLACE FUNCTION public.can_access_org_chat(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id AND (owner_id = auth.uid() OR portal_user_id = auth.uid())
  );
$$;

-- Messages
CREATE POLICY "chat_msg_select" ON public.org_group_messages
  FOR SELECT USING (public.can_access_org_chat(org_id));

CREATE POLICY "chat_msg_insert" ON public.org_group_messages
  FOR INSERT WITH CHECK (sender_id = auth.uid() AND public.can_access_org_chat(org_id));

CREATE POLICY "chat_msg_update" ON public.org_group_messages
  FOR UPDATE USING (sender_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.organizations WHERE id = org_id AND (owner_id = auth.uid() OR portal_user_id = auth.uid())
  ));

CREATE POLICY "chat_msg_delete" ON public.org_group_messages
  FOR DELETE USING (sender_id = auth.uid());

-- Reactions
CREATE POLICY "chat_rxn_select" ON public.org_message_reactions
  FOR SELECT USING (public.can_access_org_chat(org_id));

CREATE POLICY "chat_rxn_insert" ON public.org_message_reactions
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.can_access_org_chat(org_id));

CREATE POLICY "chat_rxn_delete" ON public.org_message_reactions
  FOR DELETE USING (user_id = auth.uid());

-- Reads
CREATE POLICY "chat_reads_own" ON public.org_chat_reads
  FOR ALL USING (user_id = auth.uid());

-- ─── Realtime ────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.org_group_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.org_message_reactions;
