-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 2: Announcements, Events, Polls, Milestones
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Group Announcements ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_announcements (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id   uuid        REFERENCES public.org_group_messages(id) ON DELETE SET NULL,
  created_by   uuid        NOT NULL,
  title        text        NOT NULL,
  content      text        NOT NULL,
  media_url    text,
  media_type   text,
  is_pinned    boolean     DEFAULT false,
  expires_at   timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org ON public.group_announcements(org_id, created_at DESC);
ALTER TABLE public.group_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_announcements REPLICA IDENTITY FULL;

CREATE POLICY "announce_select" ON public.group_announcements
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "announce_manage" ON public.group_announcements
  FOR ALL    USING (public.is_org_mod_or_above(org_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_announcements;

-- ── Group Events ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  created_by      uuid        NOT NULL,
  title           text        NOT NULL,
  description     text,
  cover_image_url text,
  location        text,
  location_url    text,
  start_time      timestamptz NOT NULL,
  end_time        timestamptz,
  is_online       boolean     DEFAULT false,
  meeting_url     text,
  max_attendees   integer,
  rsvp_count      integer     DEFAULT 0,
  is_cancelled    boolean     DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_org      ON public.group_events(org_id, start_time);
CREATE INDEX IF NOT EXISTS idx_events_upcoming ON public.group_events(org_id, start_time)
  WHERE is_cancelled = false;
ALTER TABLE public.group_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select" ON public.group_events
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "events_manage" ON public.group_events
  FOR ALL    USING (public.is_org_mod_or_above(org_id));

-- ── Event RSVPs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_event_rsvps (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid        REFERENCES public.group_events(id) ON DELETE CASCADE NOT NULL,
  org_id     uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  member_id  uuid        REFERENCES public.org_members(id) ON DELETE CASCADE,
  status     text        DEFAULT 'going'
             CHECK (status IN ('going','maybe','not_going')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON public.group_event_rsvps(event_id);
ALTER TABLE public.group_event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rsvp_select"  ON public.group_event_rsvps
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "rsvp_own"     ON public.group_event_rsvps
  FOR ALL    USING (user_id = auth.uid());

-- Auto-update rsvp_count on group_events
CREATE OR REPLACE FUNCTION public.update_event_rsvp_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.group_events
  SET rsvp_count = (
    SELECT count(*) FROM public.group_event_rsvps
    WHERE event_id = COALESCE(NEW.event_id, OLD.event_id) AND status = 'going'
  )
  WHERE id = COALESCE(NEW.event_id, OLD.event_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rsvp_count ON public.group_event_rsvps;
CREATE TRIGGER trg_rsvp_count
  AFTER INSERT OR UPDATE OR DELETE ON public.group_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.update_event_rsvp_count();

-- ── Group Polls ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_polls (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  message_id      uuid        REFERENCES public.org_group_messages(id) ON DELETE SET NULL,
  created_by      uuid        NOT NULL,
  question        text        NOT NULL,
  allows_multiple boolean     DEFAULT false,
  is_anonymous    boolean     DEFAULT false,
  expires_at      timestamptz,
  total_votes     integer     DEFAULT 0,
  is_closed       boolean     DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.group_poll_options (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    uuid    REFERENCES public.group_polls(id) ON DELETE CASCADE NOT NULL,
  org_id     uuid    NOT NULL,
  text       text    NOT NULL,
  vote_count integer DEFAULT 0,
  sort_order smallint DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.group_poll_votes (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id   uuid        REFERENCES public.group_polls(id) ON DELETE CASCADE NOT NULL,
  option_id uuid        REFERENCES public.group_poll_options(id) ON DELETE CASCADE NOT NULL,
  org_id    uuid        NOT NULL,
  user_id   uuid        NOT NULL,
  member_id uuid        REFERENCES public.org_members(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(poll_id, option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_polls_org     ON public.group_polls(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poll_opts     ON public.group_poll_options(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes    ON public.group_poll_votes(poll_id, user_id);
ALTER TABLE public.group_polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_poll_votes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_polls        REPLICA IDENTITY FULL;
ALTER TABLE public.group_poll_options REPLICA IDENTITY FULL;

CREATE POLICY "poll_select"   ON public.group_polls        FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "poll_manage"   ON public.group_polls        FOR ALL    USING (public.is_org_mod_or_above(org_id));
CREATE POLICY "pollopt_select" ON public.group_poll_options FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "pollopt_manage" ON public.group_poll_options FOR ALL    USING (public.is_org_mod_or_above(org_id));
CREATE POLICY "pollvote_select" ON public.group_poll_votes  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "pollvote_cast"   ON public.group_poll_votes  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.can_access_org_chat(org_id));
CREATE POLICY "pollvote_retract" ON public.group_poll_votes FOR DELETE USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_poll_options;

-- Trigger: update vote counts
CREATE OR REPLACE FUNCTION public.update_poll_vote_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_poll_id uuid;
  v_opt_id  uuid;
BEGIN
  v_poll_id := COALESCE(NEW.poll_id, OLD.poll_id);
  v_opt_id  := COALESCE(NEW.option_id, OLD.option_id);

  UPDATE public.group_poll_options
  SET vote_count = (SELECT count(*) FROM public.group_poll_votes WHERE option_id = v_opt_id)
  WHERE id = v_opt_id;

  UPDATE public.group_polls
  SET total_votes = (SELECT count(DISTINCT user_id) FROM public.group_poll_votes WHERE poll_id = v_poll_id)
  WHERE id = v_poll_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poll_vote_counts ON public.group_poll_votes;
CREATE TRIGGER trg_poll_vote_counts
  AFTER INSERT OR DELETE ON public.group_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_poll_vote_counts();

-- ── Community Milestones ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_milestones (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  created_by    uuid        NOT NULL,
  title         text        NOT NULL,
  description   text,
  icon          text        DEFAULT '🏆',
  target_value  integer,
  current_value integer     DEFAULT 0,
  metric        text        CHECK (metric IN ('members','messages','days_active','events','polls')),
  achieved_at   timestamptz,
  is_achieved   boolean     DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_org ON public.group_milestones(org_id);
ALTER TABLE public.group_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestone_select" ON public.group_milestones
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "milestone_manage" ON public.group_milestones
  FOR ALL    USING (public.is_org_admin(org_id));
