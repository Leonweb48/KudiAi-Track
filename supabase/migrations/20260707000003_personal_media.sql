-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 4: Personal Features & Media Hub
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Saved Messages (per user) ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_saved_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id  uuid        REFERENCES public.org_group_messages(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid        NOT NULL,
  note        text,
  saved_at    timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_msgs_user ON public.group_saved_messages(user_id, org_id);
ALTER TABLE public.group_saved_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_own" ON public.group_saved_messages
  FOR ALL USING (user_id = auth.uid());

-- ── Starred Messages (per user) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_starred_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id  uuid        REFERENCES public.org_group_messages(id) ON DELETE CASCADE NOT NULL,
  user_id     uuid        NOT NULL,
  starred_at  timestamptz DEFAULT now(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_starred_msgs_user ON public.group_starred_messages(user_id, org_id);
ALTER TABLE public.group_starred_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "starred_own" ON public.group_starred_messages
  FOR ALL USING (user_id = auth.uid());

-- ── Kept Messages (admin-curated) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_kept_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id  uuid        REFERENCES public.org_group_messages(id) ON DELETE CASCADE NOT NULL,
  kept_by     uuid        NOT NULL,
  note        text,
  kept_at     timestamptz DEFAULT now(),
  UNIQUE(message_id)
);

CREATE INDEX IF NOT EXISTS idx_kept_msgs_org ON public.group_kept_messages(org_id, kept_at DESC);
ALTER TABLE public.group_kept_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kept_select"  ON public.group_kept_messages
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "kept_manage"  ON public.group_kept_messages
  FOR ALL    USING (public.is_org_mod_or_above(org_id));

-- ── Media Hub (indexed media for photos/videos/docs/links/audio tabs) ──────────

CREATE TABLE IF NOT EXISTS public.group_media (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id   uuid        REFERENCES public.org_group_messages(id) ON DELETE CASCADE,
  sender_id    uuid        NOT NULL,
  sender_name  text        NOT NULL,
  media_type   text        NOT NULL
                           CHECK (media_type IN ('photo','video','audio','document','link')),
  url          text        NOT NULL,
  thumbnail_url text,
  file_name    text,
  file_size    bigint,
  mime_type    text,
  duration     integer,                    -- seconds, for audio/video
  width        integer,                    -- px, for photos/videos
  height       integer,
  link_title   text,                       -- for link previews
  link_domain  text,
  storage_path text,                       -- Supabase Storage path
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_org_type    ON public.group_media(org_id, media_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_sender      ON public.group_media(org_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_media_message     ON public.group_media(message_id);

-- Full-text search on file names and link titles
CREATE INDEX IF NOT EXISTS idx_media_fts ON public.group_media
  USING gin(to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(link_title,'')));

ALTER TABLE public.group_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_select"  ON public.group_media
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "media_insert"  ON public.group_media
  FOR INSERT WITH CHECK (sender_id = auth.uid() AND public.can_access_org_chat(org_id));
CREATE POLICY "media_delete"  ON public.group_media
  FOR DELETE USING (sender_id = auth.uid() OR public.is_org_mod_or_above(org_id));

-- ── Message Search Index (FTS on content) ────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_orgmsg_fts ON public.org_group_messages
  USING gin(to_tsvector('english', coalesce(content,'')))
  WHERE is_deleted = false;

-- ── Helper: search messages ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_group_messages(
  p_org_id   uuid,
  p_query    text,
  p_type     text    DEFAULT NULL,
  p_sender   uuid    DEFAULT NULL,
  p_from     timestamptz DEFAULT NULL,
  p_to       timestamptz DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS SETOF public.org_group_messages
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM public.org_group_messages
  WHERE org_id     = p_org_id
    AND is_deleted = false
    AND (p_query   IS NULL OR to_tsvector('english', coalesce(content,'')) @@ plainto_tsquery('english', p_query))
    AND (p_type    IS NULL OR type = p_type)
    AND (p_sender  IS NULL OR sender_id = p_sender)
    AND (p_from    IS NULL OR created_at >= p_from)
    AND (p_to      IS NULL OR created_at <= p_to)
    AND public.can_access_org_chat(org_id)
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ── Helper: search media ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_group_media(
  p_org_id     uuid,
  p_query      text    DEFAULT NULL,
  p_media_type text    DEFAULT NULL,
  p_sender     uuid    DEFAULT NULL,
  p_from       timestamptz DEFAULT NULL,
  p_to         timestamptz DEFAULT NULL,
  p_limit      integer DEFAULT 50,
  p_offset     integer DEFAULT 0
)
RETURNS SETOF public.group_media
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT * FROM public.group_media
  WHERE org_id = p_org_id
    AND (p_media_type IS NULL OR media_type = p_media_type)
    AND (p_sender     IS NULL OR sender_id  = p_sender)
    AND (p_from       IS NULL OR created_at >= p_from)
    AND (p_to         IS NULL OR created_at <= p_to)
    AND (p_query      IS NULL OR
         to_tsvector('english', coalesce(file_name,'') || ' ' || coalesce(link_title,''))
         @@ plainto_tsquery('english', p_query))
    AND public.can_access_org_chat(org_id)
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

-- ── Trigger: auto-index media when a message with media is inserted ───────────

CREATE OR REPLACE FUNCTION public.auto_index_group_media()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.media_url IS NOT NULL AND NOT NEW.is_deleted THEN
    INSERT INTO public.group_media (
      org_id, message_id, sender_id, sender_name,
      media_type, url, file_name, mime_type, duration
    )
    VALUES (
      NEW.org_id,
      NEW.id,
      NEW.sender_id,
      NEW.sender_name,
      CASE NEW.type
        WHEN 'image' THEN 'photo'
        WHEN 'audio' THEN 'audio'
        WHEN 'file'  THEN 'document'
        ELSE 'document'
      END,
      NEW.media_url,
      NEW.media_name,
      NEW.media_mime,
      NEW.duration
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_index_media ON public.org_group_messages;
CREATE TRIGGER trg_auto_index_media
  AFTER INSERT ON public.org_group_messages
  FOR EACH ROW
  WHEN (NEW.media_url IS NOT NULL AND NEW.type IN ('image','audio','file'))
  EXECUTE FUNCTION public.auto_index_group_media();
