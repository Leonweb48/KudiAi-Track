-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITY MANAGEMENT — Phase 3: Voice Rooms & Scheduled Sessions
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Voice Rooms ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_voice_rooms (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  created_by      uuid        NOT NULL,
  name            text        NOT NULL DEFAULT 'Voice Room',
  description     text,
  max_speakers    integer     DEFAULT 10,
  max_listeners   integer     DEFAULT 500,
  status          text        DEFAULT 'active'
                              CHECK (status IN ('active','ended','scheduled')),
  is_muted_on_join boolean    DEFAULT true,
  speaker_count   integer     DEFAULT 0,
  listener_count  integer     DEFAULT 0,
  -- WebRTC signalling channel id
  channel_id      text        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  started_at      timestamptz DEFAULT now(),
  ended_at        timestamptz,
  scheduled_for   timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_rooms_org    ON public.group_voice_rooms(org_id, status);
CREATE INDEX IF NOT EXISTS idx_voice_rooms_active ON public.group_voice_rooms(org_id)
  WHERE status = 'active';

ALTER TABLE public.group_voice_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_voice_rooms REPLICA IDENTITY FULL;

CREATE POLICY "vroom_select"  ON public.group_voice_rooms
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "vroom_create"  ON public.group_voice_rooms
  FOR INSERT WITH CHECK (created_by = auth.uid() AND public.can_access_org_chat(org_id));
CREATE POLICY "vroom_manage"  ON public.group_voice_rooms
  FOR UPDATE USING (
    created_by = auth.uid() OR public.is_org_mod_or_above(org_id)
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_voice_rooms;

-- ── Voice Participants ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_voice_participants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid        REFERENCES public.group_voice_rooms(id) ON DELETE CASCADE NOT NULL,
  org_id        uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  member_id     uuid        REFERENCES public.org_members(id) ON DELETE SET NULL,
  display_name  text        NOT NULL,
  avatar_url    text,
  role          text        DEFAULT 'listener'
                            CHECK (role IN ('host','co_host','speaker','listener')),
  is_muted      boolean     DEFAULT true,
  is_hand_raised boolean    DEFAULT false,
  is_speaking   boolean     DEFAULT false,
  joined_at     timestamptz DEFAULT now(),
  left_at       timestamptz,
  UNIQUE(room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_voice_parts_room ON public.group_voice_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_voice_parts_active ON public.group_voice_participants(room_id)
  WHERE left_at IS NULL;

ALTER TABLE public.group_voice_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_voice_participants REPLICA IDENTITY FULL;

CREATE POLICY "vpart_select"  ON public.group_voice_participants
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "vpart_join"    ON public.group_voice_participants
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.can_access_org_chat(org_id));
CREATE POLICY "vpart_update"  ON public.group_voice_participants
  FOR UPDATE USING (user_id = auth.uid() OR public.is_org_mod_or_above(org_id));
CREATE POLICY "vpart_leave"   ON public.group_voice_participants
  FOR DELETE USING (user_id = auth.uid() OR public.is_org_mod_or_above(org_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_voice_participants;

-- Trigger: maintain speaker/listener counts on group_voice_rooms
CREATE OR REPLACE FUNCTION public.update_voice_room_counts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_room_id uuid := COALESCE(NEW.room_id, OLD.room_id);
BEGIN
  UPDATE public.group_voice_rooms SET
    speaker_count  = (SELECT count(*) FROM public.group_voice_participants
                      WHERE room_id = v_room_id AND left_at IS NULL
                        AND role IN ('host','co_host','speaker')),
    listener_count = (SELECT count(*) FROM public.group_voice_participants
                      WHERE room_id = v_room_id AND left_at IS NULL
                        AND role = 'listener')
  WHERE id = v_room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voice_counts ON public.group_voice_participants;
CREATE TRIGGER trg_voice_counts
  AFTER INSERT OR UPDATE OR DELETE ON public.group_voice_participants
  FOR EACH ROW EXECUTE FUNCTION public.update_voice_room_counts();

-- ── Scheduled Voice Sessions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_scheduled_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  created_by      uuid        NOT NULL,
  title           text        NOT NULL,
  description     text,
  cover_image_url text,
  scheduled_at    timestamptz NOT NULL,
  duration_mins   integer     DEFAULT 60,
  max_attendees   integer,
  rsvp_count      integer     DEFAULT 0,
  status          text        DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','live','ended','cancelled')),
  room_id         uuid        REFERENCES public.group_voice_rooms(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_org      ON public.group_scheduled_sessions(org_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sessions_upcoming ON public.group_scheduled_sessions(org_id, scheduled_at)
  WHERE status = 'scheduled';

ALTER TABLE public.group_scheduled_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_scheduled_sessions REPLICA IDENTITY FULL;

CREATE POLICY "session_select"  ON public.group_scheduled_sessions
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "session_manage"  ON public.group_scheduled_sessions
  FOR ALL    USING (public.is_org_mod_or_above(org_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.group_scheduled_sessions;

-- ── Session RSVPs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.group_session_rsvps (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        REFERENCES public.group_scheduled_sessions(id) ON DELETE CASCADE NOT NULL,
  org_id      uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  member_id   uuid        REFERENCES public.org_members(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_rsvps ON public.group_session_rsvps(session_id);
ALTER TABLE public.group_session_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sess_rsvp_select"  ON public.group_session_rsvps
  FOR SELECT USING (public.can_access_org_chat(org_id));
CREATE POLICY "sess_rsvp_own"     ON public.group_session_rsvps
  FOR ALL    USING (user_id = auth.uid());

-- Trigger: maintain rsvp_count on sessions
CREATE OR REPLACE FUNCTION public.update_session_rsvp_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.group_scheduled_sessions
  SET rsvp_count = (
    SELECT count(*) FROM public.group_session_rsvps
    WHERE session_id = COALESCE(NEW.session_id, OLD.session_id)
  )
  WHERE id = COALESCE(NEW.session_id, OLD.session_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_rsvp_count ON public.group_session_rsvps;
CREATE TRIGGER trg_session_rsvp_count
  AFTER INSERT OR DELETE ON public.group_session_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.update_session_rsvp_count();
